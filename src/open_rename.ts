// 父条目按规则整理子附件；单个附件只处理自身。
function open_rename(pane: _ZoteroTypes.ZoteroPane): () => void {
  const originalItems = pane.viewItems;
  const originalAttachment = pane.viewAttachment;
  const prepared = Symbol('AttachFlow');

  const wrappedItems: typeof originalItems = async function (
    items: Zotero.Item[], event?: Event, options: Record<string, unknown> = {},
  ) {
    for (const item of items) {
      const parent = item.isRegularItem();
      if (parent) await rename([item]);
      // 标记仅随本次打开传递，避免重复处理或影响并发打开。
      await originalItems.call(pane, [item], event, { ...options, [prepared]: parent });
    }
  };

  const wrappedAttachment: typeof originalAttachment = async function (...args: [number | number[], ...unknown[]]) {
    if (!(args[3] as { [prepared]?: boolean })?.[prepared]) {
      const original = args[0];
      const ids = Array.isArray(original) ? original : [original];
      const attachments = (await Zotero.Items.getAsync(ids)).filter(item => item.isAttachment());
      const result = await rename(attachments, { onlyMainPDF: false });
      // 存储型附件转换后会换成新条目，打开前换成实际存在的 ID。
      const replacement = new Map(result.replacements.map(({ from, to }) => [from, to]));
      const renewed = (id: number): number => replacement.get(id) ?? id;
      args = [Array.isArray(original) ? original.map(renewed) : renewed(original), ...args.slice(1)];
    }
    return originalAttachment.apply(pane, args);
  };

  pane.viewItems = wrappedItems;
  pane.viewAttachment = wrappedAttachment;
  return () => {
    if (pane.viewItems === wrappedItems) pane.viewItems = originalItems;
    if (pane.viewAttachment === wrappedAttachment) pane.viewAttachment = originalAttachment;
  };
}
