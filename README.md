# Attachment Tools

仅提供两个命令，无 Actions & Tags 依赖；当前针对 Zotero 10。

| 功能 | Windows | macOS |
| --- | --- | --- |
| 打开选中条目第一个可用 PDF 的目录 | Ctrl+E | Cmd+E |
| 按父条目元数据重命名 PDF，并移至分类目录 | Ctrl+R | Cmd+R |

快捷键仅在 Zotero 主窗口有效，输入框中不触发。请停用 Actions & Tags 中同名快捷键，避免冲突。独立 PDF 没有父条目元数据，重命名时跳过。

## 使用

在仓库根目录执行：

```bash
npm install
npm test
npm run build
```

在 Zotero「工具 → 插件」中选择「从文件安装插件」，安装 `pkgs/attachment-tools/dist/attachment-tools-0.1.0.xpi`。

## 测试

```bash
npm run test:functions     # 安装前验证独立函数；开发阶段借用现有 ztoolkit 调试桥
npm run test:runtime       # 安装后检查独立插件运行环境
npm run test:integration   # 安装后执行真实文件、数据库测试
```

真实测试均需在 Zotero 弹窗确认。安装后通过本插件的本地 HTTP 端点运行，不依赖其他插件；默认端口 23119，可用 `ZOTERO_PORT` 指定。集成测试仅创建随机命名的测试对象，结束后清理；文件管理器窗口需目视确认。Windows 目前只有单元测试覆盖。

## 代码

- `src/opendir.ts`：查找 PDF、打开目录。
- `src/open_rename.ts`：重命名、移动及保存失败回滚。
- `src/shortcuts.ts`：按键匹配、输入框排除。
- `src/bootstrap.ts`：生命周期、快捷键注册、受确认保护的内置测试入口。
- `tests/`：单元测试与真实集成测试；`tools/`：构建和测试命令。
