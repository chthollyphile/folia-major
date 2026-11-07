# Dedicatus

Folia 的架构检查和 lint。检查发现的每个问题都带一个代码，比如 `D102`。代码的名字和级别以 [`codes.mjs`](codes.mjs) 为准。

## 怎么跑

| 命令 | 做什么 |
| --- | --- |
| `npm run dedicatus` | 模块图检查：分层边界、循环依赖。本机有 `origin/main` 时会拿它当比较基点（见下面的“和目标分支比”），约 6 秒。加 `--no-base` 只看当前代码，不到 1 秒。不需要装依赖 |
| `npm run lint:install` | 安装 ESLint 的隔离环境（`dev/dedicatus/lint/`）。第一次使用、或者它的 lockfile 变了以后跑一次 |
| `npm run lint` | ESLint（带类型信息的检查），全仓约 2 分钟 |
| `npm run dedicatus -- --all` | 上面两样一起跑 |
| `npm run dedicatus -- --prune` | 删掉基线里已经修好的条目 |
| `npm run lint:prune` | 删掉 ESLint 抑制文件里已经修好的条目 |
| `npm run dedicatus -- --migrate-renames` | 挪了文件（git 能认出的改名）以后，把基线和抑制文件里的旧路径换成新路径 |
| `npm run dedicatus -- --adopt-moved` | 拆了文件以后，把新文件里搬过去的旧违规登记进基线和抑制文件，并删掉旧文件里记多的条目 |
| `npm run lint:fix -- <路径>` | 自动修复。必须给路径 |

其他参数：`--json`、`--github`、`--base <ref>`、`--no-base`、`--show-known`、`--mode report|enforce`。

## 规则从哪来

- **分层边界**（1xx、2xx）：规则在 [`rules.mjs`](rules.mjs)。代码地图 `docs/CODEMAP.md` 也读这份规则。
- **循环依赖**（D301）：只看模块加载时就会执行的导入。`import type`、只有动态 `import()` 的边不算。
- **`@note` 注释被改动**（D506）：拿 diff 和比较基点比。AGENTS.md 规定，没有明确指令时不能删除、改写或翻译 `@note` 注释。保护范围是整条注释，包括 `@note` 那一行和紧跟在后面的注释续行。
- **ESLint**（4xx）：配置在根目录的 [`eslint.config.mjs`](../../eslint.config.mjs)，包括 `typescript-eslint` strictTypeChecked、react-hooks、风格规则，以及本地插件 [`eslint/plugin.mjs`](eslint/plugin.mjs) 里的项目约定规则。没有专门代码的规则统一报 D490，并附上规则 id。

ESLint 装在隔离环境里，钉住 TypeScript 6.0。原因是 typescript-eslint 要用 TypeScript 的编译器 API，而项目用的 TypeScript 7 没有提供。等 typescript-eslint 正式支持 TypeScript 7.1，就撤掉这个隔离环境。

## 旧账只减不增

- 已有的分层违规和循环依赖记在 [`baseline.json`](baseline.json)。已有的 ESLint 违规记在根目录的 `eslint-suppressions.json`，按“文件 × 规则”计数。
- 修好一条旧违规以后，要用 `--prune` 或 `lint:prune` 把它从记录里删掉，否则报 D002。
- 不要往基线和抑制文件里加条目。CI 会拿它们和目标分支比较，多出来的报 D001。下面两种情况有专门的命令，不算增加：
  - **挪文件**（git 能认出的改名）：跑 `--migrate-renames`，记录里的路径跟着换。
  - **拆文件**（把一部分代码搬进新文件，或者挪文件的同时改了很多）：跑 `--adopt-moved`。新文件里登记的条目要同时满足两个条件才算搬家：不超过落在挪过来的行上的违规数；同一条规则在别处减少了同样多。新写的代码照样要干净。
- 风格类规则（D430–D432）在本来就是旧风格的文件里不追究，等以后整个文件一起格式化。

## 和目标分支比

有比较基点时，只追究这次 PR 带来的问题。CI 上的比较基点是 PR 的目标分支，本机默认是 `origin/main`。

- 模块图检查：目标分支上本来就有的违规和环，不算这次的。
- ESLint：只报落在**新写的行**上的问题。挪过来的行不算新写，所以拆文件时搬过去的旧违规不会被当成新问题。这次碰过的文件里多出来的其他问题，合成一条 notice，不阻断；它们可能是目标分支上已有的，也可能是别处的改动引起的。没碰过的文件不报。
- 过期的基线和抑制条目（修好了但没 prune）：只追究这次碰过的文件。

目标分支上漏进去的问题，由目标分支自己的 CI 报出来。那次检查在 push 时运行，没有比较基点。

## 输出

- 每个问题一行，只写代码和位置。在 CI 上以注解的形式标在 PR 的 “Files changed” 里，job summary 最多列 30 条。**不发 PR 评论。**
- `report` 模式下照常输出，但不让 CI 失败。`enforce` 模式下，有新的 error 级问题就会失败。默认模式写在 `codes.mjs` 的 `DEFAULT_MODE`。
