# Coven

半自动的代码库维护编排。维护者本机的 Claude Code session 当监控者，按 [`skill/SKILL.md`](skill/SKILL.md) 操作，调用这里的确定性脚本：

- 把一批待处理的条目（检查器的基线、lint 抑制……）认领下来；
- 交给只读的 planner 写契约，维护者批准；
- 派 generator 在各自的 worktree 里实现；
- 每一轮新开 evaluator 评审；
- 开只指向本次集成分支的 PR。

写 GitHub 只走脚本，关口由脚本把着，LLM 绕不过去。

这个包不知道自己装在哪个项目里：项目的东西（工作从哪来、怎么验证、哪些路径敏感、角色提示里的项目规则、怎么准备 worktree）全部由**适配层**给。包里只能 import 自己的文件和 Node 内置模块，运行时零依赖，以后可以原样拆成独立仓库。Folia 的适配层在 `dev/coven/`。

## 接入一个项目

1. 写一份配置（字段见下），在宿主仓库根目录的 `package.json` 里指过去：`"coven": { "config": "<路径>" }`。也可以在根目录放一个 `coven.config.json`，或者设环境变量 `COVEN_CONFIG`。
2. 写一个适配层模块，配置里的 `adapter` 指向它（相对配置文件）。模块默认导出 `defineAdapter({...})`（`import { defineAdapter } from 'coven'`），接口见 [`src/adapter.mjs`](src/adapter.mjs) 和下面一节。
3. `.coven/` 加进宿主仓库的 `.gitignore`。
4. 命令行入口是 `coven <命令>`（`bin/coven.mjs`）。监控 session 在宿主仓库的检出里跑全部命令；工作 worktree 里只用得上 `coven setup`（其余命令要 `.coven/state.json`，只在监控 session 那里有）。宿主仓库一般给每个命令配一个 npm script。
5. 监控 session 的操作手册是 [`skill/SKILL.md`](skill/SKILL.md)。宿主仓库自己的 skill 用同一个名字（`coven-supervisor`），只写项目的部分（命令怎么叫、来源、准备 worktree、怎么真跑应用），开头指向这份手册。

### 配置

| 字段 | 内容 |
| --- | --- |
| `adapter` | 适配层模块的路径，相对配置文件 |
| `repo` | `owner/name` |
| `baseBranch` | 集成分支从哪切，默认 `main` |
| `hd0Confirmed` | HD0（模型、预算、身份、签名）定了没有；为 false 时只能干跑 |
| `trackingIssue` | 跟踪 issue 的编号：不属于某个 issue 或 PR 的条目，认领评论发在这里 |
| `prLabels` | Coven 开的 PR 带的标签 |
| `leaseHours`、`timeZone`、`timeZoneLabel` | 认领的租约时长；评论里显示租约用的时区 |
| `concurrency`、`maxReviewRounds` | 同时几个 generator；评审最多几轮（到了报 D811） |
| `budget` | `perTaskTokens`、`perRunTokens`，到了报 D813；`null` 不设 |
| `git.signCommits` | generator 的提交签不签名 |
| `roles` | `planner`、`generator`、`evaluator` 各用什么 `model` 和 `effort` |
| `risk` | 敏感路径表：`r3`、`r4` 两组，每条 `{ prefix 或 pattern, why }` |

### 适配层接口

| 字段 | 内容 |
| --- | --- |
| `id` | 名字 |
| `sources` | 范围的来源：`{ <名字>: { describe, options?, list({ root, options }), hints?({ root }) } }`。`list` 返回条目 `{ key, kind, paths, code?, riskPaths?, note? }`，`options` 是这个来源收的命令行选项。`hints` 可选，返回 `{ <选项>: [{ value, label?, count? }] }`，Compass 拿它给选项列候选值 |
| `itemKeyPattern` | 可选：维护者手写的认领首行里，条目 key 长什么样（不能带 g、y 标志）；不给就认反引号包着的第一个 token |
| `baseRisk(item)` | 条目本身的基础风险级（R0–R4）；harness 再按 `risk` 表的路径往上调 |
| `ledger` | 可选：“只减不增”的账本，`{ files, growth({ readBase, readHead, renameMap, newFiles }) }`。`files` 是相对文件路径。账本文件任何任务都能改，但 `growth` 报出的增长一律拦下（D841）；删掉账本文件也该报 |
| `checks` | 验收种类：`{ <kind>: { deterministic, run?(ctx), validate?(verify), order?, runsApp? } }`。确定性的由 `coven verify` 跑；`runsApp` 的要 evaluator 真跑应用 |
| `requiredKinds` | 可选：某种动作必须有的验收，例如 `{ refactor: ['baseline'] }`（D806） |
| `worktree` | 可选：`flags` 是 `coven setup` 收的开关；`setup({ root, worktree, flags })` 准备工作 worktree；`inspect(worktree)` 返回要写进 verify 结果的提醒 |
| `prompts` | `planner()`、`generator({ contract })`、`evaluator({ contract })` 各返回一组项目片段（字符串），填进 [`roles/`](roles/) 模板里的 `{{project.*}}`。planner 要 `itemsIntro`、`reading`、`escalateWhen`、`scopeNote`、`criteria`、`extraRules`，可选 `example`（输出格式的例子）；generator 要 `setup`、`steps`（列表）、`commitExample`、`forbidden`、`selfChecks`；evaluator 要 `reviewChecks`、`severity`，可选 `runApp`（怎么真跑应用）。加载适配层时就会用桩数据核对一遍 |

