---
name: coven-supervisor
description: Use when a maintainer asks to run Coven on a scope in Folia (for example "用 coven-supervisor 处理范围 fugue-boundaries", or clearing Dedicatus baseline entries and ESLint suppressions), or to resume, dry-run, or wrap up such a run. This session becomes the supervisor - it claims items, has a read-only planner write contracts, hands contracts to the maintainer, dispatches generators in their own worktrees, has a fresh evaluator review each round, and opens PRs into the run's integration branch, all through the coven scripts. Not for writing the code itself.
---

# Coven 监控 session（Folia）

先读通用手册 `packages/coven/skill/SKILL.md`：铁律、一次运行的 11 步、干跑。这里只写 Folia 的部分。

Coven 的 harness 在 `packages/coven/`（不依赖 Folia），Folia 的适配层在 `dev/coven/`（`adapter.mjs`、`config.json`、`setupWorktree.mjs`，见那里的 README）。

## 命令

通用手册里的 `coven <命令> <参数>`，在 Folia 写成 `npm run coven:<命令> -- <参数>`，例如：

```bash
npm run coven:state -- show
npm run coven:claim -- renew
npm run coven:pr -- --task op3-no2 --title "refactor(lyrics): 把歌词来源的登录判断交给调用方"
```

维护者要自己看运行、划范围时，在监控 session 的检出里开 Coven Compass：`npm run coven:compass`（打开 `http://127.0.0.1:4317/`）。它划好的范围存在 `.coven/scopes/`，用 `npm run coven:scope -- --show <范围名>` 读出来。

## 范围的来源

| 来源 | 内容 | 选项 | 体裁 |
| --- | --- | --- | --- |
| `baseline` | Dedicatus 基线（`dev/dedicatus/baseline.json`）里的条目：边界违规、循环依赖…… | `--codes D1,D190,D301`（按前缀） | `fugue` |
| `lint` | `eslint-suppressions.json` 里某条规则在某个目录下的抑制，每个“规则 × 目录”一项 | `--rules <规则,…> --paths <目录/,…>` | `etude` |

```bash
npm run coven:scope -- --name fugue-boundaries --from baseline --codes D1,D190,D301
npm run coven:scope -- --name etude-stores --from lint --rules @stylistic/indent,@stylistic/quotes --paths src/stores/
```

风险级分两步算：

1. 条目本身的基础级别：只动空白和引号的是 R0，`consistent-type-imports` 这类可自动修复的是 R1，其余是 R2。
2. 再按 `dev/coven/config.json` 的敏感路径表往上调：碰到主进程、平台接口、播放时序、持久化设置的是 R3；碰到项目规则、CI、检查规则、依赖的是 R4。

## HD0（2026-11-08 定，写在 `dev/coven/config.json`）

- planner、evaluator 用 opus high，generator 用 opus medium（2026-11-13 各降一档，原为 xhigh / high）。
- 预算按 token：每个任务 200 万，整次运行不设（Max 订阅按次不花钱，真正的上限是订阅的用量窗口）。
- 并发 1，租约 12 小时；generator 的提交不签名；认领评论用维护者本人的账号。
- 跟踪 issue #1156；Coven 开的 PR 打 `bot: skip`。
- 仓库规则保护 `coven/op*`（排除任务分支 `coven/op*-no*`）：要求单测通过、禁止强推。占号标签 `coven-op*` 不要删。

## 准备 worktree

generator 开工第一步，是在自己的 worktree 里跑 `npm run coven:setup`。

- 先跑 `npm ci --ignore-scripts`，再装 ESLint 隔离环境（verify 每次都跑 ESLint）。不要链接主检出的 `node_modules`。
- 云端环境装不上 KuGouMusicApi（GitHub tarball 返回 403）时，脚本会去掉它再装一次：在 worktree 旁边的临时目录里，用改过的 package.json 和 lock 装，worktree 里跟踪的文件不动。
- verify 会把“没装 kugoumusicapi”写进结果。evaluator 据此不把涉及酷狗的失败算成这次改动的问题。

## 验收种类

| 种类 | 由谁判 | 内容 |
| --- | --- | --- |
| `baseline` | verify | 条目从基线消掉，Dedicatus 也查不出来；lint 条目的抑制降到 0（D806）。重构必须有这一项 |
| `dedicatus` | verify | 模块图和改过的文件的 ESLint 都没有新的 error（和 CI 一样）。不用写 `target` |
| `typecheck` | verify | `tsc --noEmit` |
| `unit` | verify | 指定的 vitest 测试文件 |
| `review` | evaluator | 只是搬移和改引用、没有行为变化；挪文件的提交只挪不改；没加 `eslint-disable`、基线或抑制条目 |
| `preview`、`desktop` | evaluator | 真跑应用：开发服务器加 `?skipStartup&mockSong`，或者 `skills/run-desktop` |
| `component` | evaluator | Playwright 组件测试 |

账本（D841）就是基线和抑制文件：任何任务都能改，但不许有任何一条增长。挪了文件要跑 `npm run dedicatus -- --migrate-renames`，让条目跟着改名，否则会被当成增长。

## 收尾

集成分支进 main 的 PR 由维护者开，标题写 `chore(dev): Coven Op. 3 合入 main`。

D8xx 的定义在 `packages/coven/src/codes.mjs`。
