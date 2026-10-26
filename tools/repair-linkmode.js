// 在 Zotero「运行 JavaScript」中使用，并勾选异步模式。
// 需安装新版 AttachFlow；修复此前直接被改 linkMode、导致同步 400 的附件。
// 判定依据：本地已转为链接文件，却仍保留存储型附件的同步信息（storageModTime/storageHash）。
const execute = false; // 默认仅预览；确认清单后改为 true。

const scope = `
  FROM itemAttachments a
  JOIN items i USING (itemID)
  WHERE i.libraryID = ?
    AND a.linkMode = ?
    AND (a.storageModTime IS NOT NULL OR a.storageHash IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM deletedItems d
      WHERE d.itemID = a.itemID
    )
`;
const params = [Zotero.Libraries.userLibraryID, Zotero.Attachments.LINK_MODE_LINKED_FILE];
const ids = await Zotero.DB.columnQueryAsync(`SELECT a.itemID ${scope} ORDER BY a.itemID`, params);
const attachments = [];
// 文件已在外部目录，重建条目不再移动文件，只迁移批注、笔记和全文索引。
for (const attachment of await Zotero.Items.getAsync(ids)) {
  const path = await attachment.getFilePathAsync();
  if (path) attachments.push({ attachmentID: attachment.id, parentID: attachment.parentItemID, path });
}

const report = { candidates: ids.length, eligible: attachments.length };
if (!execute) return { ...report, attachments };
const items = await Zotero.Items.getAsync(attachments.map(row => row.attachmentID));
return { ...report, result: await Zotero.AttachmentTools.repair(items) };
