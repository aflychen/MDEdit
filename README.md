# MDEdit

面向 macOS 和 Windows 的本地 Markdown 编辑器。源码编辑使用 CodeMirror 6，预览支持 CommonMark、常用 GFM、代码块高亮、Mermaid 图表和数学公式。可选择本地文件夹浏览和搜索 Markdown 文档。文件保存在原 `.md` 路径，恢复草稿存放在 Electron 的应用数据目录。

**macOS 特别说明：** v0.5.0 的 macOS 安装包存在启动失败问题，请改用 v0.5.1。v0.5.1 仍是临时签名试用包，未经 Developer ID 签名和 Apple 公证；Gatekeeper 不会自动放行。如系统提示“已损坏”或拒绝打开，请在本机从源码构建，或等待正式签名和公证的版本。

## 开发

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

## 构建

```bash
npm run build
npm run dist:mac
npm run dist:win
```

`dist:mac` 和 `dist:win` 应分别在目标系统上运行。未签名的 macOS 包只适合本地开发验证；对外分发需要 Developer ID Application 签名与 Apple 公证。

## 版本发布

版本号保存在 `package.json` 和 `package-lock.json`，Git 标签使用 `vX.Y.Z`。发布新版本时，先更新版本号与 `docs/releases/vX.Y.Z.md`，提交代码，然后创建并推送同名标签。标签触发 [Release 工作流](.github/workflows/release.yml)：在 macOS 和 Windows 分别运行测试、构建安装包，计算 SHA-256，并将安装包附到对应的 GitHub Release。v0.3.0、v0.4.0、v0.5.0 和 v0.5.1 明确采用临时签名试用包；后续版本仍要求 macOS 正式签名和公证。版本不匹配或构建校验失败时发布会失败，已发布的版本不覆盖。

发布正式 macOS 安装包前，在 GitHub Actions Secrets 配置 `MAC_CSC_LINK`（Developer ID Application `.p12` 的 Base64 内容）、`MAC_CSC_KEY_PASSWORD`（证书导出密码）、`APPLE_ID`（Apple 开发者账号）、`APPLE_APP_SPECIFIC_PASSWORD`（应用专用密码）和 `APPLE_TEAM_ID`。不要将证书或密码提交到仓库。v0.3.0、v0.4.0、v0.5.0 和 v0.5.1 的临时签名例外会验证应用签名与 DMG 完整性，但不会通过 Gatekeeper 或公证校验。

例如发布补丁版本：

```bash
npm version patch --no-git-tag-version
# 编辑 docs/releases/vX.Y.Z.md，然后提交变更
git tag -a vX.Y.Z -m "MDEdit vX.Y.Z"
git push origin HEAD
git push origin vX.Y.Z
```

## 使用

- `Cmd/Ctrl+O` 打开 `.md`，`Cmd/Ctrl+N` 新建。
- 多个文档以标签打开；`Cmd/Ctrl+Tab` 和 `Cmd/Ctrl+Shift+Tab` 切换标签，`Cmd/Ctrl+W` 关闭当前标签。焦点在标签上时也可用左右方向键、Home、End 导航。同一路径再次打开时会聚焦已有标签。
- `Cmd/Ctrl+S` 立即保存，`Cmd/Ctrl+Shift+S` 另存为。
- 顶部“导出 HTML”和“导出 PDF”使用当前标签的最新内容。HTML 为包含本地图片、图表和公式字体的单文件；PDF 为 A4。远程图片不加载，本地图片不可读取时会提示失败。
- `Cmd/Ctrl+B`、`Cmd/Ctrl+I`、`Cmd/Ctrl+K` 插入常用 Markdown 标记。
- `Cmd/Ctrl+F` 打开查找与替换。
- 工具栏可设置正文或 H1～H5，按行列数插入 GFM 表格，也可将当前行或选中的多行转换为无序列表、数字有序列表和任务列表，或插入引用和代码块。
- “打开文件夹”选择本地目录；左侧“文件”按需展开子文件夹并打开 Markdown 文档，“搜索”查找该文件夹内的 Markdown 内容。搜索结果可跳转到命中处，最多显示 100 条结果；超过 5 MiB、无法读取或不是有效 UTF-8 的文件会计入跳过数量。
- 外观可选择跟随系统、浅色或深色；手动选择会保存在本机。
- 左侧目录根据当前文档的 H1～H6 实时生成；点击标题可跳转。编辑区与预览区按标题同步定位，预览代码块可一键复制。
- 围栏代码块根据显式语言标记高亮；未标记或无法识别的语言显示普通代码文本。
- 在编辑区粘贴或拖入 PNG、JPEG、GIF、WebP、AVIF 图片时，图片会存入文档同级的 `images/` 目录并插入相对路径；未命名文档先选择保存位置。单张图片上限 10 MiB，每次最多 20 张且总量不超过 50 MiB。
- 使用 `mermaid` 围栏代码块预览图表；使用 `$...$` 和 `$$...$$` 预览行内与块级公式。语法错误只显示在对应图表或公式处。
- 各标签的已命名文档停止输入约 2 秒后自动保存；未命名文档只保存恢复草稿。关闭仍有未保存内容的标签前会先备份恢复草稿。

文件夹访问基于本次会话中通过系统对话框选择的目录；文件树与搜索拒绝静态符号链接及越界路径。若同机进程在读写期间持续替换目录，仍存在路径竞态，不能将此机制视为对恶意本地进程的隔离。本地图片只允许位于对应文档的目录及子目录。远程图片默认不加载。文档被其他程序修改时，应用会停止覆盖并提供重新载入或另存副本。后续功能范围见 [迭代规划](docs/roadmap.md)。

