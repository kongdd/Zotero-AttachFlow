interface RenameResult {
  renamed: number;
  skipped: number;
  errors: { id: number; message: string }[];
  // 存储型附件转链接附件会替换条目，调用方据此更新待打开的附件 ID。
  replacements: { from: number; to: number }[];
}
interface RepairResult {
  repaired: number;
  skipped: number;
  errors: { id: number; message: string }[];
}
interface RenameOutcome {
  renamed: boolean;
  attachment: Zotero.Item;
}
// toJSON 未覆盖的附件字段。
type AttachmentJSON = ReturnType<Zotero.Item['toJSON']> & {
  linkMode?: string;
  path?: string;
  filename?: string;
};

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

async function transferToUnique(source: string, target: string, copy: boolean): Promise<string> {
  const dot = target.lastIndexOf('.');
  for (let suffix = 0; ; suffix++) {
    const path = suffix ? `${target.slice(0, dot)}-${suffix}${target.slice(dot)}` : target;
    try {
      // 不先检查再移动：由文件系统拒绝覆盖，避免并发请求选中同一目标。
      if (copy) await IOUtils.copy(source, path, { noOverwrite: true });
      else await IOUtils.move(source, path, { noOverwrite: true });
      return path;
    } catch (error) {
      if ((error as Error)?.name !== 'NoModificationAllowedError' || !(await IOUtils.exists(path))) {
        throw error;
      }
    }
  }
}

// 同步服务不接受修改已有附件的 linkMode，按 Zotero 自身转换方式重建：新建链接附件，迁移批注和笔记，再删除旧附件。
async function replaceWithLinkedFile(attachment: Zotero.Item, path: string, title: string): Promise<Zotero.Item> {
  const json = { ...attachment.toJSON(), linkMode: 'linked_file', path, title } as AttachmentJSON;
  delete json.filename; // 链接附件使用 path，不继承存储目录的 filename。
  const linked = new Zotero.Item('attachment');
  linked.libraryID = attachment.libraryID;
  linked.fromJSON(json);
  // 批注和笔记统一迁移，含回收站条目；外部批注仍随文件保留。
  const children = [
    ...attachment.getAnnotations(true).filter(item => !item.annotationIsExternal),
    ...Zotero.Items.get(attachment.getNotes(true)),
  ];
  // toJSON 只含自身关系，另外保留指向旧附件的入向关系。
  const relations = await Zotero.Relations.getByObject('item', Zotero.URI.getItemURI(attachment));
  const affected = new Set([attachment, ...children, ...relations.map(({ subject }) => subject)]);
  const parent = attachment.parentItemID && await Zotero.Items.getAsync(attachment.parentItemID);
  if (parent) affected.add(parent);
  const cache = Zotero.Fulltext.getItemCacheFile(attachment).path;
  let linkedCache: string | undefined;
  try {
    // 创建、迁移与删除共用事务；删除失败时不会留下已迁走的批注。
    await Zotero.DB.executeTransaction(async () => {
      await linked.save();
      for (const child of children) {
        child.parentID = linked.id;
        await child.save();
      }
      for (const { subject, predicate } of relations) {
        if (!subject.isEditable()) continue;
        subject.addRelation(predicate, Zotero.URI.getItemURI(linked));
        await subject.save({ skipDateModifiedUpdate: true });
      }
      await Zotero.Attachments.createDirectoryForItem(linked);
      linkedCache = Zotero.Fulltext.getItemCacheFile(linked).path;
      // 全文索引失败可重建，但调用必须位于事务中。
      await Zotero.Fulltext.transferItemIndex(attachment, linked).catch(error => Zotero.logError(error));
      await attachment.erase();
    });
  } catch (error) {
    // 数据库会回滚，内存条目和已移动的全文缓存需另外恢复。
    for (const item of affected) {
      await item.reload(['primaryData', 'childItems', 'relations'], true).catch(error => Zotero.logError(error));
    }
    if (linkedCache && await IOUtils.exists(linkedCache) && !(await IOUtils.exists(cache))) {
      await IOUtils.makeDirectory(PathUtils.parent(cache)!, { createAncestors: true });
      await IOUtils.move(linkedCache, cache, { noOverwrite: true });
    }
    throw error;
  }
  return linked;
}

