# MDEdit

面向 macOS 和 Windows 的本地 Markdown 编辑器。源码编辑使用 CodeMirror 6，预览支持 CommonMark、常用 GFM 和显式语言标记的代码块高亮。可选择本地文件夹浏览和搜索 Markdown 文档。文件保存在原 `.md` 路径，恢复草稿存放在 Electron 的应用数据目录。

**macOS 特别说明：** `v0.2.1` 原始 DMG 因签名不完整已撤下。GitHub Release 现提供 `MDEdit-0.2.1-arm64-adhoc.dmg` 临时签名试用包；它未经 Developer ID 签名和 Apple 公证，Gatekeeper 不会自动放行，下载后可能无法直接打开。如系统仍提示“已损坏”，请在本机从源码构建，或等待正式签名和公证的版本。

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

版本号保存在 `package.json` 和 `package-lock.json`，Git 标签使用 `vX.Y.Z`。发布新版本时，先更新版本号与 `docs/releases/vX.Y.Z.md`，提交代码，然后创建并推送同名标签。标签触发 [Release 工作流](.github/workflows/release.yml)：在 macOS 和 Windows 分别运行测试、构建安装包，计算 SHA-256，并将安装包附到对应的 GitHub Release。版本不匹配、macOS 签名或公证失败时发布会失败，已发布的版本不覆盖。

发布 macOS 安装包前，在 GitHub Actions Secrets 配置 `MAC_CSC_LINK`（Developer ID Application `.p12` 的 Base64 内容）、`MAC_CSC_KEY_PASSWORD`（证书导出密码）、`APPLE_ID`（Apple 开发者账号）、`APPLE_APP_SPECIFIC_PASSWORD`（应用专用密码）和 `APPLE_TEAM_ID`。不要将证书或密码提交到仓库。发布流程会验证应用签名、Gatekeeper 评估及公证票据；缺少凭据时不会生成新 Release。

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
- `Cmd/Ctrl+B`、`Cmd/Ctrl+I`、`Cmd/Ctrl+K` 插入常用 Markdown 标记。
- `Cmd/Ctrl+F` 打开查找与替换。
- 工具栏可设置正文或 H1～H5，按行列数插入 GFM 表格，也可将当前行或选中的多行转换为无序列表、数字有序列表和任务列表，或插入引用和代码块。
- “打开文件夹”选择本地目录；左侧“文件”按需展开子文件夹并打开 Markdown 文档，“搜索”查找该文件夹内的 Markdown 内容。搜索结果可跳转到命中处，最多显示 100 条结果；超过 5 MiB、无法读取或不是有效 UTF-8 的文件会计入跳过数量。
- 外观可选择跟随系统、浅色或深色；手动选择会保存在本机。
- 左侧目录根据当前文档的 H1～H6 实时生成；点击标题可跳转。编辑区与预览区按标题同步定位，预览代码块可一键复制。
- 围栏代码块根据显式语言标记高亮；未标记或无法识别的语言显示普通代码文本。
- 各标签的已命名文档停止输入约 2 秒后自动保存；未命名文档只保存恢复草稿。关闭仍有未保存内容的标签前会先备份恢复草稿。

文件夹访问基于本次会话中通过系统对话框选择的目录；文件树与搜索拒绝静态符号链接及越界路径。若同机进程在读写期间持续替换目录，仍存在路径竞态，不能将此机制视为对恶意本地进程的隔离。本地图片只允许位于对应文档的目录及子目录。远程图片默认不加载。文档被其他程序修改时，应用会停止覆盖并提供重新载入或另存副本。后续功能范围见 [迭代规划](docs/roadmap.md)。

产品与安全边界见 [设计文档](docs/superpowers/specs/2026-09-23-markdown-editor-design.md)。
