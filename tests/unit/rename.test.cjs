const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { check, siPDFs } = require('./helpers.cjs');

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

check('多个 PDF 仅处理 Zotero 默认附件，其他附件保持不变', async f => {
  const extra = f.addAttachment('extra.pdf', 'Extra PDF');
  f.parent.getAttachments = () => [4, 2, 3];
  assert.equal((await f.rename([f.parent, extra])).renamed, 1);
  assert.deepEqual(f.calls.saved, [2]);
  assert.equal(f.files.get(extra.attachmentPath), 'Extra PDF');
  assert.equal(extra.title, 'Original');
  assert.equal((await f.rename([extra])).skipped, 1);
});

check('默认附件不存在或不是 PDF 时，不猜测其他 PDF', async f => {
  for (const best of [false, f.other]) {
    f.parent.getBestAttachment = async () => best;
    assert.equal((await f.rename([f.pdf])).skipped, 1);
  }
  assert.deepEqual(f.calls.saved, []);
});

check('默认附件有明确 SI 标识时跳过，避免误改正文角色', async f => {
  for (const [name, title] of siPDFs) {
    f.files.clear();
    f.pdf.attachmentPath = f.paths.join(f.base, name);
    f.pdf.title = title;
    f.files.set(f.pdf.attachmentPath, 'SI PDF');
    assert.equal((await f.rename([f.pdf])).skipped, 1);
    assert.equal(f.files.get(f.pdf.attachmentPath), 'SI PDF');
  }
  assert.deepEqual(f.calls.saved, []);
});

check('SI 识别不误伤包含 si 字母的普通文件名', async f => {
  for (const name of ['signal.pdf', 'simulation.pdf', 'simple.pdf']) {
    f.files.clear();
    f.pdf.attachmentPath = f.paths.join(f.base, name);
    f.files.set(f.pdf.attachmentPath, 'PDF');
    assert.equal((await f.rename([f.pdf])).renamed, 1);
  }
});

check('批处理预览排除 SI，保留 Word，且不执行重命名', async f => {
  f.addAttachment('SI1.docx', 'Word', { attachmentContentType: 'application/msword' });
  f.Zotero.Libraries = { userLibraryID: 1 };
  f.Zotero.DB = {
    columnQueryAsync: async () => [2, 4],
    valueQueryAsync: async () => 2,
  };
  const script = fs.readFileSync(path.join(__dirname, '../../tools/rename-storage.js'), 'utf8');
  for (const [name, title] of siPDFs) {
    f.pdf.attachmentPath = f.paths.join(f.base, name);
    f.pdf.title = title;
    f.files.set(f.pdf.attachmentPath, 'SI PDF');
    const preview = await vm.runInNewContext(`(async () => {${script}})()`, { ...f.scope });
    assert.equal(preview.totalCandidates, 2);
    assert.equal(preview.scanned, 2);
    assert.equal(preview.eligible, 1);
    assert.equal(preview.nextAfterID, 4);
    assert.equal(preview.hasMore, false);
    assert.deepEqual(Array.from(preview.attachments, row => row.attachmentID), [4]);
  }
  assert.deepEqual(f.calls.saved, []);
});