`test/fixtures/adapter.mjs` 是一个和任何项目都无关的最小适配层，测试用它把整条流程走一遍。

## 命令

每个命令都认 `--help`，列出它的子命令和选项。

| 命令 | 做什么 |
| --- | --- |
| `coven scope` | 从适配层的来源生成范围，逐条算风险级（HD1）。`--help` 还会列出来源和它们的选项 |
| `coven state` | 账本 `.coven/state.json`：开始（取作品号、切集成分支）、阶段流转、升级的决定（HD4）、人类介入、用量、收尾、审计 |
| `coven claim` | `coven:` 认领评论：认领、续租、改状态、释放 |
| `coven prompt` | 把角色模板填成提示 |
| `coven contract` | 导入 planner 的契约（给任务编号）、给人看、批准（HD2）、记录评审结论 |
| `coven verify` | 在工作 worktree 里跑关口和确定性验收项 |
| `coven pr` | 开 PR、合并，只进集成分支 |
| `coven setup` | 按适配层准备一个工作 worktree |
| `coven compass` | Coven Compass：本机网页，看运行和认领、划范围、看历史（见下一节） |

写 GitHub 的命令（claim、pr，以及会改认领评论的 state）只在有 `.coven/state.json` 的检出里能跑，也就是监控 session 那里。

## Coven Compass

`coven compass [--port 4317] [--open]` 在监控 session 的检出里起一个本机网页（只听 `127.0.0.1`），给维护者看和划范围用：

| 页 | 内容 |
| --- | --- |
| 运行 | 这次运行的任务、阶段、轮数、用量、PR，升级和维护者的决定，人类介入的时间线；每几秒自动刷新 |
| 认领 | 借本机 `gh` 读跟踪 issue 上的认领评论，用和脚本同一套判定（`resolveClaims`）列出每个条目归谁、租约到几点、有没有冲突和过期；标出哪些是这个检出的 |
| 划范围 | 选适配层的来源，按它的选项（`hints` 给候选值）列出候选，风险级和敏感原因由脚本算；勾选后存成 `.coven/scopes/<名字>.json`：条目和 `coven scope` 生成的一样，`source` 另外记下每组勾选用的来源和选项。读过认领后，候选上会标出谁持有，并写明是什么时候读的 |
| 历史 | `.coven/runs/` 下的运行记录和总结 |

- 它只会写 `.coven/scopes/` 下的范围文件：不写 GitHub，不改 `.coven/state.json`。存范围时按同样的来源和选项重新列一遍：页面传回来的条目对象不算数，有条目已经列不出来（比如刚被修掉），整份拒绝，重新列一次再存。正在跑的运行用的范围不能覆盖；已有的同名范围要页面确认才覆盖；账本读不了时只能存新名字。
- 存好范围不等于开始运行：把范围名交给监控 session，它照常 `coven state init --scope <名字>` 并记 HD1。
- 防护：只认 Host 是 `127.0.0.1` 或 `localhost` 的请求（挡 DNS 重绑定），别的网站发来的请求（Origin 不对）一律拒绝；接口要带页面里的一次性令牌；页面带严格的 CSP，来自 GitHub 和账本的文字都按纯文本放进页面。
- 页面是 `compass/` 下的三个静态文件，没有构建步骤、没有依赖。

## 关口

- **风险级**：由适配层的 `baseRisk` 和配置的 `risk` 路径表确定性地算，planner 只能往上调（D807）。契约的 `scope.paths` 能改到哪一级的路径，风险级就至少是那一级；verify 再按实际改到的路径查一次。R4 只写方案不实现。
- **HD2**：R2 及以上的契约要维护者批准才能开工；R0、R1 用 `approve --auto`。批准记的是契约指纹，批准后改了契约就不算批准；重新批准要维护者 `--reapprove --by`。
- **契约**：
  - 批准后只有验收项的 `passes` 能变（D804）。
  - diff 不能出 `scope.paths`（D803）。
  - 账本不许增长（D841）。
  - 有一项没过就不能开 PR（D802）。
