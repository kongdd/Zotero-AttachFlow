// 在 Zotero「运行 JavaScript」中使用，并勾选异步模式。
// 需安装新版 AttachFlow；仅处理个人库中有父条目的存储型主 PDF、Word，排除回收站。
// 执行后会移动文件并转为链接附件，不再参与 Zotero 附件同步。
const execute = false; // 默认仅预览；确认清单后改为 true。

const ids = await Zotero.DB.columnQueryAsync(`
  SELECT a.itemID
  FROM itemAttachments a
  JOIN items i USING (itemID)
  WHERE i.libraryID = ?
    AND a.path LIKE 'storage:%'
    AND (
      a.contentType = 'application/pdf'
      OR lower(a.path) LIKE '%.doc'
      OR lower(a.path) LIKE '%.docx'
    )
    AND a.parentItemID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM deletedItems d
      WHERE d.itemID IN (a.itemID, a.parentItemID)
    )
`, [Zotero.Libraries.userLibraryID]);

const supplementary = /(?:^|[\s_.-])(?:si\d*|mmc\d+|moesm\d*|supplement(?:ary|al)?(?:information|materials?)?|supporting(?:information)?)(?:$|[\s_.-])|补充材料/i;
const attachments = [];
for (const attachment of await Zotero.Items.getAsync(ids)) {
  const path = await attachment.getFilePathAsync();
  if (!path) continue;
  if (attachment.attachmentContentType === 'application/pdf') {
    const parent = await Zotero.Items.getAsync(attachment.parentItemID);
    const main = parent && await parent.getBestAttachment();
    if (!main || main.id !== attachment.id) continue;
    const name = path.split(/[\\/]/).pop();
    if (supplementary.test(name) || supplementary.test(attachment.getField('title'))) continue;
  }
  attachments.push(attachment);
}

if (!execute) {
  return attachments.map(a => ({
    attachmentID: a.id,
    parentID: a.parentItemID,
    path: a.attachmentPath,
  }));
}

return await Zotero.AttachmentTools.rename(attachments);
