# Dedicatus

Folia 的架构检查和 lint。检查发现的每个问题都带一个代码，比如 `D102`。代码的名字和级别以 [`codes.mjs`](codes.mjs) 为准。

## 怎么跑

| 命令 | 做什么 |
| --- | --- |
| `npm run dedicatus` | 模块图检查：分层边界、循环依赖。本机有 `origin/main` 时会拿它当比较基点（见下面的“和目标分支比”），约 6 秒。加 `--no-base` 只看当前代码，不到 1 秒。不需要装依赖 |
| `npm run lint:install` | 安装 ESLint 的隔离环境（`dev/dedicatus/lint/`）。第一次使用、或者它的 lockfile 变了以后跑一次 |
| `npm run lint` | ESLint（带类型信息的检查）。有比较基点时只检查改过的文件（2～3 GB 内存，二十秒以内）；`--no-base` 时全仓检查，约 2 分钟、7 GB 内存，内存小的机器会 OOM |
| `npm run dedicatus -- --all` | 上面两样一起跑 |
| `npm run dedicatus -- --prune` | 删掉基线里已经修好的条目 |
| `npm run lint:prune` | 删掉 ESLint 抑制文件里已经修好的条目。默认只看这次改过的文件（目标分支同 `lint:fix-style`），已经不存在的文件的条目总会删掉；改了全仓都受影响的规则配置后用 `-- --all` 全仓清一次（7 GB 内存） |
| `npm run dedicatus -- --migrate-renames` | 挪了文件（git 能认出的改名）以后，把基线和抑制文件里的旧路径换成新路径 |
| `npm run dedicatus -- --adopt-moved` | 拆了文件以后，把新文件里搬过去的旧违规登记进基线和抑制文件，并删掉旧文件里记多的条目 |
| `npm run lint:fix -- <路径>` | 自动修复。必须给路径 |
| `npm run lint:fix-style` | 只修这次改过的文件的排版（缩进、引号、换行），不改代码的意思。旧风格的文件只修没记旧账的那几条规则（和 CI 追究的一致），改了名的按旧路径找旧账。目标分支先找指向主仓库的远程，`--base <ref>` 可换。开 PR 前跑一次。隔离环境没装时先装 |

其他参数：`--json`、`--github`、`--base <ref>`、`--no-base`、`--show-known`、`--mode report|enforce`。

## 规则从哪来

- **分层边界**（1xx、2xx）：规则在 [`rules.mjs`](rules.mjs)。代码地图 `docs/CODEMAP.md` 也读这份规则。
- **循环依赖**（D301）：只看模块加载时就会执行的导入。`import type`、只有动态 `import()` 的边不算。
- **`@note` 注释被改动**（D506）：拿 diff 和比较基点比。AGENTS.md 规定，没有明确指令时不能删除、改写或翻译 `@note` 注释。保护范围是整条注释，包括 `@note` 那一行和紧跟在后面的注释续行。
- **账号凭据写入点**（D604）：代表“谁登录着”的 `token`、`userid`、`cookie` 只能在 [`credentialWriters.mjs`](credentialWriters.mjs) 登记过的函数里写，每个函数还限定能写哪几个键（`*` 只放行运行时才知道的键）。起因是 #1104：处理每个响应的函数都能改写登录账号。新加一处写入要先登记，并说明它是只在确认的登录之后调用，还是自己挡掉了账号项。
  - 检查得到：`writeProviderSessionValue`（含改名导入）、`localStorage.setItem(getProviderSessionKey(…))`，以及酷狗桥接层的会话对象（`sessionCookies`、`cookies`、`ensureCookies()` 和它们的别名，只在那个文件里认）的成员赋值、整个重新赋值和 `Object.assign`。
  - 检查不到：其他平台主进程里的会话仓库（spotify、ytm、qishui、bodian、fnmusic、QQ 包内部）、经中间变量拼出来的存储键、解构赋值、删除和清空。按函数名放行，登记过的函数里注册的回调也算在它名下。
