// 直接调用本插件的本地端点；不加载外部 JS，也不依赖其他插件。
const mode = process.argv[2] || 'runtime';
if (!['runtime', 'integration'].includes(mode)) throw new Error('Expected runtime or integration.');
const port = Number(process.env.ZOTERO_PORT || 23119);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ZOTERO_PORT.');

async function main() {
  console.log(`Requested ${mode} tests; approve the confirmation in Zotero.`);
  const response = await fetch(`http://127.0.0.1:${port}/attachment-tools/tests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Zotero-Allowed-Request': 'true' },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Zotero HTTP ${response.status}: ${await response.text()}`);
  const report = await response.json();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
main().catch(error => {
  console.error(String(error));
  console.error('Start Zotero with Zotero-AttachFlow installed; keep its local HTTP server enabled.');
  process.exitCode = 1;
});
