// 原型阶段：借现有调试桥进入 Zotero，直接测试函数，不注册插件或动作。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-tools-test-'));
const reportPath = path.join(dir, 'report.json');
const code = `
  let report;
  try {
    const source = await Zotero.File.getContentsAsync(${JSON.stringify(path.join(root, 'build/functions.js'))});
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const run = new AsyncFunction('Zotero', 'PathUtils', 'IOUtils', source +
      '\\nreturn await runIntegrationTests({version: "prototype", opendir, open_rename});');
    report = await run(Zotero, window.PathUtils, window.IOUtils);
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
console.log('Allow the prototype test in Zotero. No plugin is installed by this command.');
