interface AttachmentPlugin extends AttachmentCommands {
  windows: Map<Window, (event: KeyboardEvent) => void>;
  pending: Promise<string | null | RenameResult> | null;
  busy: boolean;
}
type ZoteroWithTools = typeof Zotero & { AttachmentTools?: AttachmentPlugin };
let attachmentPlugin: AttachmentPlugin | undefined;
let testsRunning = false;
const testEndpoint = '/attachment-tools/tests';

function install(): void {}
function uninstall(): void {}

async function startup({ version }: { version: string }): Promise<void> {
  const plugin: AttachmentPlugin = {
    version,
    opendir,
    open_rename,
    windows: new Map(),
    pending: null,
    busy: false,
  };
  attachmentPlugin = plugin;
  (Zotero as ZoteroWithTools).AttachmentTools = plugin;
  for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
  Zotero.Server.Endpoints[testEndpoint] = AttachmentTestEndpoint;
}

function onMainWindowLoad({ window }: { window: Window }): void {
  const plugin = attachmentPlugin;
  if (!plugin || plugin.windows.has(window)) return;
  const handler = (event: KeyboardEvent): void => {
    const command = shortcutCommand(event, Zotero.isMac);
    if (!command) return;
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
    if (!items.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plugin.busy || testsRunning) return;
    plugin.busy = true;
    plugin.pending = (command === 'opendir' ? plugin.opendir(items) : plugin.open_rename(items))
      .then(result => {
        if (result && typeof result === 'object' && result.errors.length) {
          Zotero.alert(window, 'Attachment Tools', result.errors.map(error => error.message).join('\n'));
        }
        return result;
      })
      .catch(error => {
        Zotero.logError(error instanceof Error ? error : new Error(String(error)));
        Zotero.alert(window, 'Attachment Tools', String(error));
        return null;
      })
      .finally(() => { plugin.busy = false; });
  };
  window.addEventListener('keydown', handler, true);
  plugin.windows.set(window, handler);
}

function onMainWindowUnload({ window }: { window: Window }): void {
  const handler = attachmentPlugin?.windows.get(window);
  if (handler) window.removeEventListener('keydown', handler, true);
  attachmentPlugin?.windows.delete(window);
}

function shutdown(): void {
  for (const window of attachmentPlugin?.windows.keys() || []) onMainWindowUnload({ window });
  if (Zotero.Server.Endpoints[testEndpoint] === AttachmentTestEndpoint) {
    delete Zotero.Server.Endpoints[testEndpoint];
  }
  delete (Zotero as ZoteroWithTools).AttachmentTools;
  attachmentPlugin = undefined;
}

// 仅提供两种内置测试，不接受代码或文件路径；执行前必须由用户确认。
class AttachmentTestEndpoint {
  supportedMethods = ['POST'];
  supportedDataTypes = ['application/json'];
  permitBookmarklet = false;

  async init({ data }: { data: unknown }): Promise<[number, string, string]> {
    const mode = (data as { mode?: unknown } | null)?.mode;
    if (mode !== 'runtime' && mode !== 'integration') return [400, 'text/plain', 'Invalid test mode'];
    const plugin = attachmentPlugin;
    if (!plugin || plugin.busy || testsRunning) return [409, 'text/plain', 'Plugin is busy'];
    const window = Zotero.getMainWindow();
    const message = mode === 'integration'
      ? '运行 Attachment Tools 集成测试？将创建临时条目和 PDF、移动文件、调用文件管理器，完成后清理。不会处理现有附件。'
      : '运行 Attachment Tools 只读环境检查？';
    if (!window?.confirm(message)) return [403, 'text/plain', 'Cancelled'];
    testsRunning = true;
    try {
      const report = mode === 'runtime' ? runRuntimeTests(plugin) : await runIntegrationTests(plugin);
      return [200, 'application/json', JSON.stringify(report)];
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      return [500, 'application/json', JSON.stringify({ passed: false, error: String(error) })];
    } finally {
      testsRunning = false;
    }
  }
}
