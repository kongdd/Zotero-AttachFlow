# Zotero-AttachFlow

手动重命名、打开目录、打开 PDF 或 Word 前自动重命名，无 Actions & Tags 运行依赖；当前针对 Zotero 10。

| 功能 | Windows | macOS |
| --- | --- | --- |
| 打开选中条目第一个可用 PDF 的目录 | Ctrl+E | Cmd+E |
| 按父条目元数据重命名主 PDF、Word，并移至分类目录 | Ctrl+R | Cmd+R |
| 正常点击、双击或回车打开 PDF、Word 前自动重命名 | 自动 | 自动 |

快捷键仅在 Zotero 主窗口有效，输入框中不触发。请停用 Actions & Tags 中同名快捷键，避免冲突。独立附件没有父条目元数据，重命名时跳过。

- **批量/快捷键 `rename`**：主 PDF 以 Zotero 默认打开的附件为准（`parent.getBestAttachment()`）；非默认 PDF 不处理，默认 PDF 若明确含 SI、Supplementary、Supporting、MOESM 等标识也跳过。
- **打开前 `open_rename`**：双击父条目时，遍历子附件并沿用上述批量规则，再由 Zotero 打开默认附件；直接打开单个附件时，只整理该附件，不处理同级附件；SI PDF 保留原名，但 Word（含 SI Word）仍可重命名。
- 两种方式均支持 Word（`.doc/.docx`），图件不处理。保留扩展名，重名时添加数字后缀，并发处理不覆盖已有文件。处理后的文件会移至分类目录并转为链接附件，不再参与 Zotero 附件同步；若源文件被其他链接附件引用，则复制到目标目录，保留源文件及其他附件不变；存储型附件被其他链接附件引用时不处理。
- 转为链接附件时遵循 Zotero 自身的转换方式：在同一数据库事务中新建链接附件、迁移批注与笔记、入向关系及全文索引，再删除旧附件。同步服务不接受直接修改既有附件的 `linkMode`，因此不能原地改写；附件 Key 会随新条目变化。

复制格式化参考文献请使用 Zotero 原生快捷键 `Cmd+Shift+C`（Windows：`Ctrl+Shift+C`），样式在「设置 → 导出 → 快速复制」中配置。

## 修复无法同步的附件

旧版本直接改写附件 `linkMode`，Zotero 同步会报 `Cannot change attachment linkMode`（400）并停止上传。升级后新转换不会再触发；已受影响的附件按下述步骤重建：

1. 关闭 Zotero，备份数据目录及外部附件；安装本版本插件并重启。
2. 在「工具 → 开发者 → 运行 JavaScript」中粘贴 `tools/repair-linkmode.js`，勾选异步模式；`execute = false` 时只预览清单。
3. 核对清单后改为 `execute = true` 再运行一次。

判定依据是「本地已是链接附件、但仍保留存储型附件的同步信息」，只处理个人库，跳过回收站；重建不移动文件，保留批注、笔记与条目关系；全文索引迁移失败时记录错误，可手动重新索引。

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
- `src/rename.ts`：手动重命名、移动、附件类型转换及失败回滚。
- `tools/repair-linkmode.js`：修复历史遗留的无法同步附件。
- `src/open_rename.ts`：接管正常附件打开流程，先调用 rename，再由 Zotero 打开。
- `src/shortcuts.ts`：按键匹配、输入框排除。
- `src/bootstrap.ts`：生命周期与快捷键注册，仅用 pending 防止重复执行。
- `tests/`：单元测试、真实集成测试及受确认保护的测试服务（`server.ts`）。
- `tools/`：构建和测试命令。
