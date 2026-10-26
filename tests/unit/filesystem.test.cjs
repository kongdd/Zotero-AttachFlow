const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync, realpathSync, lstatSync, constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { fixture } = require('./helpers.cjs');

const fileObject = file => ({
  path: file,
  exists() { return existsSync(this.path); },
  normalize() { this.path = realpathSync(this.path); },
  isSymlink() { return lstatSync(this.path).isSymbolicLink(); },
  get parent() {
    const dir = path.dirname(this.path);
    return dir === this.path ? null : fileObject(dir);
  },
});

test('宿主文件系统：长文件名、重名保护及保存失败回滚', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachflow-files-'));
  try {
    const f = fixture(process.platform === 'win32');
    const source = path.join(root, 'old.pdf');
    const dir = path.join(root, 'target');
    await fs.writeFile(source, 'Original PDF');
    await fs.mkdir(dir);
    Object.assign(f.scope.PathUtils, { join: path.join, parent: path.dirname, filename: path.basename });
    f.Zotero.Prefs.get = () => dir;
    f.Zotero.File.pathToFile = fileObject;
    f.parent.getCollections = () => [];
    f.pdf.attachmentPath = source;
    f.persistedPaths.set(f.pdf.id, source);
    f.pdf.getFilePathAsync = async () => existsSync(f.pdf.attachmentPath) ? f.pdf.attachmentPath : false;
    f.scope.IOUtils.makeDirectory = dir => fs.mkdir(dir, { recursive: true });
    f.scope.IOUtils.exists = async file => existsSync(file);
    f.scope.IOUtils.move = async (from, to, { noOverwrite } = {}) => {
      try { await fs.copyFile(from, to, noOverwrite ? constants.COPYFILE_EXCL : 0); }
      catch (error) {
        if (error.code === 'EEXIST') error.name = 'NoModificationAllowedError';
        throw error;
      }
      await fs.unlink(from);
    };
    const basename = '文'.repeat(120);
    f.Zotero.Attachments.getFileBaseNameFromItem = () => basename;
    const occupied = path.join(dir, f.Zotero.File.truncateFileName(basename + '.pdf', 240));
    await fs.writeFile(occupied, 'Existing PDF');
    assert.equal((await f.rename([f.pdf])).renamed, 1);
    const actual = f.pdf.attachmentPath;
    assert.ok(Buffer.byteLength(path.basename(actual)) <= 255);
    assert.ok(actual.endsWith('-1.pdf'));
    assert.equal(await fs.readFile(occupied, 'utf8'), 'Existing PDF');
    assert.equal(await fs.readFile(actual, 'utf8'), 'Original PDF');
    assert.equal(existsSync(source), false);
    assert.equal((await f.rename([f.pdf])).skipped, 1);

    f.Zotero.Attachments.getFileBaseNameFromItem = () => 'Updated';
    f.pdf.saveTx = async () => { throw new Error('Save failed'); };
    assert.equal((await f.rename([f.pdf])).errors.length, 1);
    assert.equal(f.pdf.attachmentPath, actual);
    assert.equal(await fs.readFile(actual, 'utf8'), 'Original PDF');
    assert.equal(existsSync(path.join(dir, 'Updated.pdf')), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('宿主文件系统：真实目录别名不能绕过 repair 的存储目录保护', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachflow-paths-'));
  try {
    const f = fixture(process.platform === 'win32');
    const storage = path.join(root, 'storage');
    const alias = path.join(root, 'alias');
    const source = path.join(storage, 'inside.pdf');
    await fs.mkdir(storage);
    await fs.writeFile(source, 'Original PDF');
    await fs.symlink(storage, alias, process.platform === 'win32' ? 'junction' : 'dir');
    f.Zotero.File.pathToFile = fileObject;
    f.Zotero.Attachments.getStorageDirectory = () => fileObject(storage);
    f.pdf.getFilePathAsync = async () => path.join(alias, 'inside.pdf');
    const result = await f.repair([f.pdf]);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(await fs.readFile(source, 'utf8'), 'Original PDF');
    assert.equal(f.records.has(f.pdf.id), true);
    assert.deepEqual(f.calls.erased, []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
