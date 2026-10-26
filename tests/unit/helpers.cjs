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
const linkModes = ['imported_file', 'imported_url', 'linked_file', 'linked_url'];

function fixture(isWin) {
  const paths = isWin ? path.win32 : path.posix;
  const base = isWin ? 'C:\\文献 库' : '/Users/test/文献 库';
  const oldPath = paths.join(base, 'storage', 'old.pdf');
  const target = paths.join(base, '父分类', '子分类', 'Paper.pdf');
  const files = new Map([[oldPath, 'PDF']]);
  const calls = { opened: [], viewed: [], saved: [], copied: [], erased: [], reloaded: [], errors: [], listeners: new Map() };
  const window = {
    addEventListener: (name, fn) => calls.listeners.set(name, fn),
    removeEventListener: name => calls.listeners.delete(name),
  };
  const records = new Map(), indexes = new Map();
  let inTransaction = false;
  let nextID = 2;
  let pdf;

  // 附件与批注共用的最小条目；linkMode 默认为已整理的链接附件。
  function attach(props = {}) {
    const item = {
      id: nextID++, parentItemID: null, title: 'Original', version: 1, notes: [],
      attachmentContentType: 'application/pdf', attachmentLinkMode: 2, attachmentPath: '',
      attachmentSyncedHash: null, attachmentSyncedModificationTime: null,
      isAttachment: () => true, isRegularItem: () => false, isAnnotation: false,
      isEditable: () => true, relations: {},
      get parentID() { return this.parentItemID; },
      set parentID(id) { this.parentItemID = id; },
      addRelation(predicate, uri) {
        const values = this.relations[predicate] ??= [];
        if (!values.includes(uri)) values.push(uri);
      },
      getField(name) { return this[name]; },
      setField(name, value) { this[name] = value; },
      async saveTx() { records.set(this.id, this); calls.saved.push(this.id); },
      async save() { records.set(this.id, this); calls.saved.push(this.id); },
      async reload() { calls.reloaded.push(this.id); },
      getNotes() { return this.notes; },
      getAnnotations(includeTrashed = false) {
        return [...records.values()].filter(item => item.isAnnotation && item.parentItemID === this.id
          && (includeTrashed || !item.deleted));
      },
      toJSON() {
        return {
          itemType: 'attachment', title: this.title, contentType: this.attachmentContentType,
          linkMode: linkModes[this.attachmentLinkMode],
          parentItem: this.parentItemID ? parent.key : false,
          ...this.attachmentLinkMode === 2
            ? { path: this.attachmentPath } : { filename: paths.basename(this.attachmentPath) },
        };
      },
      fromJSON(json) {
        this.title = json.title;
        this.attachmentContentType = json.contentType;
        this.attachmentLinkMode = linkModes.indexOf(json.linkMode);
        this.attachmentPath = json.path;
        this.parentItemID = json.parentItem ? parent.id : null;
      },
      async erase() {
        Zotero.DB.requireTransaction();
        for (const annotation of this.getAnnotations(true)) await annotation.erase();
        const uri = Zotero.URI.getItemURI(this);
        for (const item of records.values()) {
          for (const predicate of Object.keys(item.relations || {})) {
            item.relations[predicate] = item.relations[predicate].filter(value => value !== uri);
          }
        }
        files.delete(Zotero.Fulltext.getItemCacheFile(this).path);
        indexes.delete(this.id);
        calls.erased.push(this.id);
        records.delete(this.id);
      },
      async eraseTx() { return Zotero.DB.executeTransaction(() => this.erase()); },
      async getFilePathAsync() {
        const resolved = this.attachmentPath.startsWith('attachments:')
          ? paths.join(base, this.attachmentPath.slice('attachments:'.length)) : this.attachmentPath;
        return files.has(resolved) ? resolved : false;
      },
      ...props,
    };
    records.set(item.id, item);
    return item;
  }

  const parent = {
    id: 1, key: 'PARENT', isAnnotation: false,
    isAttachment: () => false, isRegularItem: () => true,
    getAttachments: () => [...records.values()].filter(item => item.parentItemID === 1).map(item => item.id),
    getBestAttachment: async () => records.has(pdf.id) ? pdf : pdfs()[0],
    getCollections: () => [20], getField: () => 'Paper',
    async reload() { calls.reloaded.push(this.id); },
  };
  records.set(parent.id, parent);
  pdf = attach({ attachmentLinkMode: 2, attachmentPath: oldPath, parentItemID: 1 });
  const other = attach({
    attachmentLinkMode: 0, attachmentContentType: 'text/plain',
    attachmentPath: oldPath, parentItemID: 1,
  });
  const pdfs = () => [...records.values()].filter(item => item.parentItemID === 1
    && item.attachmentContentType === 'application/pdf');

  function addAttachment(name, contents, fields = {}) {
    const file = paths.join(base, name);
    files.set(file, contents);
    return attach({ attachmentPath: file, parentItemID: 1, ...fields });
  }
  function addAnnotation(attachment, fields = {}) {
    const annotation = attach({ isAnnotation: true, isAttachment: () => false, ...fields });
    annotation.parentItemID = attachment.id;
    return annotation;
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
  const transfer = async (from, to, options = {}, move = false) => {
    await Promise.resolve();
    if (!files.has(from)) throw new Error('Source file does not exist');
    if (options.noOverwrite && files.has(to)) {
      throw Object.assign(new Error('Target exists'), { name: 'NoModificationAllowedError' });
    }
    files.set(to, files.get(from));
    if (move) files.delete(from);
  };
  const move = (from, to, options) => transfer(from, to, options, true);
  const Zotero = {
    isWin, isMac: !isWin,
    Prefs: { get: () => base }, getStorageDirectory: () => ({ path: base }),
    Collections: { get: id => id === 20 ? { name: '子分类', parentID: 10 } : { name: '父分类' } },
    Item: function () {
      const item = attach();
      records.delete(item.id); // new Item 尚未入库，save 后才可查询。
      return item;
    },
    Items: {
      get: ids => Array.isArray(ids) ? ids.map(id => records.get(id)).filter(Boolean) : records.get(ids),
      getAsync: async ids => Array.isArray(ids)
        ? ids.map(id => records.get(id)).filter(Boolean) : records.get(ids),
    },
    URI: { getItemURI: item => `item:${item.id}` },
    Relations: {
      getByObject: async (type, uri) => [...records.values()].flatMap(subject =>
        Object.entries(subject.relations || {}).filter(([, values]) => values.includes(uri))
          .map(([predicate]) => ({ subject, predicate }))),
    },
    Fulltext: {
      getItemCacheFile: item => ({ path: paths.join(base, 'storage', `ITEM${item.id}`, '.zotero-ft-cache') }),
      async transferItemIndex(from, to) {
        Zotero.DB.requireTransaction();
        if (indexes.has(from.id)) {
          indexes.set(to.id, indexes.get(from.id));
          indexes.delete(from.id);
        }
        const cache = this.getItemCacheFile(from).path;
        if (files.has(cache)) await move(cache, this.getItemCacheFile(to).path);
      },
    },
    Attachments: {
      LINK_MODE_LINKED_FILE: 2, getFileBaseNameFromItem: () => 'Paper',
      createDirectoryForItem: async item => paths.join(base, 'storage', `ITEM${item.id}`),
      getBaseDirectoryRelativePath: file => 'attachments:' + paths.relative(base, file).replace(/\\/g, '/'),
    },
    DB: {
      requireTransaction() {
        if (!inTransaction) throw new Error('Not in transaction');
      },
      async executeTransaction(fn) {
        if (inTransaction) throw new Error('Nested transaction');
        const rows = new Map(records), index = new Map(indexes);
        const snapshots = [...records.values()].map(item => [item, {
          ...item, relations: JSON.parse(JSON.stringify(item.relations || {})),
        }]);
        inTransaction = true;
        try { return await fn(); }
        catch (error) {
          records.clear();
          for (const [id, item] of rows) records.set(id, item);
          for (const [item, fields] of snapshots) Object.assign(item, fields);
          indexes.clear();
          for (const [id, value] of index) indexes.set(id, value);
          throw error;
        } finally { inTransaction = false; }
      },
      valueQueryAsync: async (sql, [id, mode, ...candidates]) => [...records.values()].filter(item =>
        item.id !== id && item.attachmentLinkMode === mode
        && candidates.some(candidate => candidate.toLowerCase() === item.attachmentPath?.toLowerCase())
      ).length,
    },
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
    IOUtils: {
      makeDirectory: async () => {}, move,
      copy: (from, to, options) => transfer(from, to, options),
      exists: async file => files.has(file),
      remove: async file => { files.delete(file); },
    }, Error };
  const api = vm.runInNewContext(source + '\n({opendir, rename, repair, open_rename, shortcutCommand})', { ...scope });
  return { ...api, scope, paths, base, pdf, parent, other, files, calls,
    oldPath, target, window, Zotero, records, indexes, pdfs, addAttachment, addAnnotation };
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
