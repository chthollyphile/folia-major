# Coven 的 Folia 适配层

Coven 是“检查器 + 编排 + 人类关键决策”的整套体系。编排部分（harness）在 [`packages/coven/`](../../packages/coven/README.md)，不依赖 Folia，以后可以拆成独立仓库，那里的 README 讲认领协议、契约和关口、代号、干跑。这个目录是 Folia 接上它的地方：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 运行配置：仓库、跟踪 issue、HD0 的决定（模型、预算、并发、租约、签名、PR 标签）、敏感路径表。根目录 `package.json` 的 `"coven": { "config": … }` 指到这里 |
| `adapter.mjs` | 适配层：范围的来源、风险的基础级别、账本、验收种类、角色提示里的 Folia 部分 |
| `setupWorktree.mjs` | 工作 worktree 怎么准备（`npm run coven:setup`） |

监控 session 怎么操作，见 `skills/coven-supervisor/SKILL.md`（Folia 的部分），以及它指向的通用手册 `packages/coven/skill/SKILL.md`。

## 来源：工作从 Dedicatus 来

- `baseline`：`dev/dedicatus/baseline.json` 的条目，一条一项。`--codes` 按前缀筛（`D1` 是全部分层边界）；代码已经废弃或不存在的跳过。
- `lint`：`eslint-suppressions.json` 里某条规则在某个目录下的抑制，每个“规则 × 目录”一项，key 是 `lint:<规则>@<目录/>`。一个目录几十个文件，逐个认领会刷屏。风险按其中每个文件算。

在 Coven Compass 里划范围时，两个来源都给选项的候选值（`hints`）：`baseline` 列出基线里有哪些代码、各几条；`lint` 列出有抑制的规则和目录（到第三层），按抑制数排。

风险的基础级别：

- 只动空白和引号的风格规则（D430–D432）是 R0；
- 可自动修复的 `consistent-type-imports`（D405）是 R1；
- 其余是 R2。

harness 再按 `config.json` 的 `risk` 表往上调。

## 账本：基线和抑制只减不增

`ledger.files` 是 `dev/dedicatus/baseline.json` 和 `eslint-suppressions.json`。任何任务都能改这两个文件（修好以后要 prune），但 `coven verify` 每次都查有没有任何一条增长（D841），用的是 Dedicatus 自己的 `baselineGrowthWithTransfers` 和 `suppressionGrowth`。

- 挪文件时，条目跟着改名走，不算增长；前提是跑过 `npm run dedicatus -- --migrate-renames`。
- 抑制这边比 CI 严：CI 能把搬进新文件的抑制按挪过来的行抵扣；D841 只比账本文件、不看搬了哪些行，拆文件时带走抑制的重构会被拦下，交给维护者。

## 验收种类

| 种类 | 确定性 | 怎么判 |
| --- | --- | --- |
| `typecheck` | 是 | `node_modules/typescript/bin/tsc --noEmit` |
| `unit` | 是 | `vitest run -c vitest.config.ts <target…>`；Node 25 自动加 `--no-experimental-webstorage` |
| `dedicatus` | 是 | `dev/dedicatus/cli.mjs --json --base <合并基点> --all`：模块图检查，加上改过的文件的 ESLint（和 CI 的 lint job 一样）；没有新的 error 算过。不用写 `target`，旧契约里的 `graph`、`all` 跑的都是这一套 |
| `baseline` | 是 | 在 dedicatus 之后跑：条目从 HEAD 的基线里消掉、Dedicatus 也查不出来；lint 条目的抑制降到 0。基线一条没少报 D806 |
| `review` | 否 | evaluator 读 diff |
| `component` | 否 | evaluator 跑 Playwright 组件测试 |
| `preview`、`desktop` | 否，要真跑应用 | 开发服务器 + `?skipStartup&mockSong`，或者 `skills/run-desktop` |

重构任务必须有 `baseline`（`requiredKinds`）。

`dedicatus` 总要跑 ESLint，是 Op. 1（2026-11-09，第一次真跑）的教训：`exploreFeedMemory` 从 `src/components/` 挪进 `src/stores/` 后，直接读写 `localStorage` 从 D411（有抑制）变成了 D508（没有抑制）。只跑模块图时 verify 全绿，要到 CI 的 lint 才暴露。ESLint 有按目录生效的规则，挪文件就可能换规则，所以每次都查。

## 准备 worktree

`npm run coven:setup`：

1. 先 `npm ci --ignore-scripts`。
2. 如果失败，而且失败的是 `setupWorktree.mjs` 里登记的“可能被挡的包”（现在只有 `kugoumusicapi`，它从 GitHub 下载 tarball，部分云端环境返回 403），就在 worktree 旁边的临时目录里，用去掉这些包的 package.json 和 lock 再装一次，然后把 `node_modules` 挪进 worktree。worktree 里跟踪的文件一个都不动。
3. 再装 ESLint 隔离环境（`npm run lint:install`）：verify 每次都跑 ESLint。

少装了哪些包，由 `inspect` 告诉 `coven verify` 写进结果，evaluator 据此不把相关的失败算成这次改动的问题。这一步是 2026-11-09 云端干跑（WoO 1）时 generator 自己想出来的，用户定把它固定下来，generator 不再各自想办法。

## 命令

`npm run coven:<命令> -- <参数>`，对应 harness 的 `coven <命令>`：`scope`、`state`、`claim`、`prompt`、`contract`、`verify`、`pr`、`setup`。

## 测试

- harness：`packages/coven/test/`（用一个假适配层，不碰 Folia）；
- 这个适配层：`test/unit/coven/foliaAdapter.test.ts`；
- harness 只 import 自己的文件：`test/unit/dedicatus/contracts/packageIndependence.test.ts`（D308）。
