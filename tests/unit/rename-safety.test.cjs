const assert = require('node:assert/strict');
const { check } = require('./helpers.cjs');

check('repair 先执行时，后续 rename 使用新附件和当前路径', async f => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const relations = f.Zotero.Relations.getByObject;
  f.Zotero.Relations.getByObject = async (...args) => {
    entered();
    await gate;
    return relations(...args);
  };
  const repairing = f.repair([f.pdf]);
  await ready;
  const renaming = f.rename([f.pdf]);
  release();
  const [repaired, renamed] = await Promise.all([repairing, renaming]);
  const current = f.pdfs()[0];
  assert.equal(repaired.repaired, 1);
  assert.equal(renamed.renamed, 1);
  assert.equal(repaired.errors.length + renamed.errors.length, 0);
  assert.equal(await current.getFilePathAsync(), f.target);
  assert.deepEqual(Array.from(renamed.replacements, row => ({ ...row })),
    [{ from: f.pdf.id, to: current.id }]);
});

check('rename 先执行时，后续 repair 不使用已过期的文件路径', async f => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const move = f.scope.IOUtils.move;
  f.scope.IOUtils.move = async (...args) => {
    entered();
    await gate;
    return move(...args);
  };
  const renaming = f.rename([f.pdf]);
  await ready;
  const repairing = f.repair([f.pdf]);
  release();
  const [renamed, repaired] = await Promise.all([renaming, repairing]);
  assert.equal(renamed.renamed, 1);
  assert.equal(repaired.repaired, 1);
  assert.equal(renamed.errors.length + repaired.errors.length, 0);
  assert.equal(await f.pdfs()[0].getFilePathAsync(), f.target);
  assert.equal(f.files.get(f.target), 'PDF');
});

