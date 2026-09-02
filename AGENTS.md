# Project Skills

本仓库不再把项目规则直接堆在 `AGENTS.md` 中，而是改为按 skill 组织。

使用方式：

1. 如果需要的话，先根据任务选择最相关的 skill。
2. 读取对应 `skills/<skill-name>/SKILL.md`。
3. 按 skill 中的触发条件和执行规则完成工作。
4. 如果多个 skill 同时相关，可以组合使用，但只加载当前任务真正需要的内容。
5. 不要主动移除项目中的注释，也不要在没有明确指令的情况下修改、删除或翻译 `@note` 注释。

## 代码定位

按成本从低到高三层：

1. **结构性问题读 `docs/CODEMAP.md`** —— 由编译器和模块图生成（`npm run codemap`），
   CI 会重新生成并比对，**过期在结构上不可能发生**。区域分布、枢纽模块、动态注册点的完整
   展开、分层边界违规都在里面。
2. **符号级问题默认用 rg** —— 快、灵活，还覆盖 `.md`/`.json`/CSS 这些 LSP 看不到的地方。
3. **rg 拿不准时才用 `dev/mcp/ts-code-map/cli.mjs`** —— 同名消歧、引用完备性、调用链、
   影响面这几类 rg 做不了的问题才升级。它是后备，不是默认。

什么时候该升级，见 `skills/codebase-navigation/SKILL.md` 里的对照表。

同一套能力也能作为 MCP server 挂载（`dev/mcp/ts-code-map/server.mjs`），但默认不加载：
工具 schema 每个会话常驻约 6KB，而绝大多数问题读地图加 rg 就解决了。

skill 只负责地图和编译器都推不出来的东西：口头术语到名字的映射，以及架构约束的意图。

当前项目内 skills：

- `codebase-navigation`
  路径：`skills/codebase-navigation/SKILL.md`
  用于说明代码定位的三层顺序（先读生成的代码地图，再用 rg，rg 拿不准才升级到 ts-code-map cli），以及定位之后改动要遵守的分层与模块边界；同时标注了几个已经不存在、但仍会被搜到的历史命名。

- `testing-strategy`
  路径：`skills/testing-strategy/SKILL.md`
  用于决定当前任务应该看热加载报错、跑单测、跑 UI 截图测试，还是避免误跑构建。

- `readme-reference`
  路径：`skills/readme-reference/SKILL.md`
  用于在修改代码、测试、流程或文档前，先从仓库内 README 中提取仍然有效的项目上下文。

- `glossary-alignment`
  路径：`skills/glossary-alignment/SKILL.md`
  用于把开发者口头说的组件、视图、状态、面板、模式等术语换成可检索的符号名或模块名，再交给 MCP 解析成当前路径。表里只有名字，没有路径。

- `file-modularization`
  路径：`skills/file-modularization/SKILL.md`
  用于在新增或重构前端功能时约束文件长度、入口文件职责和模块拆分，避免继续把大量实现堆进 `App.tsx`、页面根组件或单个大文件。

- `frontend-runtime-guardrails`
  路径：`skills/frontend-runtime-guardrails/SKILL.md`
  用于在新增、重构或审查前端运行时行为时约束高频动画、`useMotionValueEvent`、`requestAnimationFrame`、`ResizeObserver` 和 React state 更新频率，避免 visualizer 等路径引入高 CPU 或时序错位。

- `reuse-project-utilities`
  路径：`skills/reuse-project-utilities/SKILL.md`
  用于在实现、重构或审查时提示优先复用仓库已有公共工具和常用库，例如 pretext 文本测量、visualizer runtime、歌词时序 helper、字体/颜色 helper、i18n、lucide 图标和虚拟列表，避免重复造轮子。

- `settings-feature-integration`
  路径：`skills/settings-feature-integration/SKILL.md`
  用于新增或调整设置项时判断接入位置：视觉相关设置必须进入视觉配置导入导出，功能性设置和可执行动作必须注册到 command palette。

- `kugou-provider-alignment`
  路径：`skills/kugou-provider-alignment/SKILL.md`
  用于开发阶段根据 `docs\ku-go-api-docs.md`、`.env.local` 中的真实 KuGou 服务和 `test-results\.dev-credentials` 对齐酷狗 provider 的请求与响应，禁止猜测接口结构。

- `online-song-omni-routing`
  路径：`skills/online-song-omni-routing/SKILL.md`
  用于所有在线歌曲、搜索、播放、歌词、歌单、账户和跨 provider 数据流，确保普通调用经过 Omni，只有 provider adapter/transport 直接接触原始接口。

- `prepare-folia-release`
  路径：`skills/prepare-folia-release/SKILL.md`
  用于进入稳定版本发布流程：汇总上个稳定版本以来的用户可感知变化，更新新功能介绍、桌面与 Docker 版本元数据，并生成可手动粘贴的 Markdown release note。

全局沟通规则：

- 不需要使用skills的时候，不要读取它们。
- 回答用户问题时，直接给出结论，不添加无关的辅助性评价措辞。
- 如果用户指出的是潜在 bug 或不合理设计，需要直接指出问题并给出建议，不回避。
- 如果创建了新的文件，在导入行结束后插入当前文件的注释
- 如果创建了复杂的函数，写出简短的注释，说明函数功能
 
