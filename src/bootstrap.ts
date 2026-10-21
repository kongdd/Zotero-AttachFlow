interface AttachmentPlugin extends AttachmentCommands {
  windows: Map<Window, () => void>;
  pending: Promise<string | null | RenameResult> | null;
}
type ZoteroWithTools = typeof Zotero & { AttachmentTools?: AttachmentPlugin };
let attachmentPlugin: AttachmentPlugin | undefined;

function install(): void {}
function uninstall(): void {}

async function startup({ version }: { version: string }): Promise<void> {
  const plugin: AttachmentPlugin = {
    version,
    opendir,
    rename,
    windows: new Map(),
    pending: null,
  };
  attachmentPlugin = plugin;
  (Zotero as ZoteroWithTools).AttachmentTools = plugin;
  for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
  Zotero.Server.Endpoints[testEndpoint] = AttachmentTestEndpoint;
}

function onMainWindowLoad({ window }: { window: Window }): void {
  const plugin = attachmentPlugin;
  if (!plugin || plugin.windows.has(window)) return;
  const pane = (window as _ZoteroTypes.MainWindow).ZoteroPane;
  const restoreOpen = open_rename(pane);
  const handler = (event: KeyboardEvent): void => {
    const command = shortcutCommand(event, Zotero.isMac);
    if (!command) return;
    const items = pane.getSelectedItems();
    if (!items.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plugin.pending) return;
    plugin.pending = plugin[command](items)
      .then(result => {
        if (result && typeof result === 'object' && result.errors.length) {
          Zotero.alert(window, 'Zotero-AttachFlow', result.errors.map(error => error.message).join('\n'));
        }
        return result;
      })
      .catch(error => {
        Zotero.logError(error instanceof Error ? error : new Error(String(error)));
        Zotero.alert(window, 'Zotero-AttachFlow', String(error));
        return null;
      })
      .finally(() => { plugin.pending = null; });
  };
  window.addEventListener('keydown', handler, true);
  plugin.windows.set(window, () => {
    window.removeEventListener('keydown', handler, true);
    restoreOpen();
  });
}

function onMainWindowUnload({ window }: { window: Window }): void {
  attachmentPlugin?.windows.get(window)?.();
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