- **ESLint**（4xx）：配置在根目录的 [`eslint.config.mjs`](../../eslint.config.mjs)，包括 `typescript-eslint` strictTypeChecked、react-hooks、风格规则，以及本地插件 [`eslint/plugin.mjs`](eslint/plugin.mjs) 里的项目约定规则。没有专门代码的规则统一报 D490，并附上规则 id；`no-unnecessary-condition` 单独报 D491（warning，只提醒：一半是防运行环境的写法）。
  - 测试文件（`test/**`、`*.test.*`、`*.spec.*`）不管类型感知的严格规则和非空断言、`any`，只留抓漏写 await 之类真 bug 的几条（`no-floating-promises`、`no-misused-promises`、`await-thenable`、`no-array-delete`、`no-for-in-array`）。2026-11-08 拿 open PR 演习时，PR 里的 D490 九成在测试文件。
  - 解构时去掉一个字段（`const { a: _a, ...rest } = obj`）不算没用的变量（`ignoreRestSiblings`）；`no-control-regex` 关掉（这里的控制字符正则都是清洗用的）。
- **Coven 流程**（8xx）：不由 `npm run dedicatus` 报，而是由 Coven harness（[`packages/coven/`](../../packages/coven/README.md)，Folia 的适配层在 [`dev/coven/`](../coven/README.md)）报，代码表在 harness 自己那里：开 PR 前的阻断项（D801–D807）、任务停下等人（D810–D813）、认领协议（D830–D832）、账本增长（D841）。
- **独立包不依赖宿主仓库**（D308）：`packages/` 下的包（现在只有 Coven harness）只能 import 包内的文件和 Node 内置模块，以后才能原样拆成独立仓库。由契约测试检查。

### 项目规则和它们的登记表

这些规则来自 issue、PR、文档里反复出现、已经定下来的不变量。每条都是“某件事只能在登记过的地方做”或“某份清单只加不改”，登记表就是要改的地方，改动写明原因，审查时看得见。

| 代码 | 规则 | 登记表 / 检查 |
| --- | --- | --- |
| D306 | 首屏闭包不静态引入重型包（three、pixi.js、animejs…） | `checks/startupWeight.mjs`（模块图，进基线） |
| D307 | 应用代码只在登记的接入点引用 `src/mods/**` | `modIntegrationPoints.mjs` |
| D310、D112–D114 | 当前歌曲只在 `currentSong.ts` 改；AI 文本门面；歌词解析经 parserCore；导出窗口闭包不拉进应用 store | 已有的架构单测（describe 标题带代码） |
| D311、D312 | 播放路径每次等待之后、写播放状态之前先在条件里问起播令牌；不用 playQueue 引用判断队列换没换 | `playbackTokens.mjs`（`stale-after-await`、restricted-apis） |
| D120、D121、D442 | `whole: true`、“已下架”、调试挂件只在登记的函数里给出 | `registeredSites.mjs` |
| D440、D441 | 高频回调里不无条件写状态；effect 里注册的东西要 cleanup | `hot-callback-state`、`effect-cleanup` |
| D443、D444 | 界面文字尽量走 i18n（D443 是 warning，不阻断；品牌名、产品名、单位在 `eslint.config.mjs` 的 allow 里，网址和“主机:端口”不算）；错误原文不直接进界面 | `ui-literal-text`、`error-text-in-ui` |
| D445、D508、D606、D607、D608、D609 | 只在登记的地方：按词分割器、localStorage、`(window as any).electron`、同步 IPC、系统加密判断、外链 | `restrictedApis.mjs`（含 #594 的明文例外） |
| D507 | 所有持久化的键登记在案，不改名不删 | `storageKeys.mjs`（契约测试） |
| D509 | 每种歌曲资源缓存都有分表和清理分类 | 契约测试 |
| D510 | 以主进程为准的桌面偏好只经它的 store 写 | 契约测试 |
| D511 | 外观类 store 的每个持久化键写明去向：进配置码的哪个字段，或者不进和原因；配置码编码的字段和导入认的字段一致 | `appearanceDestinations.mjs`（契约测试） |
| D512 | 外观短键只加不改 | `appearanceShortKeys.mjs`（契约测试） |
| D513 | Folium 稳定接口只加不改，新增要升 minor | `checks/foliumApi.mjs`（diff 检查） |
| D604 | 账号凭据只在登记的入口写 | `credentialWriters.mjs` |
| D605、D606 | 每个 IPC 通道登记信任级别、第一方通道校验来源；带 preload 的窗口开不出别的窗口、导航不到应用以外的页面；preload 和主进程的通道对得上 | `ipcChannels.mjs`（契约测试） |
| D610 | 重建主窗口带上播放交接快照 | `windowRebuild.mjs` |
| D611 | 不读别的应用的凭据 | `checks/foreignCredentials.mjs`（diff 检查） |
| D122 | 新平台在各处登记齐 | 契约测试 |

