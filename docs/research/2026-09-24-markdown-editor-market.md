# Markdown 编辑器功能调研（2026-09-24）

## 范围与方法

针对 MDEdit 下一版的功能范围，只查 Typora、Obsidian、VS Code、MarkText、Zettlr 的官方文档或项目仓库。下表描述这些产品提供的能力；后面的优先级是针对“以 Markdown 文件编辑为主”的 MDEdit 所做的产品判断，不代表这些产品的路线图，也不表示 MDEdit 当前缺少对应能力。

## 已核实的产品能力

| 功能 | 产品与官方依据 | 对 MDEdit 范围的启发 |
| --- | --- | --- |
| 围栏代码块按语言高亮 | [Typora](https://support.typora.io/Code-Fences/) 在代码围栏指定语言后高亮，并允许修改语言、显示行号和复制代码；[Obsidian](https://obsidian.md/help/syntax) 使用围栏后的语言代码，在阅读视图用 Prism 高亮，同时说明编辑视图可能与阅读视图呈现不同；[Zettlr](https://docs.zettlr.com/en/scientific-technical/code-blocks.html) 提供语言代码补全，无语言代码时不高亮。 | 以代码围栏后的语言标识为高亮依据，支持常见语言和别名；未标识或不识别时回退为普通代码文本。预览和编辑呈现尽量一致。后两点是基于上述产品行为的建议。 |
| 标题级别与快捷入口 | [Typora](https://support.typora.io/Shortcut-Keys/) 提供标题级别升降、表格、代码围栏等快捷键；[Obsidian](https://obsidian.md/help/syntax) 支持 H1–H6 的 Markdown 标题语法。 | 工具栏提供“正文、标题 1–5”选择，保留源码中的 H6 正常解析，以免限制 Markdown 文件的兼容性。 |
| 表格插入与编辑 | [Zettlr](https://docs.zettlr.com/en/editor/tables/) 的工具栏提供行列网格选择，表格内可用 Tab 移动并在末尾增加行；[Typora](https://support.typora.io/Markdown-Reference/) 可用图形界面插入表格，随后调整行列和对齐；[Obsidian](https://obsidian.md/help/advanced-syntax) 可用“插入表格”命令及右键菜单增删、移动、排序行列。 | 快捷栏增加表格入口。行列网格选取、基本增删行列、对齐和键盘导航应视为完整表格体验的候选范围；具体纳入哪一层由本轮确定。 |
| 多文档标签 | [Obsidian](https://obsidian.md/help/tabs) 支持新建、重排、固定、分组标签，布局可保留到下次打开；[Zettlr](https://docs.zettlr.com/en/split-view/document-tab-bar.html) 的标签展示已打开文档，并支持重排和固定；[VS Code](https://code.visualstudio.com/docs/editing/codebasics) 在有未保存内容的标签上显示标记。 | 首版多标签至少要有新建/打开、切换、关闭、文件名和未保存标记；标签重排、固定、分栏和恢复会话可分层考虑。 |
| 目录/大纲 | [Typora](https://support.typora.io/Outline/) 的侧栏根据标题层级生成大纲，支持点击跳转、当前章节高亮、搜索和折叠；[Obsidian](https://obsidian.md/help/plugins/outline) 的大纲列出活动文档标题并能跳转、拖动调整章节；[VS Code](https://code.visualstudio.com/Docs/languages/markdown) 的 Outline 显示标题树。 | 优先把“目录”定义为随当前标签切换的标题大纲侧栏，支持层级、跳转和当前章节定位。 |
| 插入文内目录 | [Typora](https://support.typora.io/TOC/) 用 `[toc]` 插入随标题更新的文内目录，同时明确不同 Markdown 引擎对该语法的支持不同。 | 文内目录与大纲侧栏是不同功能；若要加入，应单独确认 Markdown 可移植性与导出效果。 |

## 其他值得讨论的补充能力

| 候选能力 | 官方依据 | 价值判断 |
| --- | --- | --- |
| 编辑区与预览区滚动同步、预览点击返回源码 | [VS Code Markdown 文档](https://code.visualstudio.com/Docs/languages/markdown) 描述双向滚动同步及双击预览定位源码。 | 长文档中频繁对照时收益直接，建议优先确认。 |
| 自动保存、异常退出恢复、未保存状态清晰提示 | [VS Code 基础编辑文档](https://code.visualstudio.com/docs/editing/codebasics) 说明自动保存、未保存标记和 Hot Exit 恢复；[Obsidian 文件恢复](https://obsidian.md/help/plugins/file-recovery) 提供定期快照。 | 多标签增加忘记保存或误关文档的风险；建议与多标签一起确定基本行为。定期历史快照可后置。 |
| 文内查找/替换与快速定位标题 | [Zettlr 搜索文档](https://docs.zettlr.com/en/editor/search.html) 支持文内查找、替换和正则；[VS Code Markdown 文档](https://code.visualstudio.com/Docs/languages/markdown) 支持按标题搜索跳转。 | 常用且与目录互补；基础查找/替换优先，正则可后置。 |
| 粘贴/拖入图片并管理相对路径 | [Typora 图片文档](https://support.typora.io/Images/) 支持粘贴、拖入、复制到目标文件夹和相对路径；[VS Code Markdown 文档](https://code.visualstudio.com/Docs/languages/markdown) 也支持粘贴图片并复制到工作区。 | 减少手写图片路径，建议作为下一层高价值编辑体验。 |
| 文件或标题链接补全、失效链接检查 | [VS Code Markdown 文档](https://code.visualstudio.com/Docs/languages/markdown) 支持路径/标题补全及本地链接校验；其移动或重命名时更新链接属于可配置能力。 | 多文档编辑时更有价值；先考虑补全与本地失效提示，自动改写链接宜谨慎。 |
| 字数/字符数、清单与扩展预览 | [Zettlr 状态栏](https://docs.zettlr.com/en/editor/statusbar.html) 显示字数和字符数；[Obsidian 语法文档](https://obsidian.md/help/syntax) 支持任务清单；[VS Code Markdown 文档](https://code.visualstudio.com/Docs/languages/markdown) 内建 Mermaid 和数学公式预览；[MarkText 官方仓库](https://github.com/marktext/marktext) 说明其支持 GFM、数学公式、PDF/HTML 导出和多种编辑模式。 | 字数与清单适合常规文档；Mermaid、公式、导出更依赖目标用户群，建议单独评估。 |

## 建议确认的范围与顺序

1. **本轮必选（用户已提出）**：代码块预览按语言高亮；快捷栏表格入口；标题 1–5 选择；多标签；当前文档标题大纲。
2. **建议并入本轮的体验闭环**：表格至少能选行列并编辑基本结构；标签有未保存标记与关闭确认/恢复行为；大纲可点击跳转并跟随当前标签；常见语言别名与未知语言回退。这里是对五项必选功能的可用性边界建议。
3. **优先讨论的新增项**：编辑/预览定位与滚动同步、自动保存或异常退出恢复、文内查找/替换、粘贴图片与相对路径。这些直接服务于长文档和多文档编辑。
4. **可在后续版本单独评估**：文内 `[toc]`、标签分组/分栏、Mermaid、数学公式、导出、跨文件链接维护与完整历史快照。文内 `[toc]` 还涉及非标准语法的兼容性问题。

### 需要产品层面定口径的两点

- “目录”是只需导航侧栏，还是同时要求插入文内目录？从产品证据看两者应分别决策。
- “各语言高亮”是覆盖常见语言、标识别名和回退规则，还是要求特定语言清单？建议以目标用户常用语言清单验收，避免“所有语言”无法验证。
