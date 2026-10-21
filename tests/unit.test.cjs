const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../build/functions.js'), 'utf8');
const bootstrap = ['tests/server', 'src/bootstrap']
  .map(name => fs.readFileSync(path.join(__dirname, '../build', name + '.js'), 'utf8')).join('\n');

test('Zotero 10 manifest 必填项', () => {
  const manifest = require('../manifest.json');
  for (const key of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) {
    assert.ok(manifest.applications.zotero[key], `Missing ${key}`);
  }
  assert.equal(manifest.version, require('../package.json').version);
  assert.equal(manifest.name, 'Zotero-AttachFlow');
  assert.equal(manifest.applications.zotero.id, 'attachment-tools@kongdd');
});

function fixture(isWin) {
  const paths = isWin ? path.win32 : path.posix;
  const base = isWin ? 'C:\\文献 库' : '/Users/test/文献 库';
  const oldPath = paths.join(base, 'storage', 'old.pdf');
  const target = paths.join(base, '父分类', '子分类', 'Paper.pdf');
  const files = new Map([[oldPath, 'PDF']]);
  const calls = { opened: [], viewed: [], saved: [], copied: [], errors: [], listeners: new Map() };
  const window = {
    addEventListener: (name, fn) => calls.listeners.set(name, fn),
    removeEventListener: name => calls.listeners.delete(name),
  };
  const pdf = {
    id: 2, parentItemID: 1, attachmentContentType: 'application/pdf',
    attachmentLinkMode: 0, attachmentPath: oldPath, title: 'Original',
    isAttachment: () => true,
    async getFilePathAsync() { return files.has(this.attachmentPath) ? this.attachmentPath : false; },
    getField() { return this.title; },
    setField(field, value) { this[field] = value; },
    async saveTx() { calls.saved.push(this.id); },
  };
  const parent = {
    id: 1, isAttachment: () => false, isRegularItem: () => true,
    getAttachments: () => [2, 3], getCollections: () => [20], getField: () => 'Paper',
  };
  const other = { ...pdf, id: 3, attachmentContentType: 'text/plain' };
  const records = new Map([[1, parent], [2, pdf], [3, other]]);
  const pane = {
    getSelectedItems: () => [parent],
    copySelectedItemsToClipboard(asCitations) { calls.copied.push(asCitations); },
    async viewAttachment(id) { calls.viewed.push({ id, path: await records.get(id).getFilePathAsync() }); },
  };
  window.ZoteroPane = pane;
  const move = async (from, to, options = {}) => {
    if (options.noOverwrite && files.has(to)) throw new Error('Target exists');
    files.set(to, files.get(from));
    files.delete(from);
  };
  const Zotero = {
    isWin, isMac: !isWin,
    Prefs: { get: () => base }, getStorageDirectory: () => ({ path: base }),
    Collections: { get: id => id === 20 ? { name: '子分类', parentID: 10 } : { name: '父分类' } },
    Items: { getAsync: async id => Array.isArray(id) ? id.map(id => records.get(id)) : records.get(id) },
    Attachments: { LINK_MODE_LINKED_FILE: 2, getFileBaseNameFromItem: () => 'Paper' },
    File: {
      getValidFileName: name => name,
      async moveToUnique(from, to) {
        let unique = to, suffix = 0;
        while (files.has(unique)) unique = to.replace(/\.pdf$/, `-${++suffix}.pdf`);
        await move(from, unique);
        return unique;
      },
    },
    launchFile: async dir => calls.opened.push(dir),
    logError: error => calls.errors.push(error),
    Server: { Endpoints: {} }, getMainWindows: () => [window],
    getActiveZoteroPane: () => pane,
    alert: () => {},
  };
  const scope = { Zotero, PathUtils: { join: paths.join, parent: paths.dirname, filename: paths.basename },
    IOUtils: { makeDirectory: async () => {}, move }, Error };
  const api = vm.runInNewContext(source + '\n({opendir, rename, open_rename, shortcutCommand})', scope);
  return { ...api, scope, paths, base, pdf, parent, other, files, calls, oldPath, target, window, Zotero };
}

function key(key, isWin, changes = {}) {
  return {
    key, ctrlKey: isWin, metaKey: !isWin, shiftKey: false, altKey: false,
    repeat: false, defaultPrevented: false, composedPath: () => [],
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...changes,
  };
}

