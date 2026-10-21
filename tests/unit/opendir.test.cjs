const assert = require('node:assert/strict');
const { check } = require('./helpers.cjs');

check('opendir 支持父条目和附件，返回系统目录', async f => {
  for (const item of [f.parent, f.pdf]) assert.equal(await f.opendir([item]), f.paths.dirname(f.oldPath));
  assert.equal(f.calls.opened.length, 2);
});

check('opendir 跳过缺失文件和非 PDF', async f => {
  assert.equal(await f.opendir([f.other]), null);
  f.files.clear();
  assert.equal(await f.opendir([f.other, f.pdf]), null);
  assert.equal(f.calls.opened.length, 0);
});
