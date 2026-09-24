# Markdown 编辑器实现计划

> 面向执行者：按任务顺序实现；行为代码先写会失败的测试，再写最小实现。每个任务完成后运行相应测试与类型检查。

**目标：** 交付可在 macOS 和 Windows 运行的单文档本地 Markdown 编辑器，具备安全预览、自动保存、冲突保护与草稿恢复。

**架构：** Electron 主进程独占磁盘访问和保存队列，受限 preload 暴露明确的文档操作。React 界面持有编辑版本，CodeMirror 负责输入，Web Worker 生成已清理的预览 HTML。

**技术栈：** Electron、electron-vite、TypeScript、React、CodeMirror 6、remark、remark-gfm、remark-rehype、rehype-sanitize、Vitest。

**规格：** [本地 Markdown 编辑器：首版设计](../specs/2026-09-23-markdown-editor-design.md)。

## 全局约束

- 单窗口单文档；`.md` 文件是正式来源，草稿只用于恢复。
- 未命名文档的自动保存只写恢复草稿。
- 自动保存约 2 秒，草稿约 500 毫秒，预览约 150 毫秒。
- 保留 UTF-8 BOM 与统一的 LF/CRLF；混合换行写回前须确认或另存。
- 主进程验证文件指纹；预览不执行脚本、不加载远程图片、不读取文档目录外资源。

## 文件结构

- `src/shared/contracts.ts`：主进程、preload 和界面的类型契约。
- `src/main/document-io.ts`：UTF-8 读取、格式保留、临时文件保存与冲突检测。
- `src/main/drafts.ts`：恢复草稿的持久化、读取与清理。
- `src/main/assets.ts`：相对资源的路径边界检查与读取。
- `src/main/index.ts`：窗口、文件关联、对话框、IPC、保存串行化与导航安全。
- `src/preload/index.ts`：受限 API。
- `src/renderer/session.ts`：编辑版本和保存状态。
- `src/renderer/preview.worker.ts`：Markdown 解析与清理。
- `src/renderer/App.tsx`：编辑器、预览、命令和冲突/恢复交互。
- `src/renderer/styles.css`：界面样式。
- `tests/*.test.ts`：状态、文件服务、安全边界的行为测试。

## 任务 1：项目与状态契约

- [x] 初始化 Electron + React + TypeScript + Vitest；配置 dev、build、typecheck、test 命令。
- [x] 先为编辑版本、保存成功和失败/冲突状态写测试，确认测试因功能缺失而失败。
- [x] 实现共享契约和纯状态转换，运行 `npm test` 与 `npm run typecheck`。

## 任务 2：可靠文件读写

- [x] 先测试 BOM、LF/CRLF、无效 UTF-8、外部修改、原子替换与符号链接保护。
- [x] 实现主进程文件服务，保存时按主进程持有的指纹比较，并写同目录临时文件后替换。
- [x] 运行文件服务测试与类型检查。

## 任务 3：草稿、最近文件和资源边界

- [x] 先测试草稿恢复/清理及越界资源路径拒绝。
- [x] 实现草稿存储、最近文件偏好和图片资源读取约束。
- [x] 运行对应测试与类型检查。

## 任务 4：桌面桥接与安全窗口

- [x] 注册单窗口、文件打开/另存对话框、保存队列、系统文件关联与 IPC。
- [x] 使用 `contextIsolation`、sandbox、严格 CSP 和导航拦截；preload 只暴露明确操作。
- [x] 验证构建通过，并确认 Electron 进程能够启动。

## 任务 5：编辑与保存交互

- [x] 接入 CodeMirror 6、文档状态、自动保存、手动保存、草稿定时写入与关闭前写入。
- [x] 实现新建、打开、最近文件、另存为、冲突选择、恢复入口、查找替换、常用 Markdown 命令与状态栏。
- [x] 运行状态测试、类型检查和构建。

## 任务 6：安全实时预览

- [x] 先测试 GFM 输出、安全清理和链接/图片策略。
- [x] Worker 解析 Markdown；界面丢弃过时版本，加载受限本地图片，外部链接交给系统浏览器。
- [x] 运行预览测试、类型检查和构建。

## 任务 7：验收和交付

- [x] 运行完整测试、类型检查、构建，检查运行日志和 Git diff。
- [ ] 在当前 macOS 环境手动走打开、编辑、保存、冲突和恢复路径。
- [x] 记录 Windows 和安装包验证的待执行项，不把未执行的跨平台验证声称为完成。

当前验收记录：macOS 上 20 个单元/集成测试通过，类型检查、构建和无 DOM Worker 检查通过；`electron-builder --mac --dir` 已生成未签名应用，Info.plist 包含 `.md` 文档关联。已在 macOS 上交叉生成 Windows arm64 解包目录，但未在 Windows 运行。桌面自动化权限未授予，无法完成交互点击场景。Windows 运行、文件关联和安装包仍需在 Windows 环境验证；CI 已配置 Windows 构建与测试。
