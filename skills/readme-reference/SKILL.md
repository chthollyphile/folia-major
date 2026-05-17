---
name: readme-reference
description: Use when making code, workflow, testing, or documentation changes in this repository and you need to consult project-specific facts from README files before editing, especially root README.md and src/README.md.
---

# README Reference

这个 skill 用于在修改前先从仓库内 README 提取仍然有效的信息，避免脱离项目约定瞎改。

## When To Use

以下情况优先使用：

- 修改前端架构、组件职责、服务层调用关系
- 修改测试策略、测试入口、运行命令
- 修改部署、开发、Electron、workflow 相关内容
- 修改文档、issue template、贡献说明
- 需要确认某个模块在项目中的定位，而不是只看当前文件猜测

## Primary Sources

优先读取这两个文件：

- `README.md`
- `src/README.md`

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

## Editing Rule

如果 README 中的信息和代码现状明显不一致：

- 不要盲信 README
- 先以代码真实结构为准
- 在最终修改中顺手修正文档，或者明确指出 README 已经过时

## Practical Workflow

1. 先判断任务是否涉及项目约定、架构边界或运行方式。
2. 如果涉及，先读 `README.md` 或 `src/README.md` 中相关段落。
3. 用 README 提供方向，用真实代码确认细节。
4. 如果 README 失真，明确指出并补文档，而不是默默忽略。

## Repository-Specific Heuristics

- 涉及前端主流程，优先看 `src/README.md` 对 `App.tsx`、`Home.tsx`、`services/*` 的职责描述。
- 如果 `src/README.md` 提到的 app-level 装配目录已经演进，优先核对 `components/app/*`、`build*.ts`、`create*.ts` 的现状，不要默认存在旧的 `view-models/*`。
- 涉及测试、开发、部署、脚本，优先看 `README.md` 的“部署与开发”“常用脚本”。
- 涉及本地音乐、Navidrome、网易云三个来源的边界，先看 README 对三类来源的产品说明，再回到代码实现确认。

## What To Avoid

- 不读 README 就直接重构模块边界
- 把 README 当成绝对真相，不核对实际代码
- 明明发现 README 已经过时，却不说明也不修