check('批处理游标跨过空批，候选减少后仍不漏项', async f => {
  f.pdf.title = 'Supporting Information';
  f.addAttachment('one.docx', 'Word', { attachmentContentType: 'application/msword' });
  f.addAttachment('two.docx', 'Word', { attachmentContentType: 'application/msword' });
  let ids = [2, 4, 5];
  f.Zotero.Libraries = { userLibraryID: 1 };
  f.Zotero.DB = {
    valueQueryAsync: async () => ids.length,
    columnQueryAsync: async (sql, [libraryID, storage, doc, docx, afterID, limit]) => {
      assert.equal(libraryID, 1);
      assert.deepEqual([storage, doc, docx], ['storage:%', '%.doc', '%.docx']);
      assert.match(sql, /ORDER BY a\.itemID/);
      assert.doesNotMatch(sql, /OFFSET/i);
      return ids.filter(id => id > afterID).slice(0, limit);
    },
  };
  const script = fs.readFileSync(path.join(__dirname, '../../tools/rename-storage.js'), 'utf8')
    .replace('const batchSize = 100;', 'const batchSize = 1;');
  const preview = afterID => vm.runInNewContext(`(async () => {${script.replace(
    'const afterID = 0;', `const afterID = ${afterID};`,
  )}})()`, { ...f.scope });
  const first = await preview(0);
  assert.equal(first.eligible, 0);
  assert.equal(first.nextAfterID, 2);
  assert.equal(first.hasMore, true);
  const second = await preview(first.nextAfterID);
  assert.deepEqual(Array.from(second.attachments, row => row.attachmentID), [4]);
  ids = [2, 5]; // 模拟附件 4 执行后不再是 storage: 附件。
  const third = await preview(second.nextAfterID);
  assert.equal(third.totalCandidates, 2);
  assert.deepEqual(Array.from(third.attachments, row => row.attachmentID), [5]);
  assert.equal(third.hasMore, false);
  const empty = await preview(third.nextAfterID);
  assert.equal(empty.scanned, 0);
  assert.equal(empty.nextAfterID, 5);
  assert.equal(empty.hasMore, false);
  assert.deepEqual(f.calls.saved, []);
});

check('Word 保留扩展名、保护重名，重复执行不再移动', async f => {
  for (const extension of ['doc', 'docx', 'DOCX']) {
    const word = f.addAttachment(`supplement.${extension}`, 'Word', {
      attachmentContentType: 'application/octet-stream',
    });
    const target = f.paths.join(f.paths.dirname(f.target), `Paper.${extension}`);
    f.files.set(target, 'Existing Word');
    assert.equal((await f.rename([word])).renamed, 1);
    assert.equal(f.files.get(target), 'Existing Word');
    assert.equal(word.attachmentPath.endsWith(`.${extension}`), true);
    assert.equal((await f.rename([word])).skipped, 1);
    assert.equal(f.files.get(word.attachmentPath), 'Word');
  }
});