for (const isWin of [true, false]) {
  const check = (name, fn) => test(`${isWin ? 'Windows' : 'macOS'}: ${name}`, () => fn(fixture(isWin)));

  check('opendir 支持父条目和附件，返回系统目录', async f => {
    for (const item of [f.parent, f.pdf]) assert.equal(await f.opendir([item]), f.paths.dirname(f.oldPath));
    assert.equal(f.calls.opened.length, 2);
  });
  check('opendir 跳过缺失文件和非 PDF', async f => {
    f.files.clear();
    assert.equal(await f.opendir([f.other, f.pdf]), null);
    assert.equal(f.calls.opened.length, 0);
  });
  check('rename 只移动 PDF 并保存链接，不打开文件', async f => {
    const result = await f.rename([f.parent]);
    assert.equal(f.calls.viewed.length, 0);
    assert.equal(result.renamed, 1);
    assert.equal(f.pdf.attachmentPath, f.target);
    assert.equal(f.pdf.title, 'Paper');
    assert.equal(f.pdf.attachmentLinkMode, 2);
    assert.equal(f.files.get(f.target), 'PDF');
    assert.equal(f.files.has(f.oldPath), false);
    assert.deepEqual(f.calls.saved, [2]);
  });
  check('父子重复选择只处理一次', async f => {
    assert.equal((await f.rename([f.parent, f.pdf])).renamed, 1);
    assert.deepEqual(f.calls.saved, [2]);
  });
  check('重名保护和重复执行', async f => {
    f.files.set(f.target, 'Existing PDF');
    assert.equal((await f.rename([f.pdf])).renamed, 1);
    const actual = f.pdf.attachmentPath;
    assert.notEqual(actual, f.target);
    assert.equal(f.files.get(f.target), 'Existing PDF');
    assert.equal((await f.rename([f.pdf])).skipped, 1);
    assert.equal(f.pdf.attachmentPath, actual);
  });
  check('保存失败时恢复原文件和元数据', async f => {
    f.pdf.saveTx = async () => { throw new Error('Database failure'); };
    assert.equal((await f.rename([f.pdf])).errors.length, 1);
    assert.equal(f.files.get(f.oldPath), 'PDF');
    assert.equal(f.files.has(f.target), false);
    assert.equal(f.pdf.attachmentPath, f.oldPath);
    assert.equal(f.pdf.attachmentLinkMode, 0);
    assert.equal(f.pdf.title, 'Original');
  });
  check('独立附件、缺失文件和空选择安全跳过', async f => {
    f.pdf.parentItemID = null;
    assert.equal((await f.rename([f.pdf])).skipped, 1);
    f.files.clear();
    assert.equal((await f.rename([f.pdf])).skipped, 1);
    assert.equal((await f.rename([])).renamed, 0);
  });
  check('快捷键仅接受 Windows Ctrl / macOS Cmd', f => {
    assert.equal(f.shortcutCommand(key('e', isWin), !isWin), 'opendir');
    assert.equal(f.shortcutCommand(key('r', isWin), !isWin), 'rename');
    assert.equal(f.shortcutCommand(key('e', !isWin), !isWin), null);
    for (const change of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true }]) {
      assert.equal(f.shortcutCommand(key('r', isWin, change), !isWin), null);
    }
    assert.equal(f.shortcutCommand(key('r', isWin, { composedPath: () => [{ closest: () => ({}) }] }), !isWin), null);
  });
  check('插件不拦截原生复制快捷键及已移除的测试快捷键', async f => {
    const lifecycle = vm.runInNewContext(source + bootstrap + '\n({startup,shutdown})', f.scope);
    await lifecycle.startup({ version: 'test' });
    const handler = f.calls.listeners.get('keydown');
    for (const letter of ['c', 'C', 'd', 'D']) {
      const event = key(letter, isWin, { shiftKey: true });
      assert.equal(f.shortcutCommand(event, !isWin), null);
      handler(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(f.Zotero.AttachmentTools.pending, null);
    }
    assert.deepEqual(f.calls.copied, []);
    lifecycle.shutdown();
  });
  check('open_rename 在正常打开时先重命名，卸载后恢复原打开方法', async f => {
    const pane = f.window.ZoteroPane;
    const original = pane.viewAttachment;
    const restore = f.open_rename(pane);
    await pane.viewAttachment(f.pdf.id);
    assert.deepEqual(f.calls.saved, [2]);
    assert.deepEqual(f.calls.viewed, [{ id: 2, path: f.target }]);
    restore();
    assert.equal(pane.viewAttachment, original);
  });
  check('插件生命周期、快捷键互斥与失败后恢复', async f => {
    const original = f.window.ZoteroPane.viewAttachment;
    const lifecycle = vm.runInNewContext(source + bootstrap + '\n({startup,shutdown})', f.scope);
    await lifecycle.startup({ version: 'test' });
    const plugin = f.Zotero.AttachmentTools;
    assert.equal(plugin.windows.size, 1);
    assert.ok(f.Zotero.Server.Endpoints['/attachment-tools/tests']);
    const handler = f.calls.listeners.get('keydown');
    const rename = key('r', isWin);
    handler(rename);
    assert.equal(rename.defaultPrevented, true);
    const pending = plugin.pending;
    handler(key('r', isWin));
    assert.equal(plugin.pending, pending);
    await pending;
    assert.equal(plugin.pending, null);
    assert.deepEqual(f.calls.saved, [2]);
    assert.equal(f.pdf.attachmentPath, f.target);
    handler(key('e', isWin));
    await plugin.pending;
    assert.deepEqual(f.calls.opened, [f.paths.dirname(f.target)]);
    const opendir = plugin.opendir;
    plugin.opendir = async () => { throw new Error('Launch failed'); };
    handler(key('e', isWin));
    assert.equal(await plugin.pending, null);
    assert.equal(plugin.pending, null);
    assert.equal(f.calls.errors.length, 1);
    plugin.opendir = opendir;
    handler(key('e', isWin));
    await plugin.pending;
    assert.equal(f.calls.opened.length, 2);
    lifecycle.shutdown();
    assert.equal(f.calls.listeners.size, 0);
    assert.equal(f.window.ZoteroPane.viewAttachment, original);
    assert.equal(f.Zotero.AttachmentTools, undefined);
    assert.equal(f.Zotero.Server.Endpoints['/attachment-tools/tests'], undefined);
  });
}