check('并发重复 repair 仅重建一次，旧引用仍能正确重命名', async f => {
  const results = await Promise.all([f.repair([f.pdf]), f.repair([f.pdf])]);
  assert.equal(results.reduce((sum, result) => sum + result.repaired, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.skipped, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.deepEqual(f.calls.erased, [f.pdf.id]);
  assert.equal((await f.rename([f.pdf])).renamed, 1);
  assert.equal(await f.pdfs()[0].getFilePathAsync(), f.target);
});

check('新附件在事务内可见时，新旧引用也共用同一队列', async f => {
  f.pdf.attachmentLinkMode = 0;
  const pending = [];
  const createDirectory = f.Zotero.Attachments.createDirectoryForItem;
  f.Zotero.Attachments.createDirectoryForItem = async item => {
    const dir = await createDirectory(item);
    f.Zotero.Attachments.getFileBaseNameFromItem = () => 'Updated';
    pending.push(f.rename([item], { onlyMainPDF: false }), f.rename([f.pdf], { onlyMainPDF: false }));
    return dir;
  };
  assert.equal((await f.rename([f.pdf])).renamed, 1);
  const results = await Promise.all(pending);
  assert.equal(results.reduce((sum, result) => sum + result.renamed, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.equal(f.paths.basename(await f.pdfs()[0].getFilePathAsync()), 'Updated.pdf');
});

check('不同存储型附件并发转换时，各自保留文件和新条目', async f => {
  f.pdf.attachmentLinkMode = 0;
  const extra = f.addAttachment('extra.pdf', 'Extra PDF', { attachmentLinkMode: 0 });
  const results = await Promise.all([
    f.rename([f.pdf], { onlyMainPDF: false }), f.rename([extra], { onlyMainPDF: false }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.renamed, 0), 2);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.equal(f.pdfs().length, 2);
  const paths = await Promise.all(f.pdfs().map(item => item.getFilePathAsync()));
  assert.equal(new Set(paths).size, 2);
  assert.deepEqual(paths.map(path => f.files.get(path)).sort(), ['Extra PDF', 'PDF']);
});

check('repair 的目录保护处理大小写和 ..，原生比较函数仍区分大小写', async f => {
  const dir = f.Zotero.Attachments.getStorageDirectory(f.pdf).path;
  assert.equal(f.Zotero.File.directoryContains(dir, dir.toLowerCase()), false);
  for (const root of [dir.toLowerCase(), dir.toUpperCase(), dir + f.paths.sep + 'nested' + f.paths.sep + '..']) {
    const source = root + f.paths.sep + 'inside.pdf';
    f.pdf.attachmentPath = source;
    f.files.set(f.paths.normalize(source), 'PDF');
    const result = await f.repair([f.pdf]);
    assert.equal(result.skipped, 1);
    assert.equal(result.repaired, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(f.files.get(f.paths.normalize(source)), 'PDF');
  }
  assert.deepEqual(f.calls.erased, []);
});

check('repair 跳过通过符号链接指向旧存储目录的文件', async f => {
  const dir = f.Zotero.Attachments.getStorageDirectory(f.pdf).path;
  const source = f.paths.join(dir, 'inside.pdf');
  const alias = f.paths.join(f.base, 'alias');
  f.files.set(source, 'PDF');
  f.links.set(alias, dir);
  f.pdf.attachmentPath = f.paths.join(alias, 'inside.pdf');
  assert.equal((await f.repair([f.pdf])).skipped, 1);
  assert.equal(f.files.get(source), 'PDF');
  assert.equal(f.records.has(f.pdf.id), true);
});

check('旧存储目录自身是链接时，不误删其实际目标中的文件', async f => {
  const dir = f.Zotero.Attachments.getStorageDirectory(f.pdf).path;
  const target = f.paths.join(f.base, 'actual-storage');
  const source = f.paths.join(target, 'inside.pdf');
  f.links.set(dir, target);
  f.files.set(source, 'PDF');
  f.pdf.attachmentPath = source;
  const result = await f.repair([f.pdf]);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(f.files.get(source), 'PDF');
  assert.deepEqual(f.calls.erased, []);
});

check('目录前缀相同但实际位于外部的文件仍可 repair', async f => {
  const dir = f.Zotero.Attachments.getStorageDirectory(f.pdf).path;
  const source = f.paths.join(dir + '-other', 'outside.pdf');
  f.pdf.attachmentPath = source;
  f.files.set(source, 'PDF');
  const result = await f.repair([f.pdf]);
  assert.equal(result.repaired, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(await f.pdfs()[0].getFilePathAsync(), source);
  assert.equal(f.files.get(source), 'PDF');
});

check('rename 不把存储型文件移入即将删除的自身目录或目录别名', async f => {
  f.pdf.attachmentLinkMode = 0;
  const dir = f.Zotero.Attachments.getStorageDirectory(f.pdf).path;
  const source = f.paths.join(dir, 'old.pdf');
  const alias = f.paths.join(f.base, 'alias');
  f.pdf.attachmentPath = source;
  f.files.set(source, 'PDF');
  f.links.set(alias, dir);
  f.parent.getCollections = () => [];
  for (const base of [dir, alias]) {
    f.Zotero.Prefs.get = () => base;
    const result = await f.rename([f.pdf]);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(f.files.get(source), 'PDF');
    assert.equal(f.pdf.attachmentPath, source);
  }
  assert.deepEqual(f.calls.erased, []);
  assert.deepEqual(f.calls.saved, []);
});

check('rename 与 repair 均跳过回收站、只读条目及非个人库', async f => {
  const editable = f.pdf.isEditable;
  for (const fields of [{ deleted: true }, { isEditable: () => false }, { libraryID: 2 }]) {
    Object.assign(f.pdf, { deleted: false, isEditable: editable, libraryID: 1 }, fields);
    const renamed = await f.rename([f.pdf]);
    const repaired = await f.repair([f.pdf]);
    assert.equal(renamed.skipped, 1);
    assert.equal(repaired.skipped, 1);
    assert.equal(renamed.errors.length + repaired.errors.length, 0);
    assert.equal(f.files.get(f.oldPath), 'PDF');
  }
  assert.deepEqual(f.calls.saved, []);
  assert.deepEqual(f.calls.erased, []);
});

check('rename 不移动符号链接，避免改变其相对目标', async f => {
  const source = f.paths.join(f.base, 'actual.pdf');
  f.files.delete(f.oldPath);
  f.files.set(source, 'PDF');
  f.links.set(f.oldPath, source);
  for (const mode of [0, 2]) {
    f.pdf.attachmentLinkMode = mode;
    assert.equal((await f.rename([f.pdf])).skipped, 1);
    assert.equal(f.files.get(source), 'PDF');
    assert.equal(f.links.get(f.oldPath), source);
  }
  assert.deepEqual(f.calls.saved, []);
});

check('PDF 缺失或无效扩展名统一补 .pdf，重复执行不再移动', async f => {
  for (const name of ['download.', 'download.' + 'x'.repeat(25), '.hidden']) {
    const item = f.addAttachment(name, 'PDF');
    const result = await f.rename([item], { onlyMainPDF: false });
    assert.equal(result.renamed, 1);
    assert.match(f.paths.basename(item.attachmentPath), /^Paper(?:-\d+)?\.pdf$/);
    assert.equal((await f.rename([item], { onlyMainPDF: false })).skipped, 1);
    assert.equal(f.files.get(item.attachmentPath), 'PDF');
  }
});

check('非标准 PDF 扩展名和正则字符仍保留，重名后重复执行不再移动', async f => {
  for (const extension of ['bin', 'p+df']) {
    const item = f.addAttachment(`download.${extension}`, 'PDF');
    const target = f.paths.join(f.paths.dirname(f.target), `Paper.${extension}`);
    f.files.set(target, 'Existing');
    assert.equal((await f.rename([item], { onlyMainPDF: false })).renamed, 1);
    assert.ok(item.attachmentPath.endsWith(`-1.${extension}`));
    assert.equal((await f.rename([item], { onlyMainPDF: false })).skipped, 1);
    assert.equal(f.files.get(target), 'Existing');
    assert.equal(f.files.get(item.attachmentPath), 'PDF');
  }
});

check('转换事务已提交后通知抛错，不把文件回滚到已删除的旧条目', async f => {
  f.pdf.attachmentLinkMode = 0;
  const transaction = f.Zotero.DB.executeTransaction;
  f.Zotero.DB.executeTransaction = async (...args) => {
    await transaction(...args);
    throw new Error('Commit observer failed');
  };
  const result = await f.rename([f.pdf]);
  assert.equal(result.renamed, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(f.records.has(f.pdf.id), false);
  assert.equal(await f.pdfs()[0].getFilePathAsync(), f.target);
  assert.equal(f.files.has(f.oldPath), false);
  assert.match(String(f.calls.errors[0]), /Commit observer failed/);
  assert.equal((await f.rename([f.pdf])).skipped, 1);
});

check('链接附件保存已提交后通知抛错，数据库和文件路径保持一致', async f => {
  const save = f.pdf.saveTx.bind(f.pdf);
  f.pdf.saveTx = async () => { await save(); throw new Error('Commit observer failed'); };
  const result = await f.rename([f.pdf]);
  assert.equal(result.renamed, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(f.persistedPaths.get(f.pdf.id), f.target);
  assert.equal(await f.pdf.getFilePathAsync(), f.target);
  assert.equal(f.files.has(f.oldPath), false);
  assert.match(String(f.calls.errors[0]), /Commit observer failed/);
});

check('转换提交状态无法核实时保留目标文件，并报告恢复位置', async f => {
  f.pdf.attachmentLinkMode = 0;
  const transaction = f.Zotero.DB.executeTransaction;
  f.Zotero.DB.executeTransaction = async (...args) => {
    await transaction(...args);
    throw new Error('Commit observer failed');
  };
  const query = f.Zotero.DB.valueQueryAsync;
  f.Zotero.DB.valueQueryAsync = async (sql, args) => {
    if (sql.startsWith('SELECT COUNT(*) FROM items')) throw new Error('Database unavailable');
    return query(sql, args);
  };
  const result = await f.rename([f.pdf]);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].message.includes(f.target));
  assert.equal(f.files.get(f.target), 'PDF');
  assert.equal(await f.pdfs()[0].getFilePathAsync(), f.target);
});

check('链接附件提交状态无法核实时不反向移动文件', async f => {
  const save = f.pdf.saveTx.bind(f.pdf);
  f.pdf.saveTx = async () => { await save(); throw new Error('Commit observer failed'); };
  const query = f.Zotero.DB.valueQueryAsync;
  f.Zotero.DB.valueQueryAsync = async (sql, args) => {
    if (sql.startsWith('SELECT path FROM itemAttachments')) throw new Error('Database unavailable');
    return query(sql, args);
  };
  const result = await f.rename([f.pdf]);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].message.includes(f.target));
  assert.equal(f.files.get(f.target), 'PDF');
  assert.equal(f.persistedPaths.get(f.pdf.id), f.target);
});

check('repair 删除失败时恢复批注及全文缓存，后续任务仍可成功', async f => {
  const annotation = f.addAnnotation(f.pdf);
  const cache = f.Zotero.Fulltext.getItemCacheFile(f.pdf).path;
  f.files.set(cache, 'Cache');
  f.indexes.set(f.pdf.id, 'Index');
  const erase = f.pdf.erase;
  f.pdf.erase = async function () { await erase.call(this); throw new Error('Erase failed'); };
  const result = await f.repair([f.pdf]);
  assert.equal(result.errors.length, 1);
  assert.equal(f.pdfs().length, 1);
  assert.equal(annotation.parentItemID, f.pdf.id);
  assert.equal(f.files.get(cache), 'Cache');
  assert.equal(f.indexes.get(f.pdf.id), 'Index');
  assert.equal(f.files.get(f.oldPath), 'PDF');
  f.pdf.erase = erase;
  assert.equal((await f.rename([f.pdf])).renamed, 1);
});

check('文件回滚冲突时不覆盖后来出现的文件，并报告原文件的保留位置', async f => {
  f.pdf.saveTx = async () => { f.files.set(f.oldPath, 'New file'); throw new Error('Save failed'); };
  const result = await f.rename([f.pdf]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /rollback failed/);
  assert.ok(result.errors[0].message.includes(f.target));
  assert.equal(f.files.get(f.oldPath), 'New file');
  assert.equal(f.files.get(f.target), 'PDF');
});

check('遍历父条目时跳过已不存在的子附件，不中断有效附件', async f => {
  f.parent.getAttachments = () => [999, f.pdf.id];
  const result = await f.rename([f.parent]);
  assert.equal(result.renamed, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(await f.opendir([f.parent]), f.paths.dirname(f.target));
});

check('viewItems 使用 repair 前的旧引用时仍打开新附件', async f => {
  assert.equal((await f.repair([f.pdf])).repaired, 1);
  const current = f.pdfs()[0];
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  try {
    await pane.viewItems([f.pdf]);
    assert.deepEqual(f.calls.viewed, [{ id: current.id, path: f.target }]);
    assert.deepEqual(f.calls.errors, []);
  } finally { restore(); }
});

check('顺序打开父条目及旧存储型附件引用时均使用新 ID', async f => {
  f.pdf.attachmentLinkMode = 0;
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  try {
    await pane.viewItems([f.parent, f.pdf]);
    const current = f.pdfs()[0];
    assert.deepEqual(f.calls.viewed, [
      { id: current.id, path: f.target }, { id: current.id, path: f.target },
    ]);
    assert.deepEqual(f.calls.erased, [f.pdf.id]);
    assert.deepEqual(f.calls.errors, []);
  } finally { restore(); }
});

check('只读附件仍可正常打开，但不改动文件或元数据', async f => {
  f.pdf.isEditable = () => false;
  const pane = f.window.ZoteroPane;
  const restore = f.open_rename(pane);
  try {
    await pane.viewItems([f.pdf]);
    assert.deepEqual(f.calls.viewed, [{ id: f.pdf.id, path: f.oldPath }]);
    assert.deepEqual(f.calls.saved, []);
    assert.equal(f.files.get(f.oldPath), 'PDF');
  } finally { restore(); }
});