check('并发重命名同一附件只移动一次，不报源文件不存在', async f => {
  const results = await Promise.all([f.rename([f.pdf]), f.rename([f.pdf])]);
  assert.equal(results.reduce((sum, result) => sum + result.renamed, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.deepEqual(f.calls.saved, [2]);
  assert.equal(f.files.get(f.target), 'PDF');
});

check('同一附件的不同入口规则依次判断，不复用其他请求的跳过结果', async f => {
  const extra = f.addAttachment('extra.pdf', 'Extra PDF');
  const [batch, direct] = await Promise.all([
    f.rename([extra]), f.rename([extra], { onlyMainPDF: false }),
  ]);
  assert.equal(batch.skipped, 1);
  assert.equal(direct.renamed, 1);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
});

check('同附件任务失败回滚后，后续排队任务仍可重试成功', async f => {
  let attempts = 0;
  f.pdf.saveTx = async () => {
    if (!attempts++) throw new Error('Temporary database failure');
    f.calls.saved.push(f.pdf.id);
  };
  const [first, second] = await Promise.all([f.rename([f.pdf]), f.rename([f.pdf])]);
  assert.equal(first.errors.length, 1);
  assert.equal(second.renamed, 1);
  assert.deepEqual(f.calls.saved, [2]);
  assert.equal(f.files.get(f.target), 'PDF');
  assert.equal(f.files.has(f.oldPath), false);
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

check('并发整理同父条目的不同 PDF 时不覆盖文件', async f => {
  const extra = f.addAttachment('extra.pdf', 'Extra PDF');
  const results = await Promise.all([
    f.rename([f.pdf], { onlyMainPDF: false }),
    f.rename([extra], { onlyMainPDF: false }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.renamed, 0), 2);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.notEqual(f.pdf.attachmentPath, extra.attachmentPath);
  assert.equal(f.files.get(f.pdf.attachmentPath), 'PDF');
  assert.equal(f.files.get(extra.attachmentPath), 'Extra PDF');
  assert.equal((await f.rename([extra], { onlyMainPDF: false })).skipped, 1);
});

check('共享源文件时复制，仅更新当前附件，兼容相对路径及其他父条目', async f => {
  for (const attachmentPath of [f.oldPath, 'attachments:storage/old.pdf']) {
    f.pdf.attachmentPath = f.oldPath;
    f.files.set(f.oldPath, 'PDF');
    const sibling = f.addAttachment('unused.pdf', 'PDF', {
      attachmentPath, attachmentLinkMode: 2, parentItemID: 100, title: 'Original',
    });
    assert.equal((await f.rename([f.pdf])).renamed, 1);
    assert.equal(f.files.get(f.pdf.attachmentPath), 'PDF');
    assert.equal(f.files.get(f.oldPath), 'PDF');
    assert.equal(await sibling.getFilePathAsync(), f.oldPath);
    assert.equal(sibling.attachmentPath, attachmentPath);
    assert.equal(sibling.title, 'Original');
    assert.equal(f.calls.saved.includes(sibling.id), false);
    f.records.delete(sibling.id);
  }
});

check('并发整理共享源文件的链接附件，均保留独立有效的目标', async f => {
  f.pdf.attachmentLinkMode = 2;
  const sibling = f.addAttachment('unused.pdf', 'PDF', { attachmentPath: f.oldPath });
  const results = await Promise.all([
    f.rename([f.pdf], { onlyMainPDF: false }),
    f.rename([sibling], { onlyMainPDF: false }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.renamed, 0), 2);
  assert.equal(results.reduce((sum, result) => sum + result.errors.length, 0), 0);
  assert.notEqual(f.pdf.attachmentPath, sibling.attachmentPath);
  assert.equal(f.files.get(f.pdf.attachmentPath), 'PDF');
  assert.equal(f.files.get(sibling.attachmentPath), 'PDF');
});

check('共享源文件复制后保存失败，删除副本并恢复元数据', async f => {
  const sibling = f.addAttachment('unused.pdf', 'PDF', {
    attachmentPath: f.oldPath, attachmentLinkMode: 2,
  });
  f.pdf.saveTx = async () => { throw new Error('Database failure'); };
  assert.equal((await f.rename([f.pdf])).errors.length, 1);
  assert.equal(f.files.get(f.oldPath), 'PDF');
  assert.equal(f.files.has(f.target), false);
  assert.equal(await sibling.getFilePathAsync(), f.oldPath);
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  assert.equal(f.pdf.attachmentLinkMode, 0);
  assert.equal(f.pdf.title, 'Original');
});

check('非重名错误立即失败，不修改元数据或删除源文件', async f => {
  let attempts = 0;
  f.files.set(f.target, 'Existing PDF');
  f.scope.IOUtils.move = async () => { attempts++; throw new Error('Permission denied'); };
  assert.equal((await f.rename([f.pdf])).errors.length, 1);
  assert.equal(attempts, 1);
  assert.equal(f.files.get(f.oldPath), 'PDF');
  assert.equal(f.files.get(f.target), 'Existing PDF');
  assert.equal(f.pdf.attachmentPath, f.oldPath);
  assert.deepEqual(f.calls.saved, []);
});

check('独立附件、缺失文件和空选择安全跳过', async f => {
  f.pdf.parentItemID = null;
  assert.equal((await f.rename([f.pdf])).skipped, 1);
  f.files.clear();
  assert.equal((await f.rename([f.pdf])).skipped, 1);
  assert.equal((await f.rename([])).renamed, 0);
});
