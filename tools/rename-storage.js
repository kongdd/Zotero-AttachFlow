// 在 Zotero「运行 JavaScript」中使用，并勾选异步模式。
// 需安装新版 AttachFlow；仅处理个人库中有父条目的存储型主 PDF、Word，排除回收站。
// 执行后会移动文件并转为链接附件，不再参与 Zotero 附件同步。
const execute = false; // 默认仅预览；确认清单后改为 true。
const batchSize = 100; // 每批扫描的候选附件数，不是父条目数。
const afterID = 0; // 首批为 0；本批处理完成后，填入返回的 nextAfterID。
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(afterID) || afterID < 0) {
  throw new Error('batchSize 必须为正整数，afterID 必须为非负整数。');
}

const scope = `
  FROM itemAttachments a
  JOIN items i USING (itemID)
  WHERE i.libraryID = ?
    AND a.path LIKE ?
    AND (
      a.contentType = 'application/pdf'
      OR lower(a.path) LIKE ?
      OR lower(a.path) LIKE ?
    )
    AND a.parentItemID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM deletedItems d
      WHERE d.itemID IN (a.itemID, a.parentItemID)
    )
`;
const params = [Zotero.Libraries.userLibraryID, 'storage:%', '%.doc', '%.docx'];
// 总数尚未排除非主 PDF、SI 和缺失文件；每次运行按当前数据库重新统计。
const totalCandidates = await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) ${scope}`, params);
// 不使用 OFFSET：执行后 storage: 记录减少，偏移分页会漏掉附件。
const ids = await Zotero.DB.columnQueryAsync(`
  SELECT a.itemID ${scope}
    AND a.itemID > ?
  ORDER BY a.itemID
  LIMIT ?
`, [...params, afterID, batchSize + 1]);
const hasMore = ids.length > batchSize;
if (hasMore) ids.pop();

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

const report = {
  totalCandidates,
  scanned: ids.length,
  eligible: attachments.length,
  nextAfterID: ids.length ? ids[ids.length - 1] : afterID,
  hasMore,
};
if (!execute) {
  return {
    ...report,
    attachments: attachments.map(a => ({
      attachmentID: a.id,
      parentID: a.parentItemID,
      path: a.attachmentPath,
    })),
  };
}

// 有 errors 时先处理失败项，再推进游标；预览不会保存进度。
return { ...report, result: await Zotero.AttachmentTools.rename(attachments) };