- **verify 的顺序**：clean → D801/D804 → D803 → D807 → D841。前面几道关口没过，就不跑工作区里的代码。
- **评审**：每轮新开 evaluator，最多 `maxReviewRounds` 轮，还不过就 blocked（D811）。结论绑定 verify 跑的那个提交和契约指纹：之后有新提交，就要重新评审。blocked 的任务要维护者 `--unblock-by` 才能回去干活。
- **升级（HD4）**：planner 不能自己定的条目进 `escalations`，导入时编号 `e1`、`e2`……，之后不删。维护者的决定用 `coven state hd HD4 --escalation <编号> --decision replan|release|hold` 记：`replan` 把条目的认领改回 claimed，下一份 planner 提示带上上一轮的问题和这条决定；`release` 释放认领；`hold` 先放着。条目分进任务、被释放、被新的升级取代时，这条升级记下怎么了结的，运行记录里全部保留。
- **预算**：按 token 算，到了就 blocked（D813）。用量用 `coven state cost` 一笔一笔记：属于任务的记到任务上；不属于任务的（planner、监控 session 自己）写 `--role`，记到运行本身，算进整次预算；只拿得到估算值的加 `--approx`，总结里标“约”。
- **开 PR 和合并**：先续租，再核对条目还归自己（D830）。只合目标是集成分支、提交就是评审看过的那个的 PR。

## 代号

按古典乐谱编目（[`src/catalogue.mjs`](src/catalogue.mjs)）。显示名给人读，机器名进分支、文件名和 id。

| 概念 | 显示名 | 机器名 |
| --- | --- | --- |
| 一次真跑 | 作品号 `Op. 3` | `op3`，集成分支 `coven/op3`，占号标签 `coven-op3` |
| 一次干跑 | `WoO 2` | `woo2`，集成分支 `coven/woo2`（只在本地） |
| 任务 | `Op. 3 No. 2 "lyric-match-sources"` | `op3-no2`，工作分支 `coven/op3-no2` |
| 范围 | `Fugue "boundaries"` | `fugue-boundaries`，体裁见 `GENRES` |

- 号只增不回收。占号标签不要删：别的检出取号时，靠它知道这个号用过。
- 风险级在给人看的地方配速度术语：R0 Presto、R1 Allegro、R2 Andante、R3 Adagio、R4 Grave。
- PR 标题末尾会自动加上任务号，例如 `[Op. 3 No. 2]`。

宿主仓库要保护集成分支的话（要求测试通过、禁止强推），分支模式写 `coven/op*`，同时排除任务分支 `coven/op*-no*`：任务分支评审后还要推新提交。

## 干跑

`coven state init` 不加 `--live`（或者配置的 `hd0Confirmed` 为 false），就是干跑：

- 编 WoO 号，集成分支只在本地。
- 认领评论只记在 `.coven/state.json` 的 `dryComments` 里；有跟踪 issue 时，照样读真实的评论。
- `coven pr` 不推送、不开 PR：正文写到 `.coven/prs/`，标题记进账本，给人看的地方写“干跑 PR”。
- `coven pr --merge` 在本地把工作分支合进集成分支（`git merge-tree`，不切换任何检出）。后面依赖前面任务的任务，从集成分支切出时能看到前面的提交。

## 认领协议

多位维护者各自跑监控 session 时，用 `coven:` 评论防撞车。一条认领从头到尾只用同一条评论，状态变了就编辑它：首行给人看，后面跟一个隐藏标记给脚本读。

- 只认维护者（OWNER、MEMBER、COLLABORATOR）发的；别人发的忽略（D831）。
- 租约内的有效认领里，评论创建得最早的持有条目，晚到的让出（D830）。按 `claimId` 区分，同一位维护者开两个监控 session 也不会撞车。
- 租约过期、没人续的可以接手（D832）。接手方在新认领里点名接手了谁，被接手的那条之后再续租也不算数。自己的租约过期了、又没人接手，原地续上。
- 续租时，一小时内续过（或改过状态）的不再编辑评论：监控 session 每次被唤醒都续租，每次都编辑的话，评论的编辑历史全是噪音。续租之后租约总还剩 `leaseHours` 减一小时以上。换状态（working、blocked、done……）总会编辑，顺带续上租约。
- 维护者手动处理时也可以手写一条 `coven: claimed @自己 · \`<条目 key>\``，监控 session 会尊重它。

## 本地文件（`.coven/`，宿主仓库要 git 忽略）

| 路径 | 内容 |
| --- | --- |
| `state.json` | 本次运行的账本 |
| `scopes/<名字>.json` | 范围 |
| `contracts/<任务>.json`、`<任务>.approved.json` | 契约，和 HD2 批准时的快照 |
| `verify/<任务>-<提交>.json`、`<任务>-latest.json` | 确定性检查的结果 |
| `reviews/<任务>-r<轮>.md` | 评审记录 |
| `prs/<任务>.md` | PR 正文 |
| `runs/` | 运行记录和总结（任务、升级和维护者的决定、每次人类介入的内容、用量）；新开一次运行时，上一次的契约、评审等整批挪进 `runs/<运行>/` |

## 代码

8xx 的定义在 [`src/codes.mjs`](src/codes.mjs)：

- D801–D807：开 PR 前的阻断项；
- D810–D813：任务停下等人；
- D820：外部代码未获准运行；
- D830–D832：认领协议；
- D841：账本增长。

## 测试

`test/` 用 vitest（开发依赖），配合 `test/fixtures/adapter.mjs` 这个假适配层。在宿主仓库里由它的 vitest 配置一起跑（Folia：`vitest.config.ts` 的 include 有 `packages/*/test/**/*.test.mjs`）。
