// 开发阶段借现有调试桥测试函数或安装 XPI；两种操作都需用户确认。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'test';
if (!['test', 'install'].includes(mode)) throw new Error('Expected test or install.');
const manifest = require('../manifest.json');
const xpi = path.join(root, 'dist', `${manifest.name}-${manifest.version}.xpi`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-tools-test-'));
const reportPath = path.join(dir, 'report.json');
const code = `
  let report;
  try {
    if (${JSON.stringify(mode)} === 'install') {
      const { AddonManager } = window.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const file = Zotero.getTempDirectory();
      file.append('Zotero-AttachFlow-' + Date.now() + '.xpi');
      await window.IOUtils.copy(${JSON.stringify(xpi)}, file.path);
      const installation = await AddonManager.getInstallForFile(file);
      if (installation.error) {
        const messages = window.Services.console.getMessageArray()
          .map(message => message.message).filter(message => /Invalid XPI|attachment-tools|AttachFlow|manifest/i.test(message)).slice(-6);
        throw new Error(JSON.stringify({ code: installation.error, state: installation.state, messages }));
      }
      await installation.install();
      await window.IOUtils.remove(file.path);
      const addon = await AddonManager.getAddonByID('attachment-tools@kongdd');
      report = { passed: !!addon?.isActive && !!Zotero.AttachmentTools, version: addon?.version };
    } else {
    const source = await Zotero.File.getContentsAsync(${JSON.stringify(path.join(root, 'build/functions.js'))});
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const run = new AsyncFunction('Zotero', 'PathUtils', 'IOUtils', source +
      '\\nreturn await runIntegrationTests({version: "prototype", opendir, rename});');
    report = await run(Zotero, window.PathUtils, window.IOUtils);
    }
  } catch (error) { report = { passed: false, error: String(error), stack: error.stack }; }
  await Zotero.File.putContentsAsync(${JSON.stringify(reportPath)}, JSON.stringify(report, null, 2));
`;
const url = 'zotero://ztoolkit-debug/?app=attachment-tools-prototype&run=' + encodeURIComponent(code);
const command = process.platform === 'darwin' ? ['open', '-a', 'Zotero', url]
  : process.platform === 'win32' ? ['powershell.exe', '-NoProfile', '-Command', `Start-Process '${url.replaceAll("'", "''")}'`]
    : ['xdg-open', url];
let finished = false;
function finish(error, report) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  watcher.close();
  if (report) console.log(JSON.stringify(report, null, 2));
  if (error) console.error(String(error));
  console.log(`Report: ${reportPath}`);
  process.exitCode = error || !report?.passed ? 1 : 0;
}
const watcher = fs.watch(dir, () => {
  let report;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { return; }
  finish(null, report);
});
const timer = setTimeout(() => finish(new Error('Timed out waiting for Zotero.')), 120_000);
const child = spawn(command[0], command.slice(1), { stdio: 'ignore' });
child.on('error', error => finish(error));
child.on('exit', code => { if (code) finish(new Error(`Could not open Zotero (${code}).`)); });
console.log(`Allow ${mode} in Zotero. ${mode === 'install' ? 'This installs the locally built XPI.' : 'Only temporary test fixtures are used.'}`);
