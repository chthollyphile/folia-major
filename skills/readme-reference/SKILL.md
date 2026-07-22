---
name: readme-reference
description: Use when making code, workflow, testing, or documentation changes in this repository and you need targeted project-specific facts from README files before editing. Read only relevant snippets from root README.md or src/README.md; do not load whole README files unless the user explicitly asks for a full document review.
---

# README Reference

这个 skill 用于在修改前从仓库内 README 定位仍然有效的项目上下文，但必须控制读取范围，避免把长 README 整段灌入上下文。

## When To Use

以下情况优先使用：

- 修改前端架构、组件职责、服务层调用关系
- 修改测试策略、测试入口、运行命令
- 修改部署、开发、Electron、workflow 相关内容
- 修改文档、issue template、贡献说明
- 需要确认某个模块在项目中的定位，而不是只看当前文件猜测

## Primary Sources

优先在这些项目文档里定位片段：

- `README.md`
- `src/README.md`
- `sync-server/README.md`（仅当任务涉及同步服务端、Token、D1、Docker 或 Node 部署）

不要默认完整读取这些文件。除非用户明确要求全文审阅，否则每次只读取和当前任务直接相关的小片段。

## Read Budget

默认读取预算：

- 先用 `rg -n` 定位标题、关键词、脚本名、文件名或模块名。
- 每个 README 单次只打开 20-80 行相关片段。
- 同一任务通常不要从 README 读取超过 160 行。
- 如果片段不够，再追加下一个最相关片段，而不是整文件打开。

推荐命令模式：

```bash
rg -n "关键词|脚本名|模块名" README.md src/README.md
sed -n '起始行,结束行p' README.md
sed -n '起始行,结束行p' src/README.md
```

如果不确定关键词，先读目录或标题片段：

```bash
rg -n "^##|^###|components/visualizer|services/|utils/lyrics|部署|脚本" README.md src/README.md
```

## How To Read Them

### `README.md`

主要提取这些信息：

- 项目目标和支持的能力边界
- Web / Electron / Vercel / API 的运行方式
- 当前对外暴露的常用脚本
- 本地音乐、网易云、Navidrome 的产品层说明

适合回答这些问题：

- 这个功能在产品上应该怎么描述
- 这个改动会不会影响既有运行方式
- 某个脚本或部署流程是不是已经对外说明过

读取方式：

- 涉及脚本：先 `rg -n "npm run|常用脚本|部署与开发|build|test" README.md`
- 涉及产品能力：先 `rg -n "核心能力|本地音乐|Navidrome|网易云|AI|Stage API" README.md`
- 涉及 Electron / Vercel / API：先 `rg -n "Electron|Vercel|API|环境变量|部署" README.md`

### `src/README.md`

主要提取这些信息：

- 当前 `src/` 架构图
- 组件、hooks、services、utils 的职责边界
- 推荐阅读顺序
- 模块间依赖关系和真实分工

适合回答这些问题：

- 应该改哪个模块，而不是随便往 `App.tsx` 里塞逻辑
- 某段逻辑更适合放 service、hook、component 还是 util
- 某个现有模块是否已经承担类似职责

读取方式：

- 涉及模块归属：先 `rg -n "Module Boundaries|Where Changes Usually Belong|components/|hooks/|services/|utils/" src/README.md`
- 涉及 visualizer：先 `rg -n "visualizer|歌词可视化|components/visualizer" src/README.md`
- 涉及歌词解析：先 `rg -n "parserCore|lyrics|utils/lyrics|worker" src/README.md`
- 涉及 app-level 装配：先 `rg -n "components/app|App.tsx|PlayerPanel|Home" src/README.md`

### `sync-server/README.md`

主要提取这些信息：

- 当前支持的部署方式和安装脚本
- Token、端口、数据库路径和客户端连接方式
- 同步服务公开的 API 路径

涉及同步服务时，先用 README 了解面向用户的部署约定，再核对 `sync-server/package.json`、`sync-server/install.*`、`sync-server/src/app.ts` 和 `sync-server/src/node.ts`；不要只根据 README 推断后端行为。

## Editing Rule

如果 README 中的信息和代码现状明显不一致：

- 不要盲信 README
- 先以代码真实结构为准
- 在最终修改中顺手修正文档，或者明确指出 README 已经过时

### Strict Constraint: Protect Project Comments

- Keep all comments prefixed with `@note` exactly as they are. These comments mark critical annotations and must not be translated, shortened, modified, or removed.
- If refactoring significantly changes the code structure, preserve these comments as close as possible to the code they are logically associated with.

## Practical Workflow

1. 先判断任务是否涉及项目约定、架构边界或运行方式。
2. 如果涉及，先用 `rg -n` 在对应 README 中找关键词或标题；同步服务任务同时检查 `sync-server/README.md`。
3. 只打开命中的相关行附近片段。
4. 用 README 提供方向，用真实代码确认细节。
5. 如果 README 失真，明确指出并补文档，而不是默默忽略。

## Repository-Specific Heuristics

- 涉及前端主流程，优先看 `src/README.md` 对 `App.tsx`、`Home.tsx`、`services/*` 的职责描述。
- 如果 `src/README.md` 提到的 app-level 装配目录已经演进，优先核对 `components/app/*`、`build*.ts`、`create*.ts` 的现状，旧版的 `components/app/views/*`、`SearchResultsOverlay`、单视图 `Home.tsx` 已经完全清理。
- 涉及测试、开发、部署、脚本，优先看 `README.md` 的“部署与开发”“常用脚本”。
- 涉及在线音乐（网易云、酷狗）、Navidrome 和本地音乐多来源的边界，先看 README 对各个来源的产品说明与 Omni facade 契约，再回到代码实现确认。
- 涉及同步服务时，先看根 README 的产品层说明，再看 `sync-server/README.md` 的运维说明，最后回到 `src/services/sync/*` 和 `sync-server/src/*` 核对实际协议。

## What To Avoid

- 不读相关 README 片段就直接重构模块边界
- 为了“保险”完整读取 `README.md` 或 `src/README.md`
- 在已经有具体文件线索时，仍然大范围读 README
- 把 README 当成绝对真相，不核对实际代码
- 明明发现 README 已经过时，却不说明也不修
