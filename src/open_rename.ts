// 拦截正常的打开流程：先整理附件，再交回 Zotero 打开，不另设快捷键。
function open_rename(pane: _ZoteroTypes.ZoteroPane): () => void {
  const original = pane.viewAttachment;
  const wrapped: typeof original = async function (...args: [number | number[], ...unknown[]]) {
    const ids = Array.isArray(args[0]) ? args[0] : [args[0]];
    await rename(await Zotero.Items.getAsync(ids));
    return original.apply(pane, args);
  };
  pane.viewAttachment = wrapped;
  return () => {
    if (pane.viewAttachment === wrapped) pane.viewAttachment = original;
  };
}
