interface RenameResult {
  renamed: number;
  skipped: number;
  errors: { id: number; message: string }[];
}

function collectionDirectory(parent: Zotero.Item): string {
  const parts: string[] = [];
  let id: number | false = parent.getCollections()[0] || false;
  while (id) {
    const collection = Zotero.Collections.get(id);
    if (!collection) throw new Error(`Collection ${id} was not found`);
    parts.unshift(Zotero.File.getValidFileName(collection.name));
    id = collection.parentID;
  }
  const pref = Zotero.Prefs.get('baseAttachmentPath');
  const base = typeof pref === 'string' && pref ? pref : Zotero.getStorageDirectory().path;
  return PathUtils.join(base, ...parts);
}

async function renameAttachment(attachment: Zotero.Item): Promise<boolean> {
  const oldPath = await attachment.getFilePathAsync();
  // 独立附件没有父条目元数据，明确跳过，不猜测文件名。
  if (!oldPath || !attachment.parentItemID) return false;
  const parent = await Zotero.Items.getAsync(attachment.parentItemID);
  if (!parent) return false;
  const dir = collectionDirectory(parent);
  const basename = Zotero.Attachments.getFileBaseNameFromItem(parent, {
    attachmentTitle: parent.getField('title'),
  });
  const name = PathUtils.filename(oldPath);
  const target = PathUtils.join(dir, basename + name.slice(name.lastIndexOf('.')));
  // createUnique 的 -N 后缀也视为已命名，避免重名附件被反复移动。
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`^${escaped}(?:-\\d+)?\\.pdf$`, 'i').test(name);
  if (oldPath === target || (PathUtils.parent(oldPath) === dir && named)) return false;

  const previous = {
    mode: attachment.attachmentLinkMode,
    path: attachment.attachmentPath,
    title: attachment.getField('title'),
  };
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const movedPath = await Zotero.File.moveToUnique(oldPath, target);
  try {
    attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
    attachment.attachmentPath = movedPath;
    attachment.setField('title', basename);
    await attachment.saveTx();
  } catch (error) {
    // 保存失败时恢复原文件和内存元数据；不覆盖后来出现的文件。
    try {
      await IOUtils.move(movedPath, oldPath, { noOverwrite: true });
      attachment.attachmentLinkMode = previous.mode;
      attachment.attachmentPath = previous.path;
      attachment.setField('title', previous.title);
    } catch (rollbackError) {
      throw new Error(`${error}; rollback failed: ${rollbackError}; file: ${movedPath}`);
    }
    throw error;
  }
  return true;
}

async function open_rename(items: Zotero.Item[]): Promise<RenameResult> {
  const result: RenameResult = { renamed: 0, skipped: 0, errors: [] };
  for (const attachment of await pdfAttachments(items)) {
    try {
      if (await renameAttachment(attachment)) result.renamed++;
      else result.skipped++;
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      result.errors.push({ id: attachment.id, message: String(error) });
    }
  }
  return result;
}
