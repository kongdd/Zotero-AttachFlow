# Zotero-AttachFlow

手动重命名、打开目录、打开 PDF 前自动重命名，无 Actions & Tags 运行依赖；当前针对 Zotero 10。

| 功能 | Windows | macOS |
| --- | --- | --- |
| 打开选中条目第一个可用 PDF 的目录 | Ctrl+E | Cmd+E |
| 按父条目元数据重命名 PDF，并移至分类目录 | Ctrl+R | Cmd+R |
| 正常点击、双击或回车打开 PDF 前自动重命名 | 自动 | 自动 |

快捷键仅在 Zotero 主窗口有效，输入框中不触发。请停用 Actions & Tags 中同名快捷键，避免冲突。独立 PDF 没有父条目元数据，重命名时跳过。

复制格式化参考文献请使用 Zotero 原生快捷键 `Cmd+Shift+C`（Windows：`Ctrl+Shift+C`），样式在「设置 → 导出 → 快速复制」中配置。

## 使用

在仓库根目录执行：

```bash
npm install
npm test
npm run build
```

在 Zotero「工具 → 插件」中选择「从文件安装插件」，安装 `dist/Zotero-AttachFlow-0.1.0.xpi`。

## 测试

```bash
npm run install:dev       # 开发用：自动构建、安装 XPI，需确认现有调试桥弹窗
npm run test:functions     # 安装前验证独立函数；开发阶段借用现有 ztoolkit 调试桥
npm run test:runtime       # 安装后检查独立插件运行环境
npm run test:integration   # 安装后执行真实文件、数据库测试
```

真实测试均需在 Zotero 弹窗确认。安装后通过本插件的本地 HTTP 端点运行，不依赖其他插件；默认端口 23119，可用 `ZOTERO_PORT` 指定。集成测试自动验证正常打开和快捷键 DOM 事件，仅创建随机命名的测试对象，结束后清理并恢复选择；文件管理器窗口需目视确认。Windows 目前只有单元测试覆盖。

为兼容已有安装和开发工具，插件 ID、npm 包名、源码目录及内部接口保持不变。

## 代码

- `src/opendir.ts`：查找 PDF、打开目录。
- `src/rename.ts`：手动重命名、移动及保存失败回滚。
- `src/open_rename.ts`：接管正常附件打开流程，先调用 rename，再由 Zotero 打开。
- `src/shortcuts.ts`：按键匹配、输入框排除。
- `src/bootstrap.ts`：生命周期与快捷键注册，仅用 pending 防止重复执行。
- `tests/`：单元测试、真实集成测试及受确认保护的测试服务（`server.ts`）。
- `tools/`：构建和测试命令。
