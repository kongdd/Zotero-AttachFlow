interface AttachmentCommands {
  version: string;
  opendir: typeof opendir;
  rename: typeof rename;
}
interface TestCheck {
  name: string;
  passed: boolean;
  error?: string;
}
interface TestReport {
  date: string;
  pluginVersion: string;
  zoteroVersion: string;
  checks: TestCheck[];
  passed: boolean;
}

function runRuntimeTests(commands: AttachmentCommands): TestReport {
  const checks: [string, boolean][] = [
    ['真实 Zotero 对象', Zotero === Zotero.getMainWindow().Zotero],
    ['opendir 函数', typeof commands.opendir === 'function'],
    ['rename 函数', typeof commands.rename === 'function'],
    ['Zotero.launchFile', typeof Zotero.launchFile === 'function'],
    ['Zotero.File.moveToUnique', typeof Zotero.File.moveToUnique === 'function'],
    ['Zotero.Item.saveTx', typeof Zotero.Item.prototype.saveTx === 'function'],
  ];
  return {
    date: new Date().toISOString(),
    pluginVersion: commands.version,
    zoteroVersion: Zotero.version,
    checks: checks.map(([name, passed]) => ({ name, passed })),
    passed: checks.every(([, passed]) => passed),
  };
}
