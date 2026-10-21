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
  f.Zotero.DB = { columnQueryAsync: async () => [2, 4] };
  const script = fs.readFileSync(path.join(__dirname, '../../tools/rename-storage.js'), 'utf8');
  for (const [name, title] of siPDFs) {
    f.pdf.attachmentPath = f.paths.join(f.base, name);
    f.pdf.title = title;
    f.files.set(f.pdf.attachmentPath, 'SI PDF');
    const preview = await vm.runInNewContext(`(async () => {${script}})()`, { ...f.scope });
    assert.deepEqual(Array.from(preview, row => row.attachmentID), [4]);
  }
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

check('独立附件、缺失文件和空选择安全跳过', async f => {
  f.pdf.parentItemID = null;
  assert.equal((await f.rename([f.pdf])).skipped, 1);
  f.files.clear();
  assert.equal((await f.rename([f.pdf])).skipped, 1);
  assert.equal((await f.rename([])).renamed, 0);
});
