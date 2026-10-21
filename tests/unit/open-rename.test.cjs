const assert = require('node:assert/strict');
const { check, siPDFs } = require('./helpers.cjs');

check('直接打开 SI PDF 时保留文件和元数据，不影响正常打开', async f => {
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  const expected = [];
  for (const [name, title] of siPDFs) {
    const si = f.addAttachment(name, 'SI PDF', { title });
    await pane.viewAttachment(si.id);
    await pane.viewItems([si]);
    expected.push({ id: si.id, path: si.attachmentPath }, { id: si.id, path: si.attachmentPath });
    assert.equal(si.title, title);
    assert.equal(si.attachmentLinkMode, 0);
    assert.equal(f.files.get(si.attachmentPath), 'SI PDF');
  }
  assert.deepEqual(f.calls.saved, []);
  assert.deepEqual(f.calls.viewed, expected);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  restore();
});

check('直接打开非默认普通 PDF 时只整理自身，不处理同级附件', async f => {
  const extra = f.addAttachment('extra.pdf', 'Extra PDF');
  f.parent.getBestAttachment = async () => { throw new Error('Must not select a default'); };
  const restore = f.open_rename(f.window.ZoteroPane);
  await f.window.ZoteroPane.viewAttachment(extra.id);
  assert.deepEqual(f.calls.saved, [4]);
  assert.deepEqual(f.calls.viewed, [{ id: 4, path: f.target }]);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  assert.deepEqual(f.calls.errors, []);
  restore();
});

check('打开父条目时遍历子附件，仅整理主 PDF 和 Word', async f => {
  const main = f.addAttachment('main.pdf', 'Contents');
  const word = f.addAttachment('SI.doc', 'Contents', { attachmentContentType: 'application/msword' });
  const image = f.addAttachment('figure.png', 'Contents', { attachmentContentType: 'image/png' });
  f.parent.getBestAttachment = async () => main;
  const pane = f.window.ZoteroPane;
  const originalItems = pane.viewItems;
  const restore = f.open_rename(pane);
  await pane.viewItems([f.parent]);
  assert.deepEqual(f.calls.saved, [4, 5]);
  assert.deepEqual(f.calls.viewed, [{ id: 4, path: f.target }]);
  assert.equal(word.attachmentPath.endsWith('Paper.doc'), true);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  assert.equal(f.files.get(image.attachmentPath), 'Contents');
  restore();
  assert.equal(pane.viewItems, originalItems);
});

check('打开父条目不会在默认 SI 实际打开时绕过批量保护', async f => {
  f.pdf.title = 'Supporting Information';
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  await pane.viewItems([f.parent]);
  assert.deepEqual(f.calls.saved, []);
  assert.deepEqual(f.calls.viewed, [{ id: 2, path: f.oldPath }]);
  restore();
});

check('打开父条目期间，独立打开其他附件不受其上下文影响', async f => {
  const extra = f.addAttachment('extra.pdf', 'Extra PDF');
  let resume, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  f.parent.getBestAttachment = async () => { entered(); return gate; };
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  const parentOpen = pane.viewItems([f.parent]);
  await waiting;
  await pane.viewAttachment(extra.id);
  resume(f.pdf);
  await parentOpen;
  assert.deepEqual(f.calls.saved, [4, 2]);
  assert.equal(f.calls.viewed.length, 2);
  restore();
});

check('同时打开父条目与明确选择的 SI 时，SI 按单附件规则处理', async f => {
  const si = f.addAttachment('SI.pdf', 'SI PDF');
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  await pane.viewItems([f.parent, si]);
  assert.deepEqual(f.calls.saved, [2]);
  assert.equal(f.calls.viewed.length, 2);
  assert.equal(f.files.get(si.attachmentPath), 'SI PDF');
  restore();
});

check('打开 Word 仅整理该文件，图件保持不变', async f => {
  const word = f.addAttachment('SI.doc', 'Contents', { attachmentContentType: 'application/msword' });
  const image = f.addAttachment('figure.png', 'Contents', { attachmentContentType: 'image/png' });
  const restore = f.open_rename(f.window.ZoteroPane);
  await f.window.ZoteroPane.viewAttachment(word.id);
  await f.window.ZoteroPane.viewAttachment(image.id);
  assert.deepEqual(f.calls.saved, [4]);
  assert.equal(word.attachmentPath.endsWith('Paper.doc'), true);
  assert.deepEqual(f.calls.viewed, [
    { id: 4, path: word.attachmentPath }, { id: 5, path: image.attachmentPath },
  ]);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  restore();
});

check('同时打开父条目及同一 PDF 时只整理一次，均正常打开', async f => {
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  await Promise.all([pane.viewItems([f.parent]), pane.viewAttachment(f.pdf.id)]);
  assert.deepEqual(f.calls.saved, [2]);
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.calls.viewed, [{ id: 2, path: f.target }, { id: 2, path: f.target }]);
  restore();
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
