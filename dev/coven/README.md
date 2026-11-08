# Coven（v1：半自动、按基线重构）

Coven 是“Dedicatus 检查 + Aeolian 编排 + 人类关键决策”的整套体系。这里是 v1 的 Aeolian 部分：维护者本机的 Claude Code 监控 session（按 `skills/coven-supervisor` 操作）调用这些确定性脚本，把 Dedicatus 基线里的旧违规一条条清掉。

v1 只做一种动作：**按基线重构**。输入是 `dev/dedicatus/baseline.json` 的条目，或者 `eslint-suppressions.json` 里某条规则在某个目录下的抑制；产出是指向本次集成分支 `coven/run-<日期>`、让基线变小的 PR。

## 角色

| 角色 | 形态 | 做什么 |
| --- | --- | --- |
| 监控 session | 维护者本机的 Claude Code session | 认领、递决策、派发、评审、开 PR、收尾；只通过下面的脚本写 GitHub |
| planner | 子代理，只读 | 通读范围，产出每个任务的契约、分组、顺序、升级项（`roles/planner.md`） |
| generator | 独立的工作 session，自己的 worktree | 按契约改代码、提交；不做任何 GitHub 写操作（`roles/generator.md`） |
| evaluator | 每轮新开的子代理，只读 | 逐项判验收项、按严重度列问题（`roles/evaluator.md`） |

## 脚本

| 命令 | 文件 | 做什么 |
| --- | --- | --- |
| `npm run coven:scope` | `scope.mjs` | 从基线或抑制生成范围，逐条算风险级（`risk.mjs`，规则在 `config.json` 的 `risk`） |
| `npm run coven:state` | `state.mjs` | 账本 `.coven/state.json`：开始、阶段流转、人类介入、花费、收尾写运行记录、运行后审计 |
| `npm run coven:claim` | `claim.mjs` | `coven:` 认领评论：认领、续租、改状态、释放；判定是纯函数 `resolveClaims` |
| `npm run coven:prompt` | `prompt.mjs` | 把角色模板填成提示，变量没定义直接报错 |
| `npm run coven:contract` | `contract.mjs` | 导入 planner 的契约、给人看、批准（HD2）、按评审结论翻 `passes` |
| `npm run coven:verify` | `verify.mjs` | 在工作 session 的 worktree 里跑确定性验收项，查范围、契约改动和基线 |
| `npm run coven:pr` | `pr.mjs` | 唯一开 PR、合 PR 的入口，只指向集成分支 |

写 GitHub 的命令（claim、pr，以及会改认领评论的 state）只在有 `.coven/state.json` 的检出里能跑，也就是监控 session 那里。工作 session 的 worktree 里没有这个文件。

## 关口

- **风险级**：R0 只动空白和引号，R1 可自动修复的 lint，R2 普通的边界和环，R3 碰到敏感路径（主进程、平台接口、播放时序、持久化设置……），R4 碰到项目规则、CI、检查规则、依赖（只写方案）。由代码和路径确定性地算，planner 只能往上调（D807）；契约的 `scope.paths` 能改到哪一级的路径，风险级就至少是那一级。
- **HD2**：R2 及以上的契约要维护者批准才能进 building；R0/R1 用 `approve --auto`。批准记的是契约指纹，批准后改了契约就不算批准；重新批准要维护者 `--reapprove --by`。
- **契约**：批准后只有验收项的 `passes` 能变（D804）；diff 不能出 `scope.paths`（D803，基线和抑制文件总是允许，但不许有任何一条增长，D001）；重构必须让条目从基线消掉，Dedicatus 也查不出来（D806）；有一项没过就不能开 PR（D802）。
- **评审**：每轮新开 evaluator，最多 `maxReviewRounds` 轮，还不过就 blocked（D811）。结论绑定 verify 跑的提交和契约指纹，之后有新提交就要重新评审。blocked 的任务要维护者 `--unblock-by` 才能回去干活。
- **预算**：`budget.perTaskUsd`、`budget.perRunUsd`，到了就 blocked（D813）。

## 干跑

`dev/coven/config.json` 的 `hd0Confirmed` 为 false（HD0：模型、预算、身份、签名还没拍板），或者 `coven:state -- init` 没加 `--live`，就是干跑：认领评论只记在状态文件里，PR 只写正文到 `.coven/prs/`。工作 session 照常改代码、提交，评审照常进行。

## 本地文件（`.coven/`，git 忽略）

| 路径 | 内容 |
| --- | --- |
| `state.json` | 本次运行的账本 |
| `scopes/<名字>.json` | 范围 |
| `contracts/<任务>.json`、`<任务>.approved.json` | 契约，和 HD2 批准时的快照 |
| `verify/<任务>-<提交>.json`、`<任务>-latest.json` | 确定性检查的结果 |
| `reviews/<任务>-r<轮>.md` | 评审记录 |
| `prs/<任务>.md` | PR 正文 |
| `runs/` | 运行记录（JSON）和总结（Markdown） |

## 认领协议

多位维护者各自跑监控 session 时，用 `coven:` 评论防撞车。一条认领从头到尾只用同一条评论，状态变了就编辑它：首行给人看（`coven: claimed @维护者 · 重构 \`条目\` · 租约至 …`），后面跟一个隐藏标记给脚本读。

- 只认维护者（OWNER、MEMBER、COLLABORATOR）发的；别人发的忽略（D831）。
- 租约内的有效认领里，评论创建得最早的持有条目；晚到的让出（D830）。按 `claimId` 区分，同一位维护者开两个监控 session 也不会撞车。
- 租约默认 12 小时，监控 session 每次被唤醒时续租；过期没续的可以接手（D832），接手方在新认领里点名接手了谁，被接手的那条之后再续租也不算数。
- 维护者手动处理时也可以手写一条 `coven: claimed @自己`（跟踪 issue 上要带条目的 key），监控 session 会尊重它。

D8xx 的定义在 `dev/dedicatus/codes.mjs`。