契约测试在 `test/unit/dedicatus/contracts/`，跑在 `npm run test:unit` 里，所以它们一开始就是阻断的（不受 report 模式影响）；都是按现状写的，现在全部通过。登记表 2026-11-08 都复核过：IPC 通道见 `ipcChannels.mjs` 文件头，外观设置的去向见 `appearanceDestinations.mjs`（用户定配置码只加 OBS 页面看得到的）。

已知查不到的：

- 按函数名放行（D121、D442、D604）：登记一个函数，等于放行它里面（含匿名回调）的所有写法。`useCallback` / `useMemo` 包着的函数按变量名算。
- D121 把交给查询函数（`.includes`、`.has`、`isX(…)` 等）、比较、下标的 `'taken-down'` 当成读；交给别的函数的当成给出。
- D311 按源码顺序近似判断，不是真正的控制流分析。令牌直接交给被等待的函数（令牌本身或 `() => !overtaken()` 这样的判断函数）、再用 `if (!结果) return;` 判它交回的结果，算那一次 await 之后的复核（`const track = await resolve(…, stillWanted); if (!track) return;`）；令牌存进别的变量再判断（`const fresh = stillWanted(); if (!fresh) …`）不算复核；守卫写反了（`if (stillWanted()) return;`）也算复核。引用了令牌的函数整个算令牌，不管它多大。
- D440 只认 useState 的 setter、从 `use*Store` 取出来的 `set*`、store 的 `setState` / `getState().set*`；经 props 传进来的写入函数认不出。前面任何 `if (…) return;` 都算守卫，判空的提前返回也算。
- D442 只认字面的 `import.meta.env.DEV`，存进变量或用 `MODE`、`PROD` 判断的守卫认不出（会误报）。
- D605 “收 webContents 的判断函数”是测试里写死的名单；内联箭头写的 isTrusted 不核对。守卫工厂的本地包装（`const guarded = (…) => createSenderGuardedHandler(…)`）只认同一个文件里、直接交回工厂结果的。
- D507 主进程的键认 `store.get/set/delete/has` 和渲染进程的 `saveSettings(键, …)`；主进程里经变量传来的键名认不出。
- D441 只看 effect 自己的函数体（嵌套函数里的注册看不到），也不核对返回的函数是不是真的释放了。
- D444 不管经 `t('键', { error: … })` 插进翻译文案的原文。
- D608 只管“系统加密可不可用”的判断在哪里做，不管“app ready 之前不解密”。
- D611 是按词匹配的 diff 检查，只看新增的行。
- 挪动判定逐行比对：挪的时候每隔一行就改一行、或者只挪了一行长代码，这几行不算挪过来的，上面的旧违规会当成新写的报，`--adopt-moved` 也转不过去。
- `lint:fix-style` 靠 git 认改名：没 `git add` 的 `mv`、或者改动大到 git 认不出是改名的，新文件按全新的算，整个文件会被重排（CI 那边同样认不出）。先 `git mv` 再改。

ESLint 装在隔离环境里，钉住 TypeScript 6.0。原因是 typescript-eslint 要用 TypeScript 的编译器 API，而项目用的 TypeScript 7 没有提供。等 typescript-eslint 正式支持 TypeScript 7.1，就撤掉这个隔离环境。

