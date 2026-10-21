const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../../build/functions.js'), 'utf8');
const bootstrap = ['tests/server', 'src/bootstrap']
  .map(name => fs.readFileSync(path.join(__dirname, '../../build', name + '.js'), 'utf8')).join('\n');
const siPDFs = [
  ['SI.pdf', 'Original'], ['SI1.pdf', 'Original'], ['paper_SI2.pdf', 'Original'],
  ['mmc1.pdf', 'Original'], ['paper-MOESM1.pdf', 'Original'],
  ['Supplementary.pdf', 'Original'], ['SupplementaryInformation.pdf', 'Original'],
  ['SupportingInformation.pdf', 'Original'], ['extra.pdf', 'Supporting Information'],
];

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
    isAttachment: () => true, isRegularItem: () => false,
    async getFilePathAsync() { return files.has(this.attachmentPath) ? this.attachmentPath : false; },
    getField() { return this.title; },
    setField(field, value) { this[field] = value; },
    async saveTx() { calls.saved.push(this.id); },
  };
  const parent = {
    id: 1, isAttachment: () => false, isRegularItem: () => true,
    getAttachments: () => [...records.values()].filter(item => item.parentItemID === 1).map(item => item.id),
    getBestAttachment: async () => pdf,
    getCollections: () => [20], getField: () => 'Paper',
  };
  const other = { ...pdf, id: 3, attachmentContentType: 'text/plain' };
  const records = new Map([[1, parent], [2, pdf], [3, other]]);
  function addAttachment(name, contents, fields = {}) {
    const item = { ...pdf, id: records.size + 1, attachmentPath: paths.join(base, name), ...fields };
    records.set(item.id, item);
    files.set(item.attachmentPath, contents);
    return item;
  }
  const pane = {
    getSelectedItems: () => [parent],
    copySelectedItemsToClipboard(asCitations) { calls.copied.push(asCitations); },
    async viewItems(items, event, options = {}) {
      for (const item of items) {
        const attachment = item.isRegularItem() ? await item.getBestAttachment() : item;
        if (attachment && attachment.isAttachment()) {
          await this.viewAttachment(attachment.id, event, options.noLocateOnMissing, options);
        }
      }
    },
    async viewAttachment(id) { calls.viewed.push({ id, path: await records.get(id).getFilePathAsync() }); },
  };
  window.ZoteroPane = pane;
  const move = async (from, to, options = {}) => {
    if (!files.has(from)) throw new Error('Source file does not exist');
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
        while (files.has(unique)) unique = to.replace(/(\.[^.]+)$/, `-${++suffix}$1`);
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
  const api = vm.runInNewContext(source + '\n({opendir, rename, open_rename, shortcutCommand})', { ...scope });
  return { ...api, scope, paths, base, pdf, parent, other, files, calls,
    oldPath, target, window, Zotero, records, addAttachment };
}

function key(key, isWin, changes = {}) {
  return {
    key, ctrlKey: isWin, metaKey: !isWin, shiftKey: false, altKey: false,
    repeat: false, defaultPrevented: false, composedPath: () => [],
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...changes,
  };
}

function check(name, fn) {
  for (const isWin of [true, false]) {
    test(`${isWin ? 'Windows' : 'macOS'}: ${name}`, () => fn(fixture(isWin), isWin));
  }
}

module.exports = { check, key, siPDFs, source, bootstrap };
