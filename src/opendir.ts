async function pdfAttachments(items: Zotero.Item[]): Promise<Zotero.Item[]> {
  const found = new Map<number, Zotero.Item>();
  for (const item of items) {
    const attachments = item.isAttachment() ? [item]
      : item.isRegularItem() ? await Zotero.Items.getAsync(item.getAttachments()) : [];
    for (const attachment of attachments) {
      if (attachment.attachmentContentType === 'application/pdf') found.set(attachment.id, attachment);
    }
  }
  return [...found.values()];
}

async function opendir(items: Zotero.Item[]): Promise<string | null> {
  for (const attachment of await pdfAttachments(items)) {
    const path = await attachment.getFilePathAsync();
    if (!path) continue;
    const dir = PathUtils.parent(path);
    if (!dir) continue;
    await Zotero.launchFile(dir);
    return dir;
  }
  return null;
}