async function renameAttachment(attachment: Zotero.Item, onlyMainPDF = true): Promise<RenameOutcome> {
  const skipped: RenameOutcome = { renamed: false, attachment };
  const oldPath = await attachment.getFilePathAsync();
  // 独立附件没有父条目元数据，明确跳过，不猜测文件名。
  if (!oldPath || !attachment.parentItemID) return skipped;
  const name = PathUtils.filename(oldPath);
  const isPDF = attachment.attachmentContentType === 'application/pdf';
  if (!isPDF && !/\.docx?$/i.test(name)) return skipped;
  // SI PDF 在所有入口都跳过；Word 不受此限制。
  const supplementary = /(?:^|[\s_.-])(?:si\d*|mmc\d+|moesm\d*|supplement(?:ary|al)?(?:information|materials?)?|supporting(?:information)?)(?:$|[\s_.-])|补充材料/i;
  if (isPDF && (supplementary.test(name) || supplementary.test(attachment.getField('title')))) return skipped;
  const parent = await Zotero.Items.getAsync(attachment.parentItemID);
  if (!parent) return skipped;
  if (isPDF && onlyMainPDF) {
    // 批量模式仅处理默认附件；打开流程已明确处理对象，不应用此筛选。
    const main = await parent.getBestAttachment();
    if (!main || main.id !== attachment.id) return skipped;
  }
  const dir = collectionDirectory(parent);
  const basename = Zotero.Attachments.getFileBaseNameFromItem(parent, {
    attachmentTitle: parent.getField('title'),
  });
  const target = PathUtils.join(dir, basename + name.slice(name.lastIndexOf('.')));
  // 唯一文件名的 -N 后缀也视为已命名，避免重名附件被反复移动。
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`^${escaped}(?:-\\d+)?\\.(?:pdf|docx?)$`, 'i').test(name);
  if (oldPath === target || (PathUtils.parent(oldPath) === dir && named)) return skipped;

  const linkedFile = attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_FILE;
  const previous = {
    path: attachment.attachmentPath,
    title: attachment.getField('title'),
  };
  // 包括其他父条目及回收站中的引用；兼容绝对路径和附件基目录相对路径。
  const shared = !!await Zotero.DB.valueQueryAsync<number>(`
    SELECT COUNT(*) FROM itemAttachments
    WHERE itemID != ? AND linkMode = ?
      AND (path = ? COLLATE NOCASE OR path = ? COLLATE NOCASE)
  `, [attachment.id, Zotero.Attachments.LINK_MODE_LINKED_FILE,
    oldPath, Zotero.Attachments.getBaseDirectoryRelativePath(oldPath)]);
  // 存储目录随旧附件一并删除，被其他附件引用的存储型文件不处理。
  if (shared && !linkedFile) return skipped;
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  // 共享文件只复制，不改变其他附件的路径或内容。
  const movedPath = await transferToUnique(oldPath, target, shared);
  try {
    if (!linkedFile) {
      const linked = await replaceWithLinkedFile(attachment, movedPath, basename);
      return { renamed: true, attachment: linked };
    }
    attachment.attachmentPath = movedPath;
    attachment.setField('title', basename);
    await attachment.saveTx();
  } catch (error) {
    // 保存失败时恢复原文件和内存元数据；不覆盖后来出现的文件。
    try {
      if (shared) await IOUtils.remove(movedPath);
      else {
        await IOUtils.makeDirectory(PathUtils.parent(oldPath)!, { createAncestors: true });
        await IOUtils.move(movedPath, oldPath, { noOverwrite: true });
      }
      attachment.attachmentPath = previous.path;
      attachment.setField('title', previous.title);
    } catch (rollbackError) {
      throw new Error(`${error}; rollback failed: ${rollbackError}; file: ${movedPath}`);
    }
    throw error;
  }
  return { renamed: true, attachment };
}

// 修复此前直接改 linkMode 而无法上传的附件：文件已在外部目录，只需按当前路径重建条目。
async function repair(items: Zotero.Item[]): Promise<RepairResult> {
  const result: RepairResult = { repaired: 0, skipped: 0, errors: [] };
  for (const attachment of await itemAttachments(items)) {
    try {
      const path = await attachment.getFilePathAsync();
      // 文件已在外部目录，按给定清单重建；存储型与已删除条目原样跳过。
      if (attachment.deleted || !path
        || attachment.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE) {
        result.skipped++;
        continue;
      }
      await replaceWithLinkedFile(attachment, path, attachment.getField('title'));
      result.repaired++;
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      result.errors.push({ id: attachment.id, message: String(error) });
    }
  }
  return result;
}

const renameTasks = new Map<number, Promise<RenameOutcome>>();

async function rename(items: Zotero.Item[], { onlyMainPDF = true } = {}): Promise<RenameResult> {
  const result: RenameResult = { renamed: 0, skipped: 0, errors: [], replacements: [] };
  for (const attachment of await itemAttachments(items)) {
    // 同一附件串行执行，并重新检查路径及规则；不同附件互不阻塞。
    const previous = (renameTasks.get(attachment.id) ?? Promise.resolve(null)).catch(() => null);
    const task = previous.then(outcome => renameAttachment(outcome?.attachment ?? attachment, onlyMainPDF));
    renameTasks.set(attachment.id, task);
    try {
      const outcome = await task;
      if (!outcome.renamed) result.skipped++;
      else result.renamed++;
      // 排队任务即便无需再移动，也要把旧 ID 映射到前次转换后的附件。
      if (outcome.attachment.id !== attachment.id) {
        result.replacements.push({ from: attachment.id, to: outcome.attachment.id });
      }
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      result.errors.push({ id: attachment.id, message: String(error) });
    } finally {
      if (renameTasks.get(attachment.id) === task) renameTasks.delete(attachment.id);
    }
  }
  return result;
}
