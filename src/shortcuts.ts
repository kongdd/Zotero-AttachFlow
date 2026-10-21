type AttachmentCommand = 'opendir' | 'rename';

// 参考 Actions & Tags 的输入框排除规则；不依赖其键盘工具包。
function shortcutCommand(event: KeyboardEvent, isMac: boolean): AttachmentCommand | null {
  const target = event.composedPath()[0] as HTMLElement | undefined;
  if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey) return null;
  if (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return null;
  if (target?.closest?.('input, textarea, select, textbox, search-textbox, [contenteditable]:not([contenteditable="false"])')) {
    return null;
  }
  if (event.key.toLowerCase() === 'e') return 'opendir';
  if (event.key.toLowerCase() === 'r') return 'rename';
  return null;
}
