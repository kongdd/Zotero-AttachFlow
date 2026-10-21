// 真实文件和数据库测试：只创建随机命名的测试对象，finally 中逐个清理。
async function runIntegrationTests(core: AttachmentCommands): Promise<TestReport> {
  const token = `attachment-tools-test-${Date.now()}-${Zotero.Utilities.randomString(8)}`;
  const pref = Zotero.Prefs.get('baseAttachmentPath');
  const base = typeof pref === 'string' && pref ? pref : Zotero.getStorageDirectory().path;
  const source = PathUtils.join(Zotero.getTempDirectory().path, token);
  const target = PathUtils.join(base, token);
  const items: Zotero.Item[] = [], collections: Zotero.Collection[] = [], dirs: string[] = [];
  const options = { skipNotifier: true };
  const report: TestReport = { ...runRuntimeTests(core), checks: [], passed: false };
  const pdf = testPDF();
  const window = Zotero.getMainWindow();
  const pane = window.ZoteroPane;
  const selected = pane.itemsView ? pane.itemsView.getSelectedItems(true) : [];
  const selectedTab = window.Zotero_Tabs.selectedID;
  const tree = pane.collectionsView;
  const selectedCollection = tree ? tree.selectedTreeRow?.id : undefined;
  const plugin = core as Partial<AttachmentPlugin>;
  let restoreOpen: (() => void) | undefined;

  function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  async function check(name: string, run: () => Promise<void>): Promise<void> {
    try { await run(); report.checks.push({ name, passed: true }); }
    catch (error) { report.checks.push({ name, passed: false, error: String(error) }); }
  }
  async function collection(name: string, parentID?: number): Promise<Zotero.Collection> {
    const item = new Zotero.Collection({ name, parentID, libraryID: Zotero.Libraries.userLibraryID });
    await item.saveTx(options);
    collections.push(item);
    return item;
  }
  async function fixture(label: string, collectionID: number, stored = false) {
    const parent = new Zotero.Item('book');
    parent.libraryID = Zotero.Libraries.userLibraryID;
    parent.setField('title', `Integration ${label}`);
    parent.setCollections([collectionID]);
    await parent.saveTx(options);
    items.push(parent);
    const attachment = new Zotero.Item('attachment');
    attachment.parentID = parent.id;
    attachment.setField('title', 'Original attachment');
    attachment.attachmentContentType = 'application/pdf';
    attachment.attachmentLinkMode = stored
      ? Zotero.Attachments.LINK_MODE_IMPORTED_FILE : Zotero.Attachments.LINK_MODE_LINKED_FILE;
    let dir = source;
    if (stored) {
      await attachment.saveTx(options);
      items.push(attachment);
      dir = await Zotero.Attachments.createDirectoryForItem(attachment);
      dirs.push(dir);
    }
    const oldPath = PathUtils.join(dir, label + '.pdf');
    await Zotero.File.putContentsAsync(oldPath, pdf);
    attachment.attachmentPath = oldPath;
    await attachment.saveTx(options);
    if (!stored) items.push(attachment);
    return { parent, attachment, oldPath };
  }
  async function verify(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
    const path = await f.attachment.getFilePathAsync();
    assert(path && path !== f.oldPath, 'Attachment was not moved');
    assert(collectionDirectory(f.parent) === PathUtils.parent(path), 'Wrong destination directory');
    assert(!(await IOUtils.exists(f.oldPath)), 'Old file still exists');
    assert(await Zotero.File.getContentsAsync(path) === pdf, 'PDF contents changed');
    const row = await Zotero.DB.rowQueryAsync(
      'SELECT path, linkMode FROM itemAttachments WHERE itemID=?', [f.attachment.id],
    ) as { path: string; linkMode: number } | false;
    assert(row, 'Attachment row was not saved');
    assert(row.path === f.attachment.attachmentPath, 'Database path was not saved');
    assert(row.linkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE, 'Link mode was not saved');
    const title = await Zotero.DB.valueQueryAsync<string>(
      'SELECT value FROM itemData JOIN itemDataValues USING (valueID) WHERE itemID=? AND fieldID=?',
      [f.attachment.id, Zotero.ItemFields.getID('title')],
    );
    assert(title === f.attachment.getField('title'), 'Title was not saved');
    return path;
  }

  try {
    assert(await IOUtils.exists(base), `Attachment base directory does not exist: ${base}`);
    for (const dir of [source, target]) {
      assert(!(await IOUtils.exists(dir)), `Test directory already exists: ${dir}`);
      await IOUtils.makeDirectory(dir);
      dirs.push(dir);
    }
    const root = await collection(token);
    const child = await collection('中文 分类', root.id);

    await check('附件入口、嵌套目录及数据库保存', async () => {
      const f = await fixture('attachment', child.id);
      assert((await core.rename([f.attachment])).renamed === 1, 'Expected one rename');
      await verify(f);
    });
    await check('父条目入口、父子重复选择及非 PDF 跳过', async () => {
      const f = await fixture('parent', child.id);
      const text = new Zotero.Item('attachment');
      text.parentID = f.parent.id;
      text.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
      text.attachmentContentType = 'text/plain';
      const textPath = PathUtils.join(source, 'keep.txt');
      await Zotero.File.putContentsAsync(textPath, 'Keep this text.');
      text.attachmentPath = textPath;
      await text.saveTx(options);
      items.push(text);
      assert((await core.rename([f.parent, f.attachment])).renamed === 1, 'Attachment processed twice');
      await verify(f);
      assert(await text.getFilePathAsync() === textPath, 'Non-PDF attachment was moved');
      assert(await Zotero.File.getContentsAsync(textPath) === 'Keep this text.', 'Non-PDF changed');
    });
    await check('多选入口', async () => {
      const fixtures = [await fixture('multi-1', child.id), await fixture('multi-2', child.id)];
      assert((await core.rename(fixtures.map(f => f.parent))).renamed === 2, 'Expected two renames');
      for (const f of fixtures) await verify(f);
    });
    await check('stored 转 linked file', async () => {
      const f = await fixture('stored', child.id, true);
      assert((await core.rename([f.attachment])).renamed === 1, 'Stored attachment was not renamed');
      await verify(f);
    });
    await check('重名保护及重复执行不变', async () => {
      const f = await fixture('collision', child.id);
      const name = Zotero.Attachments.getFileBaseNameFromItem(f.parent, { attachmentTitle: f.parent.getField('title') });
      const occupied = PathUtils.join(target, child.name, name + '.pdf');
      await Zotero.File.putContentsAsync(occupied, 'Do not overwrite.');
      assert((await core.rename([f.attachment])).renamed === 1, 'Expected a unique filename');
      const moved = await verify(f);
      assert(moved !== occupied, 'Link points to the existing file');
      assert(await Zotero.File.getContentsAsync(occupied) === 'Do not overwrite.', 'Existing file changed');
      assert((await core.rename([f.attachment])).renamed === 0, 'Repeated action renamed the file again');
      assert(await f.attachment.getFilePathAsync() === moved, 'Repeated action changed the path');
    });
    await check('正常打开 PDF：自动重命名后交回 Zotero 打开', async () => {
      const f = await fixture('auto-open', child.id);
      if (!plugin.windows?.has(window)) restoreOpen = open_rename(pane);
      await pane.viewAttachment(f.attachment.id);
      await verify(f);
    });
    if (plugin.windows?.has(window)) await check('主窗口快捷键 DOM 事件：Ctrl/Cmd+R、Ctrl/Cmd+E', async () => {
      const f = await fixture('shortcut', child.id);
      assert(pane.collectionsView && pane.itemsView, 'Library view is not ready');
      await pane.collectionsView.selectByID('L' + Zotero.Libraries.userLibraryID);
      await pane.itemsView.refresh();
      await pane.selectItem(f.attachment.id);
      const actual = pane.getSelectedItems(true);
      assert(actual.length === 1 && actual[0] === f.attachment.id, 'Test attachment was not selected');
      async function press(key: string) {
        const event = new window.KeyboardEvent('keydown', {
          key, ctrlKey: !Zotero.isMac, metaKey: Zotero.isMac, bubbles: true, cancelable: true,
        });
        plugin.pending = null;
        window.dispatchEvent(event);
        assert(event.defaultPrevented && plugin.pending,
          `Shortcut ${key} was not handled: trusted=${event.isTrusted}, prevented=${event.defaultPrevented}, busy=${plugin.busy}`);
        return await plugin.pending;
      }
      await press('r');
      const moved = await verify(f);
      assert(await press('e') === PathUtils.parent(moved), 'Shortcut opened the wrong directory');
    });
    await check('opendir 调用系统文件管理器', async () => {
      const f = await fixture('opendir', child.id);
      assert(await core.opendir([f.attachment]) === source, 'Wrong attachment directory');
      assert(await core.opendir([f.parent]) === source, 'Wrong parent-item directory');
    });
  } catch (error) {
    report.checks.push({ name: 'setup', passed: false, error: String(error) });
  } finally {
    const ids = items.map(item => item.id);
    const collectionIDs = collections.map(item => item.id);
    const errors: string[] = [];
    restoreOpen?.();
    try {
      for (const tab of window.Zotero_Tabs.getState()) {
        const reader = Zotero.Reader.getByTabID(tab.id);
        if (reader && reader.itemID !== undefined && ids.includes(reader.itemID)) reader.close();
      }
    } catch (error) { errors.push(String(error)); }
    for (const item of [...items.reverse(), ...collections.reverse()]) {
      try { await item.eraseTx(options); } catch (error) { errors.push(String(error)); }
    }
    for (const dir of dirs.reverse()) {
      try { await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true }); }
      catch (error) { errors.push(String(error)); }
    }
    try {
      if (pane.itemsView) await pane.itemsView.refresh();
      if (selectedCollection && pane.collectionsView) await pane.collectionsView.selectByID(selectedCollection);
      if (selected.length) await pane.selectItems(selected);
      if (window.Zotero_Tabs.getState().some(tab => tab.id === selectedTab)) window.Zotero_Tabs.select(selectedTab);
    } catch (error) { errors.push(String(error)); }
    await check('清理测试条目、分类及文件', async () => {
      assert(!errors.length, errors.join('\n'));
      for (const [table, column, values] of [['items', 'itemID', ids], ['collections', 'collectionID', collectionIDs]] as const) {
        if (!values.length) continue;
        const count = await Zotero.DB.valueQueryAsync<number>(
          `SELECT COUNT(*) FROM ${table} WHERE ${column} IN (${values.map(() => '?').join(',')})`, values,
        );
        assert(count === 0, `Test records remain in ${table}`);
      }
      for (const dir of dirs) assert(!(await IOUtils.exists(dir)), `Test directory remains: ${dir}`);
    });
  }
  report.passed = report.checks.every(check => check.passed);
  return report;
}

// 有效的单页 PDF；ASCII 文本保证 xref 字节偏移正确。
function testPDF(): string {
  let pdf = '%PDF-1.4\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>',
  ];
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  const xref = pdf.length;
  return pdf + 'xref\n0 4\n0000000000 65535 f \n' + offsets.join('')
    + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
