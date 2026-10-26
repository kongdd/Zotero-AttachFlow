// 在 Zotero「运行 JavaScript」中使用，并勾选异步模式。
// 需安装新版 AttachFlow；修复本地已转为链接文件、服务器仍记为存储型而导致的同步 400。
// 判定依据：同步缓存中该附件最近一次上传的类型为 imported_file/imported_url。
const execute = false; // 默认仅预览；确认清单后改为 true。

const syncType = "(SELECT syncObjectTypeID FROM syncObjectTypes WHERE name = 'item')";
const scope = `
  FROM itemAttachments a
  JOIN items i USING (itemID)
  JOIN syncCache c
    ON c.libraryID = i.libraryID AND c.key = i.key AND c.syncObjectTypeID = ${syncType}
   AND c.version = (
     SELECT MAX(s.version) FROM syncCache s
     WHERE s.libraryID = i.libraryID AND s.key = i.key AND s.syncObjectTypeID = ${syncType}
   )
  WHERE i.libraryID = ?
    AND a.linkMode = ?
    AND COALESCE(json_extract(c.data, '$.data.linkMode'), json_extract(c.data, '$.linkMode'))
      IN ('imported_file', 'imported_url')
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