不要用 symlink 把 `dev/dedicatus/lint/node_modules` 指到别的工作树共用：`npm run lint:install` 是 `npm ci --prefix`，会先清空这个目录，被指向的那份也跟着没了。

## 旧账只减不增

- 已有的分层违规和循环依赖记在 [`baseline.json`](baseline.json)。已有的 ESLint 违规记在根目录的 `eslint-suppressions.json`，按“文件 × 规则”计数。
- 修好一条旧违规以后，要用 `--prune` 或 `lint:prune` 把它从记录里删掉，否则报 D002。
- 不要往基线和抑制文件里加条目。CI 会拿它们和目标分支比较，多出来的报 D001。下面两种情况有专门的命令，不算增加：
  - **挪文件**（git 能认出的改名）：跑 `--migrate-renames`，记录里的路径跟着换。
  - **拆文件**（把一部分代码搬进新文件，或者挪文件的同时改了很多）：跑 `--adopt-moved`。新文件里登记的条目要同时满足两个条件才算搬家：不超过落在挪过来的行上的违规数；同一条规则在别处减少了同样多。新写的代码照样要干净。
- 风格类规则（D430–D432）在本来就是旧风格的文件里不追究，等以后整个文件一起格式化。

## 和目标分支比

有比较基点时，只追究这次 PR 带来的问题。CI 上的比较基点是 PR 的目标分支，本机默认是 `origin/main`。还没 `git add` 的新文件（遵守 .gitignore，跳过二进制和 2 MB 以上的）也算这次新写的，整个文件都查。

比较基点上还没有 `baseline.json` 或 `eslint-suppressions.json` 时（多半是本机的 `origin/main` 太旧，先 `git fetch`），报一条 D004 warning，说明这次没查 D001，不悄悄跳过。

- 模块图检查：目标分支上本来就有的违规和环，不算这次的。
- ESLint：只检查这次改过的文件（没碰过的文件本来就不报，全仓跑只是白占内存；每个文件的结果和全仓跑一样），只报落在**新写的行**上的问题。挪过来的行（连续至少 2 行和别处删掉的行一样；单独一行配上的多半是巧合，不算）不算新写，所以拆文件时搬过去的旧违规不会被当成新问题。这次碰过的文件里多出来的其他问题，合成一条 notice，不阻断；它们可能是目标分支上已有的，也可能是别处的改动引起的。
  - hook 依赖（D407）报在依赖数组那一行，原因却常在 hook 里面（新用到的变量）：多出来的先算到“hook 里有新写的行”的那几条上，点名了新写的行上出现的变量的优先，最多算多出来的条数。
- 过期的基线和抑制条目（修好了但没 prune）：只追究这次碰过的文件。

目标分支上漏进去的问题，由目标分支自己的 CI 报出来。那次检查在 push 时运行，没有比较基点。

## 输出

- 每个问题一行，只写代码和位置。在 CI 上以注解的形式标在 PR 的 “Files changed” 里，job summary 最多列 30 行。**不发 PR 评论。**
- 给人看的输出把项目规则排在最前面，通用规则其次，风格再次，合成的 notice（“另有 N 条不在新写的行上”）最后。GitHub 注解和 job summary 还要合并：风格问题每个“文件 × 规则”合成一行，并提示 `npm run lint:fix-style`；同一文件同一条通用 ESLint 规则超过 3 处的也合成一行。GitHub 每个步骤只显示前 10 个注解，不合并的话一个缩进不对的新文件就能把真正要看的问题全挤掉。本机的文字输出只排序不合并（要看到每一处的行号）；`--json` 既不排序也不合并。
- `report` 模式下照常输出，但不让 CI 失败。`enforce` 模式下，有新的 error 级问题就会失败。默认模式写在 `codes.mjs` 的 `DEFAULT_MODE`。
- 工具自己出错（找不到比较基点、ESLint 没装或没跑完，比如被 OOM 杀掉）报 D004，退出码 2，不会显示成“通过”。只有 GitHub Actions 上的 report 模式例外（退出码 0、注解标红）：模块图检查在必需的 “Run unit tests” 任务里，工具自己的故障不挡 PR。
