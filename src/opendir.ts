async function itemAttachments(items: Zotero.Item[]): Promise<Zotero.Item[]> {
  const found = new Map<number, Zotero.Item>();
  for (const item of items) {
    const attachments = item.isAttachment() ? [item]
      : item.isRegularItem() ? await Zotero.Items.getAsync(item.getAttachments()) : [];
    for (const attachment of attachments) found.set(attachment.id, attachment);
  }
  return [...found.values()];
}

async function opendir(items: Zotero.Item[]): Promise<string | null> {
  for (const attachment of await itemAttachments(items)) {
    if (attachment.attachmentContentType !== 'application/pdf') continue;
    const path = await attachment.getFilePathAsync();
    if (!path) continue;
    const dir = PathUtils.parent(path);
    if (!dir) continue;
    await Zotero.launchFile(dir);
    return dir;
  }
  return null;
}
