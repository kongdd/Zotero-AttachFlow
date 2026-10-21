const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { check, key, source, bootstrap } = require('./helpers.cjs');

test('Zotero 10 manifest 必填项', () => {
  const manifest = require('../../manifest.json');
  for (const key of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) {
    assert.ok(manifest.applications.zotero[key], `Missing ${key}`);
  }
  assert.equal(manifest.version, require('../../package.json').version);
  assert.equal(manifest.name, 'Zotero-AttachFlow');
  assert.equal(manifest.applications.zotero.id, 'attachment-tools@kongdd');
});

check('快捷键仅接受 Windows Ctrl / macOS Cmd', (f, isWin) => {
  assert.equal(f.shortcutCommand(key('e', isWin), !isWin), 'opendir');
  assert.equal(f.shortcutCommand(key('r', isWin), !isWin), 'rename');
  assert.equal(f.shortcutCommand(key('e', !isWin), !isWin), null);
  for (const change of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true }]) {
    assert.equal(f.shortcutCommand(key('r', isWin, change), !isWin), null);
  }
  assert.equal(f.shortcutCommand(key('r', isWin, { composedPath: () => [{ closest: () => ({}) }] }), !isWin), null);
});

check('插件不拦截原生复制快捷键及已移除的测试快捷键', async (f, isWin) => {
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

check('插件生命周期、快捷键互斥与失败后恢复', async (f, isWin) => {
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
