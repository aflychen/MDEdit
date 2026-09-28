[简体中文](#user-content-readme-chinese) | [English](#user-content-readme-english)

# MDEdit

<a name="readme-chinese"></a>

## 简体中文

面向 macOS 和 Windows 的本地 Markdown 编辑器。源码编辑使用 CodeMirror 6，预览支持 CommonMark、常用 GFM、代码块高亮、Mermaid 图表和数学公式。可选择本地文件夹浏览和搜索 Markdown 文档。文件保存在原 `.md` 路径，恢复草稿存放在 Electron 的应用数据目录。

**macOS 特别说明：** v0.5.0 的 macOS 安装包存在启动失败问题，请改用较新版本。v0.6.1 仍是临时签名试用包，未经 Developer ID 签名和 Apple 公证；Gatekeeper 不会自动放行。如系统提示“已损坏”或拒绝打开，请在本机从源码构建，或等待正式签名和公证的版本。

### 开发

需要 Node.js 20.19+（或 22.12+）和 npm。

```bash
npm ci
npm run dev
```

```bash
npm test
npm run typecheck
npm run test:worker
```

`test:worker` 会先构建，再在无 DOM 环境执行实际生成的预览 Worker，用于防止依赖解析到只适用于页面的入口。

### 构建

```bash
npm run build
npm run dist:mac
npm run dist:win
```

`dist:mac` 和 `dist:win` 应分别在目标系统上运行。临时签名 macOS 包可作为试用附件提供，但 Gatekeeper 不会自动放行；可直接分发的正式 macOS 安装包仍需 Developer ID Application 签名与 Apple 公证。

### 版本发布

版本号保存在 `package.json` 和 `package-lock.json`，Git 标签使用 `vX.Y.Z`。每次完成应用代码变更并通过测试后，按项目级 [交付流程](AGENTS.md) 提交、推送、合入 `main` 并发布新版本，无须另行提醒。只修改文档或开发流程时不占用应用版本。标签必须指向已合入 `main` 的提交；推送标签后触发 [Release 工作流](.github/workflows/release.yml)：在 macOS 和 Windows 分别运行测试、构建安装包，计算 SHA-256，并将安装包附到公开的 GitHub Release。macOS 包使用临时签名脚本构建，未经 Apple 公证。版本不匹配或构建校验失败时发布会失败，已发布的版本不覆盖。

临时签名流程会验证应用签名与 DMG 完整性，但不会通过 Gatekeeper 或公证校验。公开 GitHub Release 不等于已获得 Apple 签名与公证；如需可直接打开的 macOS 安装包，仍需另行配置 Developer ID 签名与公证。

例如发布补丁版本：

```bash
npm version patch --no-git-tag-version
# 若此版本已分配给后续里程碑，先在 roadmap 中调整该里程碑版本
# 编辑 docs/releases/vX.Y.Z.md，测试、提交、推送并合入 main
git switch main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "MDEdit vX.Y.Z"
git push origin vX.Y.Z
```

### 使用

- `Cmd/Ctrl+O` 打开 `.md`，`Cmd/Ctrl+N` 新建。
- 多个文档以标签打开；`Cmd/Ctrl+Tab` 和 `Cmd/Ctrl+Shift+Tab` 切换标签，`Cmd/Ctrl+W` 关闭当前标签。焦点在标签上时也可用左右方向键、Home、End 导航。同一路径再次打开时会聚焦已有标签。
- `Cmd/Ctrl+S` 立即保存，`Cmd/Ctrl+Shift+S` 另存为。
- 顶栏“文件”菜单提供打开文件夹、另存为、导出 HTML/PDF 和最近文件。导出使用当前标签的最新内容；HTML 为包含本地图片、图表和公式字体的单文件，PDF 为 A4。远程图片不加载，本地图片不可读取时会提示失败。
- `Cmd/Ctrl+B`、`Cmd/Ctrl+I`、`Cmd/Ctrl+K` 插入常用 Markdown 标记。
- `Cmd/Ctrl+F` 打开查找与替换。
- 工具栏直接提供标题级别、粗体、斜体和链接；“插入”菜单提供行内代码、列表、引用、代码块和 GFM 表格。可按行列数插入表格，也可将当前行或选中的多行转换为无序列表、数字有序列表和任务列表。
- “视图”菜单可独立切换专注模式与打字机模式，并选择跟随系统、浅色或深色主题。专注模式淡化光标所在段落之外的编辑内容；打字机模式在输入时将光标行保持在编辑区中部。
- 光标位于 GFM 表格时，Tab / Shift+Tab 在单元格间移动；在末尾单元格按 Tab 会添加正文行。“插入 → 表格”还可增删当前行列并设置当前列对齐。含额外单元格的异常表格不会被结构命令改写。
- “打开文件夹”选择本地目录；左侧“文件”按需展开子文件夹并打开 Markdown 文档，“搜索”查找该文件夹内的 Markdown 内容。搜索结果可跳转到命中处，最多显示 100 条结果；超过 5 MiB、无法读取或不是有效 UTF-8 的文件会计入跳过数量。
- 手动选择的外观主题会保存在本机。
- 左侧目录根据当前文档的 H1～H6 实时生成，可筛选和折叠标题，并标示当前章节；点击标题可跳转。编辑区与预览区按标题同步定位，预览代码块可一键复制。
- 围栏代码块根据显式语言标记高亮；未标记或无法识别的语言显示普通代码文本。
- 在编辑区粘贴或拖入 PNG、JPEG、GIF、WebP、AVIF 图片时，图片会存入文档同级的 `images/` 目录并插入相对路径；未命名文档先选择保存位置。单张图片上限 10 MiB，每次最多 20 张且总量不超过 50 MiB。
- 使用 `mermaid` 围栏代码块预览图表；使用 `$...$` 和 `$$...$$` 预览行内与块级公式。语法错误只显示在对应图表或公式处。
- 各标签的已命名文档停止输入约 2 秒后自动保存；未命名文档只保存恢复草稿。关闭仍有未保存内容的标签前会先备份恢复草稿。

文件夹访问基于本次会话中通过系统对话框选择的目录；文件树与搜索拒绝静态符号链接及越界路径。若同机进程在读写期间持续替换目录，仍存在路径竞态，不能将此机制视为对恶意本地进程的隔离。本地图片只允许位于对应文档的目录及子目录。远程图片默认不加载。文档被其他程序修改时，应用会停止覆盖并提供重新载入或另存副本。后续功能范围见 [迭代规划](docs/roadmap.md)。

产品与安全边界见 [设计文档](docs/superpowers/specs/2026-09-23-markdown-editor-design.md)。

<a name="readme-english"></a>

## English

A local Markdown editor for macOS and Windows. Source editing is powered by CodeMirror 6. The preview supports CommonMark, commonly used GFM features, code block highlighting, Mermaid diagrams, and math formulas. You can browse and search Markdown documents in a local folder. Files are saved to their original `.md` paths, and recovery drafts are stored in Electron's application data directory.

**macOS notice:** The macOS installer in v0.5.0 fails to launch; use a newer version instead. The v0.6.1 installer is still an ad hoc signed trial build. It has not been signed with a Developer ID or notarized by Apple, so Gatekeeper will not automatically allow it to run. If macOS says the app is damaged or refuses to open it, build from source on your Mac or wait for a properly signed and notarized release.

## Development

Requires Node.js 20.19+ (or 22.12+) and npm.

```bash
npm ci
npm run dev
```

```bash
npm test
npm run typecheck
npm run test:worker
```

`test:worker` builds the app first, then runs the generated preview Worker in an environment without a DOM. This helps ensure that the Worker does not resolve to an entry point intended only for a browser page.

## Build

```bash
npm run build
npm run dist:mac
npm run dist:win
```

Run `dist:mac` and `dist:win` on their respective target operating systems. An ad hoc signed macOS build can be attached as a trial package, but Gatekeeper will not automatically allow it. A macOS installer that opens directly requires Developer ID Application signing and Apple notarization.

## Releases

The version is recorded in `package.json` and `package-lock.json`; Git tags use the `vX.Y.Z` format. After each tested application code change, follow the project-wide [delivery workflow](AGENTS.md) to commit, push, integrate into `main`, and publish a version without a separate reminder. Documentation-only and process-only changes do not consume an app version. The tag must point to a commit already integrated into `main`. Pushing it triggers the [Release workflow](.github/workflows/release.yml), which tests and builds on macOS and Windows, calculates SHA-256 checksums, and attaches the installers to a public GitHub Release. The macOS installer is built with ad hoc signing and is not Apple notarized. A release fails if the version does not match or a build check fails; published releases are not overwritten.

The ad hoc signing flow verifies the app signature and DMG integrity, but does not pass Gatekeeper or notarization checks. A public GitHub Release does not imply Apple signing or notarization; distributing a macOS installer that opens directly still requires a separate Developer ID signing and notarization setup.

For example, to release a patch version:

```bash
npm version patch --no-git-tag-version
# If this version is assigned to a later milestone, move that milestone in the roadmap first.
# Edit docs/releases/vX.Y.Z.md, test, commit, push, and integrate into main
git switch main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "MDEdit vX.Y.Z"
git push origin vX.Y.Z
```

## Usage

- `Cmd/Ctrl+O` opens a `.md` file; `Cmd/Ctrl+N` creates a new document.
- Open multiple documents in tabs. Use `Cmd/Ctrl+Tab` and `Cmd/Ctrl+Shift+Tab` to switch tabs, and `Cmd/Ctrl+W` to close the current tab. When a tab is focused, the arrow keys, Home, and End also navigate the tabs. Opening a path that is already open focuses its existing tab.
- `Cmd/Ctrl+S` saves immediately; `Cmd/Ctrl+Shift+S` opens Save As.
- The File menu contains Open Folder, Save As, HTML/PDF export, and recent files. Export uses the latest content in the current tab. HTML is a single file containing local images, diagrams, and formula fonts; PDF uses A4 page size. Remote images are not loaded. An error is shown if a local image cannot be read.
- `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, and `Cmd/Ctrl+K` insert common Markdown markers.
- `Cmd/Ctrl+F` opens Find and Replace.
- The toolbar keeps heading level, bold, italic, and link controls visible. The Insert menu contains inline code, lists, quotes, code blocks, and GFM tables. It can insert a table with chosen dimensions or convert the current line or selected lines to a bullet, numbered, or task list.
- The View menu contains independent Focus and Typewriter mode switches and the system/light/dark theme selector. Focus mode dims text outside the current paragraph; Typewriter mode keeps the caret line near the middle of the editor while typing.
- In a GFM table, Tab and Shift+Tab move between cells; Tab in the final cell adds a body row. Insert → Table can also insert or delete rows and columns and set column alignment. Structural commands leave malformed tables with surplus cells unchanged.
- Select a local directory using the folder picker. In the left pane, browse its file tree to expand subfolders and open Markdown documents, or search the folder's Markdown content. Search results jump to matching text and are limited to 100 entries. Files larger than 5 MiB, unreadable files, and files that are not valid UTF-8 are counted as skipped.
- A manually selected theme is saved on this machine.
- The left outline is generated live from the current document's H1–H6 headings. Filter or collapse headings, see the current section, and click a heading to jump to it. The editor and preview stay aligned by heading, and preview code blocks can be copied with one click.
- Fenced code blocks are highlighted when they have an explicit language label. Blocks with no label or an unrecognized language are shown as plain text.
- Paste or drag PNG, JPEG, GIF, WebP, or AVIF images into the editor to save them in an `images/` folder next to the document and insert relative paths. For an unnamed document, choose where to save it first. Each image is limited to 10 MiB; each import can contain up to 20 images and 50 MiB in total.
- Use a `mermaid` fenced code block to preview a diagram. Use `$...$` and `$$...$$` for inline and block formulas. Syntax errors are shown only at the affected diagram or formula.
- Named documents in each tab are saved automatically about 2 seconds after typing stops. Unnamed documents save only recovery drafts. Before closing a tab with unsaved content, the app first backs it up as a recovery draft.

Folder access is limited to directories selected through the system dialog during the current session. The file tree and search reject static symlinks and paths outside the selected folder. A path race is still possible if another local process repeatedly replaces directories during a read or write, so this mechanism should not be treated as isolation from a malicious process on the same machine. Local images are allowed only in the corresponding document's directory or its subdirectories. Remote images are not loaded by default. If another program modifies a document, the app stops overwriting it and offers to reload it or save a copy. See the [iteration roadmap](docs/roadmap.md) for planned work.

See the [design document](docs/superpowers/specs/2026-09-23-markdown-editor-design.md) for product scope and security boundaries.
