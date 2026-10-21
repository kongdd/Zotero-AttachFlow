// zotero-types 尚未包含的 Zotero 10 签名；按已安装版本补充。
declare namespace _ZoteroTypes {
  interface Attachments {
    getFileBaseNameFromItem(item: Zotero.Item, options: { attachmentTitle: string }): string;
  }
}
declare namespace Zotero.DataObject {
  interface EraseOptions {
    skipNotifier?: boolean;
  }
}
