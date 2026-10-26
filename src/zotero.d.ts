// zotero-types 尚未包含的 Zotero 10 签名；按已安装版本补充。
declare namespace _ZoteroTypes {
  interface Attachments {
    getFileBaseNameFromItem(item: Zotero.Item, options: { attachmentTitle: string }): string;
  }
  interface Items {
    moveChildItems(from: Zotero.Item, to: Zotero.Item, options: { includeTrashed: boolean }): Promise<void>;
  }
}
declare namespace Zotero.Relations {
  function getByObject(type: 'item', uri: string): Promise<{ subject: Zotero.Item; predicate: _ZoteroTypes.RelationsPredicate }[]>;
}
declare namespace Zotero.DataObject {
  interface EraseOptions {
    skipNotifier?: boolean;
  }
}