产品与安全边界见 [设计文档](docs/superpowers/specs/2026-09-23-markdown-editor-design.md)。

## English

A local Markdown editor for macOS and Windows. Source editing is powered by CodeMirror 6. The preview supports CommonMark, commonly used GFM features, code block highlighting, Mermaid diagrams, and math formulas. You can browse and search Markdown documents in a local folder. Files are saved to their original `.md` paths, and recovery drafts are stored in Electron's application data directory.

**macOS notice:** The macOS installer in v0.5.0 fails to launch; use v0.5.1 instead. The v0.5.1 installer is still an ad hoc signed trial build. It has not been signed with a Developer ID or notarized by Apple, so Gatekeeper will not automatically allow it to run. If macOS says the app is damaged or refuses to open it, build from source on your Mac or wait for a properly signed and notarized release.

### Development

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

### Build

```bash
npm run build
npm run dist:mac
npm run dist:win
```

Run `dist:mac` and `dist:win` on their respective target operating systems. Unsigned macOS packages are suitable only for local development checks. Distribution requires Developer ID Application signing and Apple notarization.

### Releases

The version is recorded in `package.json` and `package-lock.json`; Git tags use the `vX.Y.Z` format. To release a new version, update the version and `docs/releases/vX.Y.Z.md`, commit the changes, then create and push a tag with the same version. The tag triggers the [Release workflow](.github/workflows/release.yml), which runs tests and builds an installer on macOS and Windows, calculates SHA-256 checksums, and attaches the installers to the corresponding GitHub Release. v0.3.0, v0.4.0, v0.5.0, and v0.5.1 explicitly use ad hoc signed trial builds. Future releases still require proper macOS signing and notarization. A release fails if the version does not match or a build check fails; published releases are not overwritten.

Before releasing a properly signed macOS installer, configure these GitHub Actions secrets: `MAC_CSC_LINK` (Base64-encoded Developer ID Application `.p12`), `MAC_CSC_KEY_PASSWORD` (certificate export password), `APPLE_ID` (Apple developer account), `APPLE_APP_SPECIFIC_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`. Do not commit certificates or passwords to the repository. The ad hoc signing exceptions for v0.3.0, v0.4.0, v0.5.0, and v0.5.1 verify the app signature and DMG integrity, but do not pass Gatekeeper or notarization checks.

For example, to release a patch version:

```bash
npm version patch --no-git-tag-version
# Edit docs/releases/vX.Y.Z.md, then commit the changes
git tag -a vX.Y.Z -m "MDEdit vX.Y.Z"
git push origin HEAD
git push origin vX.Y.Z
```

### Usage

- `Cmd/Ctrl+O` opens a `.md` file; `Cmd/Ctrl+N` creates a new document.
- Open multiple documents in tabs. Use `Cmd/Ctrl+Tab` and `Cmd/Ctrl+Shift+Tab` to switch tabs, and `Cmd/Ctrl+W` to close the current tab. When a tab is focused, the arrow keys, Home, and End also navigate the tabs. Opening a path that is already open focuses its existing tab.
- `Cmd/Ctrl+S` saves immediately; `Cmd/Ctrl+Shift+S` opens Save As.
- The HTML and PDF export controls use the latest content in the current tab. HTML is a single file containing local images, diagrams, and formula fonts; PDF uses A4 page size. Remote images are not loaded. An error is shown if a local image cannot be read.
- `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, and `Cmd/Ctrl+K` insert common Markdown markers.
- `Cmd/Ctrl+F` opens Find and Replace.
- The toolbar can set the current block to body text or H1–H5, insert a GFM table with a chosen number of rows and columns, convert the current line or selected lines to a bullet list, numbered list, or task list, and insert a quote or code block.
- Select a local directory using the folder picker. In the left pane, browse its file tree to expand subfolders and open Markdown documents, or search the folder's Markdown content. Search results jump to matching text and are limited to 100 entries. Files larger than 5 MiB, unreadable files, and files that are not valid UTF-8 are counted as skipped.
- Choose system, light, or dark appearance. A manual selection is saved on this machine.
- The left outline is generated live from the current document's H1–H6 headings. Click a heading to jump to it. The editor and preview stay aligned by heading, and preview code blocks can be copied with one click.
- Fenced code blocks are highlighted when they have an explicit language label. Blocks with no label or an unrecognized language are shown as plain text.
- Paste or drag PNG, JPEG, GIF, WebP, or AVIF images into the editor to save them in an `images/` folder next to the document and insert relative paths. For an unnamed document, choose where to save it first. Each image is limited to 10 MiB; each import can contain up to 20 images and 50 MiB in total.
- Use a `mermaid` fenced code block to preview a diagram. Use `$...$` and `$$...$$` for inline and block formulas. Syntax errors are shown only at the affected diagram or formula.
- Named documents in each tab are saved automatically about 2 seconds after typing stops. Unnamed documents save only recovery drafts. Before closing a tab with unsaved content, the app first backs it up as a recovery draft.

Folder access is limited to directories selected through the system dialog during the current session. The file tree and search reject static symlinks and paths outside the selected folder. A path race is still possible if another local process repeatedly replaces directories during a read or write, so this mechanism should not be treated as isolation from a malicious process on the same machine. Local images are allowed only in the corresponding document's directory or its subdirectories. Remote images are not loaded by default. If another program modifies a document, the app stops overwriting it and offers to reload it or save a copy. See the [iteration roadmap](docs/roadmap.md) for planned work.

See the [design document](docs/superpowers/specs/2026-09-23-markdown-editor-design.md) for product scope and security boundaries.
