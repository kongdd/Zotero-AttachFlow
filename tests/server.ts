let testsRunning = false;
const testEndpoint = '/attachment-tools/tests';

// 仅提供两种内置测试，不接受代码或文件路径；执行前必须由用户确认。
class AttachmentTestEndpoint {
  supportedMethods = ['POST'];
  supportedDataTypes = ['application/json'];
  permitBookmarklet = false;

  async init({ data }: { data: unknown }): Promise<[number, string, string]> {
    const mode = (data as { mode?: unknown } | null)?.mode;
    if (mode !== 'runtime' && mode !== 'integration') return [400, 'text/plain', 'Invalid test mode'];
    const plugin = attachmentPlugin;
    if (!plugin || plugin.pending || testsRunning) return [409, 'text/plain', 'Plugin is busy'];
    const window = Zotero.getMainWindow();
    const message = mode === 'integration'
      ? '运行 Attachment Tools 集成测试？将创建临时条目和 PDF、移动文件、调用文件管理器，完成后清理。不会处理现有附件。'
      : '运行 Attachment Tools 只读环境检查？';
    if (!window?.confirm(message)) return [403, 'text/plain', 'Cancelled'];
    testsRunning = true;
    try {
      const report = mode === 'runtime' ? runRuntimeTests(plugin) : await runIntegrationTests(plugin);
      return [200, 'application/json', JSON.stringify(report)];
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      return [500, 'application/json', JSON.stringify({ passed: false, error: String(error) })];
    } finally {
      testsRunning = false;
    }
  }
}
