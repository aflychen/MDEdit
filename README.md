# MDEdit

面向 macOS 和 Windows 的本地 Markdown 编辑器。源码编辑使用 CodeMirror 6，预览支持 CommonMark、常用 GFM 和显式语言标记的代码块高亮。文件保存在原 `.md` 路径，恢复草稿存放在 Electron 的应用数据目录。

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

`dist:mac` 和 `dist:win` 应分别在目标系统上运行。未签名的 macOS 包只适合本地开发验证；对外分发需要完成签名与公证。

## 版本发布

版本号保存在 `package.json` 和 `package-lock.json`，Git 标签使用 `vX.Y.Z`。发布新版本时，先更新版本号与 `docs/releases/vX.Y.Z.md`，提交代码，然后创建并推送同名标签。标签触发 [Release 工作流](.github/workflows/release.yml)：在 macOS 和 Windows 分别运行测试、构建安装包，计算 SHA-256，并将安装包附到对应的 GitHub Release。版本不匹配时发布会失败，已发布的版本不覆盖。

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
- 工具栏可设置正文或 H1～H5，按行列数插入 GFM 表格，也可插入列表、任务项、引用和代码块。
- 左侧目录根据当前文档的 H1～H6 实时生成；点击标题可跳转。编辑区与预览区按标题同步定位，预览代码块可一键复制。
- 围栏代码块根据显式语言标记高亮；未标记或无法识别的语言显示普通代码文本。
- 各标签的已命名文档停止输入约 2 秒后自动保存；未命名文档只保存恢复草稿。关闭仍有未保存内容的标签前会先备份恢复草稿。

本地图片只允许位于对应文档的目录及子目录。远程图片默认不加载。文档被其他程序修改时，应用会停止覆盖并提供重新载入或另存副本。后续功能范围见 [迭代规划](docs/roadmap.md)。

产品与安全边界见 [设计文档](docs/superpowers/specs/2026-09-23-markdown-editor-design.md)。
