# Markdown 编辑器本轮功能实现计划

状态：代码已实现并通过自动化验证；桌面交互验收因电脑控制权限不可用而待人工检查。

> **面向 AI 代理的工作者：** 使用测试驱动开发。每个任务先让覆盖该行为的测试失败，再写实现并验证。可并行的任务使用子代理执行，集成后做整体验证。

**目标：** 为现有本地 Markdown 编辑器加入安全的代码块高亮、快捷表格与标题、多标签和当前文档大纲。

**架构：** 预览 Worker 从一次 Markdown 解析中返回安全 HTML 和标题位置。渲染进程以文档 ID 管理多个 `DocumentSession`，主进程按已授权路径管理文件操作和监听。CodeMirror 为每个标签保留独立编辑状态。

**技术栈：** Electron、React、TypeScript、CodeMirror 6、unified/remark、Vitest。

**规格：** [本轮功能设计](../specs/2026-09-24-editor-iteration-design.md)。

## 全局约束

- 用户的 `.md` 文件仍是正式来源；保留 UTF-8、换行、BOM、自动保存、恢复草稿和磁盘冲突行为。
- 主进程按已授权文档路径限制保存、相对链接与本地图片读取；远程图片仍默认不加载，预览不能执行文档脚本。
- 文件夹树、跨文件搜索、图片粘贴、深色模式、导出、Mermaid 和公式不在本轮实现。
- 代码块高亮只依显式语言标识；未知语言回退为普通文本。

## 文件职责

- `src/renderer/preview.ts`、`preview.worker.ts`：HTML 渲染、语言高亮、大纲数据及 Worker 输出。
- `src/renderer/markdown-commands.ts`：标题、表格和常用块级 Markdown 插入的纯命令。
- `src/renderer/tabs.ts`：多标签状态转换和路径去重。
- `src/renderer/App.tsx`、`styles.css`：编辑器生命周期、文档命令、标签栏、大纲与工具栏 UI。
- `src/main/index.ts`：多文档文件授权、监听与 IPC；`src/preload/index.ts`、`src/shared/contracts.ts`：明确的跨进程 API。
- `tests/*.test.ts`：行为测试；`scripts/check-worker.mjs`：构建后 Worker 验证。

---

### 任务 1：预览高亮与大纲数据

**文件：** 修改 `src/renderer/preview.ts`、`preview.worker.ts`、`tests/preview.test.ts`；按选定高亮库更新 `package.json` 和锁文件。

- [ ] 增加测试：`renderMarkdown('```js\nconst x = 1\n```')` 的结果包含语言和语法 token；未知语言包含原代码但不抛错；`# 标题` 与代码围栏里的 `# 假标题` 只产生一个大纲项。
- [ ] 运行 `npm test -- tests/preview.test.ts`，确认这些断言因功能缺失而失败。
- [ ] 实现 `renderPreview(text): { html: string; outline: OutlineHeading[] }`，保留 `renderMarkdown(text)` 兼容入口；高亮在清理前进行，只放行安全的 token 类名。Worker 返回 `sessionId`、`revision`、`html`、`outline` 和 `words`。
- [ ] 重跑预览测试，并运行 `npm run test:worker`。

### 任务 2：Markdown 快捷命令

**文件：** 创建 `src/renderer/markdown-commands.ts`、`tests/markdown-commands.test.ts`。

- [ ] 测试 `setHeading('## 旧标题', 1)` 得到 `# 旧标题`，转正文得到 `旧标题`；测试 `createTable(2, 2)` 生成两列表头、分隔线与两行正文；测试首个可编辑位置。
- [ ] 运行 `npm test -- tests/markdown-commands.test.ts`，确认红灯。
- [ ] 实现返回替换文本和选择位置的纯命令，支持标题、表格、列表、任务项、引用和围栏代码块；UI 只负责 CodeMirror dispatch。
- [ ] 重跑命令测试及 `npm run typecheck`。

### 任务 3：主进程多文档访问边界

**文件：** 修改 `src/main/index.ts`、`src/main/document-io.ts`、`src/shared/contracts.ts`、`src/preload/index.ts`；补充 `tests/document-io.test.ts`。

- [ ] 先测试 `DocumentStore` 打开 A、B 后保存 A，且 B 的外部修改仍会产生冲突；验证重复打开 A 不重置 A 的磁盘基线。
- [ ] 运行对应测试并确认失败行为。
- [ ] 将主进程单个 `activePath`/watcher 改为已打开路径集合及每路径监听；IPC 给相对链接、图片读取、另存为默认路径传入发起文档路径，校验路径在已打开集合中；增加关闭文档时的释放入口。
- [ ] 重跑文件服务测试、类型检查与构建。

### 任务 4：标签状态与后台保存

**文件：** 创建 `src/renderer/tabs.ts`、`tests/tabs.test.ts`；修改 `src/renderer/App.tsx`。

- [ ] 测试重复路径聚焦、后台标签独立更新、关闭当前标签后选中邻近标签、冲突只标记对应路径。
- [ ] 运行标签测试确认红灯。
- [ ] 实现 `TabWorkspace` 的纯转换；App 按 ID 更新异步保存结果，按标签调度草稿/自动保存，关闭与退出时保留所有未落盘草稿；CodeMirror 为每个标签保存 EditorState。
- [ ] 重跑标签测试、session 测试和类型检查。

### 任务 5：界面集成

**文件：** 修改 `src/renderer/App.tsx`、`styles.css`。

- [ ] 连接预览 Worker 的文档 ID/修订号、大纲点击定位、代码复制、编辑预览定位。
- [ ] 连接标题下拉菜单、表格行列入口与块级插入命令；添加标签栏、状态标记和大纲侧栏，保持键盘访问。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run test:worker`；检查常见窄窗口布局。

### 任务 6：最终验证与审查

**文件：** 按实际问题修复涉及的代码和测试；更新 `README.md` 的操作说明。

- [ ] 核对规格中的每条用户场景与本次 diff，修复遗漏。
- [ ] 运行完整测试、类型检查、Worker 检查与构建，确认退出码为 0。
- [ ] 审查多标签保存/资源授权/预览注入风险，记录剩余限制。
