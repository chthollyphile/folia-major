<!-- docs/library-suites.md：音乐库浏览的 headless core 与 UI suite 之间的关系，以及一套 UI 可以 / 建议实现的 core 能力。 -->

# 音乐库：core 与 UI suite

这份文档讲清楚两件事：

1. 音乐库浏览（首页、集合详情、歌手页）与在线账户（扫码登录、选平台、切换确认、登出）的代码怎么分成「core」和「UI suite」，它们之间怎么配合；
2. 想写一套新的 UI 时，core 提供了哪些能力、哪些建议实现、哪些可以不做。

代码都在 `src/library/` 下。目前有三套 suite：

- `grid`：默认 suite，也是**回退 suite**——未知 id、某套 suite 缺某个 surface 时都由它渲染。
- `bravais`：library v2 的正式新 UI（「一面墙 + 一道缝」），实现 home / collection / artist 三个 surface（account 回退到 grid），开发阶段是没做过选择的用户的**初始选择**。
- `tui`：开发验证 suite，默认关闭，需显式启用。

选哪套、初始选择与回退见「选哪套：设置项、初始选择与回退」。

## 一句话

**core 负责「数据和规则」，suite 负责「长什么样、怎么操作」。** core 说「这个歌单现在能删歌、能订阅」；suite 决定「删歌是点卡片上的红色按钮，还是按 Delete 键」。同一份数据、同一套规则，可以有任意多套 UI。

## 四个角色

```mermaid
flowchart LR
    Shell[应用外壳<br/>Home / App] --> Host[宿主 library/app<br/>创建资源、控制器、端口]
    Host --> Registry[registry.ts<br/>按 surface 选 suite]
    Registry --> Grid[suites/grid]
    Registry --> Bravais[suites/bravais]
    Registry --> Tui[suites/tui]
    Grid --> Core[core<br/>契约 · 规则 · 资源 · 状态 · hooks]
    Bravais --> Core
    Tui --> Core
    Bravais --> Wall[components/wall<br/>共享 wall 引擎]
    Host --> Core
    Core --> Svc[既有服务<br/>Omni · 本地曲库 · Navidrome · 播放器]
```

| 角色 | 位置 | 做什么 | 不做什么 |
| --- | --- | --- | --- |
| core | `src/library/core/` | 定义能力；加载、缓存、分页；判定「此刻能不能做」；执行删歌、订阅等动作；保存筛选词、选中项、焦点；持有在线账户的扫码登录、待确认切换与登出流程 | 不知道任何 UI 长什么样，不 import 任何 suite 或组件 |
| suite | `src/library/suites/<id>/` | 把 core 的数据画出来，把按键 / 点击映射成 core 的动作；声明自己实现了哪些能力 | 不自己请求数据，不直接调 Omni / Navidrome / 本地曲库服务，不读账户 store，不 import 别的 suite |
| 宿主 | `src/library/app/` | 为当前打开的页面创建资源和控制器，接好播放、编辑等端口，挂载共用的对话框，通过 registry 渲染当前 suite（以及它的常驻舞台）；创建在线账户 controller（`useLibraryAccountController.ts`），接好切换清理端口（`createLibraryAccountPort.ts`），在首页外壳里按 suite 渲染账户界面（`LibraryAccountHost.tsx`） | 不画具体界面 |
| registry | `src/library/registry.ts` | 自动发现 `suites/*/entry.ts`；给定「哪个页面 + 用户选了哪套 suite」，返回该渲染的组件和它声明的动作；给出生效 suite 的 stage | — |

suite 可以 import `src/components/`（共享组件，例如 bravais 用的 wall 引擎 `src/components/wall/`）、`src/hooks/`、`src/stores/` 里的 app 级 store（播放、动效设置等），但不碰 core 的 service（`*.service.ts`）、不读账户与网易后端 store（见「账户」与「规则」两节）。

core 按功能分文件夹：`account/`、`artist/`、`collection/`（含 `resource/`、`mutations/`）、`directory/`、`home/`（含 `online/`、`navidrome/`）、`suite/`、`shared/`（几个功能共用的契约、资源 registry 与会话）。每个文件属于哪一层由文件名说，依赖只能从上往下：

| 层 | 文件名 | 内容 |
| --- | --- | --- |
| contract | `*.contract.ts` | 只有类型：能力清单、各页面的 props、资源快照、端口接口 |
| model | 其它文件 | 纯函数：筛选、条目身份、批量范围、能力判定、账户规则（选平台、可登出、登录文案）、导航栈规则 |
| service | `*.service.ts` | 资源（加载、分页、缓存、作废晚到结果）、动作控制器、账户 controller 与登录会话 |
| state | `use*Store.ts` | zustand store：浏览会话、目录会话、隐藏项、当前 suite、外观动作注册 |
| binding | 其余 `use*.ts(x)` | React hooks：订阅资源、读写会话、拿到动作、注册外观动作 |

没写后缀的文件按 model 查：它去调 service 或读状态，分层检查当场失败。判断写在 `dev/mcp/ts-code-map/libraryLayers.mjs` 一处，`test/unit/library/layerBoundaries.test.ts`、`test/unit/stores/storeContract.test.ts` 和 `dev/mcp/ts-code-map/codemap.mjs` 的 `BOUNDARY_RULES` 都读它，违反会直接报错。

## 环境与依赖注入

契约、纯计算和资源 / 动作 controller 不依赖 React、组件、DOM 几何、CSS 或 framer-motion；React 生命周期与订阅在 binding 文件（`use*.ts(x)`），Zustand 状态在 `use*Store.ts`。`core/suite/suite.contract.ts` 是宿主与视图之间的结构化装配协议：`Theme`、`isDaylight` 等展示输入不参与资源或 controller 的业务规则，组件类型也没有引入 React。

默认装配复用 Folia 现有环境服务。需要在其他运行环境中复用 controller 时，应注入对应依赖，而不是从 suite 直接访问这些服务；当前整个 `src/library/` 没有独立 npm 包、跨框架或服务端运行承诺。

| 默认装配入口 | 环境依赖 |
| --- | --- |
| `core/collection/resource/createCollectionResource.service.ts` | Omni、应用缓存 / IndexedDB、当前 Navidrome 账号与服务器作用域；本地集合接收宿主已解析的曲目 |
| `core/collection/resource/navidromeCollectionTracks.service.ts` | Navidrome 配置存储、Subsonic 请求、现有播放队列转换 |
| `core/collection/mutations/collectionMutationDeps.service.ts` | Omni 变更、应用数据库的缓存失效 |
| `core/artist/artistResourceDeps.service.ts` | Omni / Navidrome、本地封面与队列转换、翻译与等待端口 |
| `core/home/online/onlineHomeFeedDeps.service.ts` / `onlineHomeProvider.service.ts` | 当前 provider、账户与 feed、封面 metadata |
| `core/home/navidrome/navidromeHomeLibraryDeps.service.ts` / `core/directory/localDirectoryTreesDeps.service.ts` | 当前 Navidrome 配置与概览、本地导入根快照 |
| `app/createLibrary*Port.ts` / `useLibraryHomeResources.ts` | 播放与导航 store、导入导出、对话框、状态提示、收藏专辑刷新事件 |
| `core/account/providerAccountDeps.service.ts` | Omni 的登录 auth（开始、轮询、取消、TTL、登录方式、本地服务、诊断、自检）、读账号与 provider 注册表、`useOnlineProviderAccountStore`（provider 列表与当前平台）、window 定时器、`__APP_VERSION__` / `navigator` 与构建来源 |
| `app/useLibraryAccountController.ts` / `createLibraryAccountPort.ts` | App 的登出与登出前的问话（`useProviderSignOut`）；切换清理时的播放 store、播放器句柄、歌词、prefetch / track profile 运行态、搜索与集合导航 store |

`core/account/providerAccountController.service.ts` 与 `providerLoginSession.service.ts` 本身只经端口工作（auth、账户读写、刷新 / 登出、切换清理、时钟、诊断环境），不 import Omni、store（`use*Store`）或 React，分层测试检查这一点；单测注入假端口与手动时钟。账户真源仍是 `useOnlineProviderAccountStore`，controller 不建第二份账户状态。

## 兼容接口与迁移结束点

P5 收尾后，首页、集合与歌手业务的真源统一为 core 资源、会话与 controller。旧 libraryUi 目录和无消费者的业务转出已移除；新增 suite 不再从旧组件位置获取业务实现，也不增加第二套加载或缓存流程。

以下接口仍有应用消费者，保留在适配边界：

- `components/app/home/gridViewCollectionAdapters.ts` 将现有应用输入转换成 core 描述，并解析本地曲目、封面和排序；来源通用适配及 `GridView*` 类型别名继续供导航、搜索与播放器入口使用。
- `homeSurfaceTypes.ts` 的契约别名、grid 的 collection / artist surface 展示适配、命令面板的 Grid 命令 ID 映射继续使用；业务能力和操作范围仍由 core 判定。
- 收藏专辑刷新事件、旧浏览恢复记录的读取 / 单向迁移、隐藏歌单的存储 key 和格式保留。布局记录属于各 suite，显式完成页面时由宿主统一清除。刷新后恢复打开的集合仍不在本次范围内。

资源 registry 有界保留已释放资源并回收孤立实例；suite resolver 按实际解析的 suite、surface 与回退状态共享结果，未知或当前构建禁用的 ID 不再扩张缓存。未知 ID 仍沿用默认 suite 的现有解析标记；已注册 suite 缺少某 surface 时 `isFallback` 为 true。

在线曲目缓存沿用 main 的 schema 7，保留原始 `nextOffset`、`hasMore` 与 `total`。混合分页的可见歌曲数可能少于上游位置，不能按行数恢复；旧快照缺少安全游标时重新读取，已完成快照也不按集合估计总数继续补页。日推卡片由首页 feed 的 provider 能力决定，空结果与不支持分别表达。

没有可靠更新时间的歌单与专辑，已读取的资源在现有有界 LRU 中最多复用 5 分钟（从首页成功读取时算起，不因再次打开延长），不把无版本磁盘快照视为有效。此类资源按账号隔离；歌曲数变化、手动刷新、删除曲目或超时后重新读取，不对每日推荐与私人 FM 启用此兜底。QQ 自建歌单使用 `/user/playlist` 的秒级 `updateTime` 转成毫秒作为版本，缓存回读保留毫秒值；空的“我喜欢”实测该值随读取变化，不采用它的版本。

## 一次「打开歌单并删一首歌」是怎么走的

1. 用户在首页点开一个歌单。首页只调用 `onOpenGridView(歌单描述)`，导航 store 记下「现在打开的是它」。
2. 宿主看到导航变化：为这个歌单拿到一份**资源**（负责加载曲目）和一个**变更控制器**（负责删歌、订阅等）。宿主自己不订阅它们。
3. 宿主问 registry：「`collection` 页面，用户选的是 tui，该用谁？」registry 返回 TUI 的集合组件，以及 TUI 声明的动作清单。
4. TUI 组件订阅资源，拿到曲目，画成列表。
5. 用户按 Delete。TUI 调 `mutations.removeEntry({ entryKey, track })`。
6. 控制器先问 core 的规则「这个歌单能删歌吗」，再调上游接口；上游确认后，更新资源。
7. 资源一更新，**所有订阅它的 UI 同时看到**。如果这时切回网格，网格拿到的是同一份资源：不重新请求，筛选词和焦点也还在（它们在浏览会话里，不在组件里）。

网格删歌时有 460ms 的卡片退出动画。动画是网格自己的事：它在展示层「按住」旧的一帧，动画放完再显示已提交的数据。core 不等动画，TUI 也不受影响。bravais 同理：它比较前后两份条目认出移除，先把被删的那一格翻成空、按住旧帧，再让后面的条目依次前移一格（两段翻牌），也不需要 core 通知。

## 能力是怎么定义的

core 把能力分成两级：

- **surface（页面）**：`home`（首页与目录）、`collection`（集合详情）、`artist`（歌手页），以及叠在首页之上的 `account`（切换确认；登录在共用的登录窗口里，见「账户」一节）。
- **动作**：每个 surface 上的语义动作，例如集合页的 `play-scope`（播放当前筛选范围）、`remove-entry`（删掉一个条目）。

一个动作最终出现在 UI 和命令面板里，要同时满足两条：

| 条件 | 谁说了算 | 例子 |
| --- | --- | --- |
| core 判定「这个对象此刻能做」 | core 的规则（`core/<功能>/` 下的 `*Capabilities.ts`、`*Surface.ts`） | 别人的歌单不能删歌；加载中不能重新拉取 |
| suite 声明「我的 UI 做这件事」 | suite 的 `entry.ts` | TUI 没有歌单选择器，所以不声明 `add-to-playlist` |

**没实现的 surface 会回退到默认 suite（grid）**：某套 suite 没有歌手页，打开歌手时就由网格渲染，用户照样能用。**没声明的动作**则既不出现在这套 UI 上，也不出现在命令面板里，避免「面板里有、界面上却做不到」。

core 之外，suite 还有两类自己的操作：

- **局部动作**（`extraActions`）：挂在某个 surface 上、只属于这套 UI 的动作，例如网格集合页的「开关信息面板」「开关曲目侧栏」「编辑模式」。
- **外观动作**（manifest 的 `chromeActions`）：不挂在任何 surface 上的呈现操作，只出现在命令面板里，例如 bravais 的缝等级、打开列表、透光档位。见「外观动作（suite-chrome）」一节。

## 宿主交给每个页面的东西

不管是哪套 suite，同一个页面拿到的输入完全一样（类型在 `core/suite/suite.contract.ts`）：

| 页面 | 主要输入 |
| --- | --- |
| collection | `collection`（描述）、`resource`（曲目资源）、`mutations`（变更控制器）、`playback`（播放端口）、导航（`onBack` / `onDone` / `onOpenAlbum` / `onOpenArtist` / `onPopTo`）、`declaredActions`、`isInteractive` |
| artist | `collection`、`resource`（歌手资源：详情、热门歌曲、专辑）、`playback`、导航（同上）、`onEditEntity`、`declaredActions`、`isInteractive` |
| home | 首页数据（歌单、本地曲库……）、`account`（在线账户 controller：provider 列表、当前平台、选平台、登出）、`homeResources`（收藏专辑、电台 feed、首页动作、Navidrome 概览、文件夹树）、`directoryActions`（目录批量动作）、`onOpenGridView`、`declaredActions`、`isInteractive` |
| account | `account`（同一个 controller）、`layer`（首页 surface 交上来的账户层）、`theme`、`isDaylight`、`declaredActions`（账户动作）、`isInteractive`（首页外壳层的值） |
| stage（可选，见「常驻舞台」） | `isInteractive`、`theme`、`isDaylight`、`navigation`（导航快照：`depth` / `origin` / `activeType` / `trail`）、`reportPlayerOcclusion`、`reportPlayerBackdrop`、`onBackToPlayer?`、`onTogglePlayback?`、`onEnterPlaybackView?`、`onOpenLattice?` |

`isInteractive` 为 false 时（例如另一层盖在上面、或正在退场），页面不要接键盘、不要往命令面板注册。

## 导航栈：压栈、返回与跳层

集合与歌手页是一个导航栈（`src/stores/useCollectionNavigationStore.ts`），执行都在宿主（`src/library/app/GridViewOverlayHost.tsx`）与 `src/hooks/useAppNavigation.ts`，suite 只按手势选一个回调。

### 压栈：只折叠紧邻往返

`core/collection/collectionNavigation.ts` 的 `resolveCollectionPush(snapshot, collection)` 决定一次打开怎么落：

- 栈顶就是它 → `noop`；
- 正好是倒数第二层（X → Y → X）→ `back`：当作一次返回，浏览器历史同步退一步（`popCollectionLayer({ leaveLayer: true })`，连同这一层之上 suite 自己写的面板记录一起越过，见下面「suite 自己的 history 记录」）；
- 其余 → `push`。栈里**可以有重复的集合**，深度不设上限（A › B › C › D › E 再打开 B 是压栈，不会丢掉 C、D、E）。

`useCollectionNavigationStore.push` 返回这个决定。宿主只在 `push` 分支跑 `transitions.beforePush`；`back` 分支与浏览器后退一样，由弹栈通知跑一次 `beforeBack`。`history.back()` 在途（popstate 落地前，≤1 秒）时忽略新的压栈与跳层。

### 返回：「完成」与「离开」

同一个手势在每套 suite 里含义相同：

| 手势 | 回调 | 含义 | 宿主做什么 |
| --- | --- | --- | --- |
| 显式的返回按钮 | `onDone` | 看完了 | 清掉这一层的浏览会话（筛选、焦点）；让**每一套** suite 忘掉这一层的布局记录（manifest 的 `layout.forget`，网格丢掉 `folia_gridview_state:v2:` / `folia_artist_grid_state:v2:` 两份记录，bravais 丢掉 `folia_bravais_layout:v1:`）；再返回 |
| Escape 阶梯的最后一步 | `onBack` | 离开但保留 | 只返回 |
| 浏览器后退 | —（不经过 suite） | 离开但保留 | popstate 弹栈之前由导航 store 通知（`subscribeCollectionPop`），宿主让渲染这一层的 suite 跑 `transitions.beforeBack` |
| 面包屑跳层 | `onPopTo(depth)` | 一次退回到某一层 | 见下面「跳层」 |

要点：

- 两条返回路径都只跑一次 `beforeBack`：应用内返回先跑，再走 `history.back()`；随后的弹栈通知认出这是同一次弹栈，不再跑。浏览器后退时 `beforeBack` 也是在界面与导航 store 都还没变的时候运行，网格的反向移形换影与卡片散开和点返回按钮一样出现。
- 「完成」先清会话再返回。离开的那一层卸载时如果还想把焦点写回（TUI 会），要先比较会话的「代」（`getLibrarySessionGeneration`）：挂载以来被清过就不写，否则会把刚清掉的会话又写出来。
- 布局记录不在 core 里，但「忘掉」要由宿主统一发起：在 TUI 里看完的集合，下次在网格里打开也应该从头开始。有布局记录的 suite 在 entry 里给 `layout: { forget(sessionKey) }`。

### 跳层：`onPopTo` 与 `trail`

- **`onPopTo(depth)`**（`LibraryCollectionNavigation.onPopTo`，经 `useAppNavigation.popCollectionTo` → `HomeViewModel.onPopCollectionTo` → 宿主 prop 交给集合 / 歌手 surface）：`depth` 是保留的层数（与导航快照的 `depth` 同一种量，0 = 整个关掉），栈有重复时按位置算；不比当前浅、负数、非整数时什么都不做。导航层在历史日志（`src/hooks/navigationHistoryJournal.ts`）里找到目标层的第一条记录后 `history.go(-k)`，一次 popstate；找不到时兜底为通知弹栈 + 压一条截短的记录。调用方**不要**自己跑 `beforeBack`（弹栈通知触发一次），也不要先关自己的面板。
- **`trail`**（`LibraryNavigationContext.trail`，`core/collection/collectionNavigation.ts` 的 `projectNavigationTrail` 投影）：导航栈每一层的 `{ key, name, type }`（key = collectionKey），自底向上按位置，重复的集合各占一项，长度等于 `depth`。面包屑用它显示中间层的名字；宿主总会给，测试替身可以不给（当作不知道中间层的名字）。stage 的 `navigation` 与转场钩子的上下文都带它。

### suite 自己的 history 记录

suite 可以为自己的「导航状态」（例如 bravais 的列表 / 目录树面板：打开面板是一次导航，浏览器后退先关面板）写 history 记录，规则：

- 沿用 `useAppNavigation` 的历史状态形状：拷贝当前记录（含 `appHistorySession`），加上自己的标记（bravais 是 `bravaisPanel: 层 key`）、`appHistoryIndex + 1` 后 `pushState`。这样历史日志认得它是本会话的记录。
- 宿主 popstate 在这类记录之间来回时导航栈不变，不算弹栈，不跑 `beforeBack`；suite 自己听 popstate 按标记开合。
- 应用内返回（返回按钮 / Esc）在面板记录在顶上时只关面板；N1 的折叠往返与 `onPopTo` 跳层会越过它们：`findLayerBaseIndex` 把「往回连着的、首页视图、集合栈逐层一致」的记录认作同一层，折叠往返退到上一层、跳层落在目标层的第一条记录上。网格与 TUI 不写这种记录。

## 转场与背景板

集合和歌手页的转场由实际渲染该 surface 的 suite 提供，包括回退到默认网格的情况。宿主不读取网格的动效设置，也不保存网格专属时长。

`transitions.backdrop` 是可选的订阅接口（类型在 `core/suite/suite.contract.ts`）：

- `getSnapshot()` 返回稳定的快照：`enabled`、`enter`，以及可选的 `exit`。`enter` / `exit` 包含以秒计的 `duration` 和四点贝塞尔曲线 `ease`；没有 `exit` 时退场沿用 `enter`。
- `subscribe(listener)` 返回退订函数。suite 自己解析设置，只有最终快照变化时通知；宿主通过 `app/useLibraryBackdrop` 订阅，切 suite 时自动换订阅。
- `enabled` 控制这套 suite 的 `beforePush` / `beforeBack` 与 `Overlay`。没有声明背景板时使用 0.18 秒的中性淡入淡出，并保留该 suite 已声明的转场钩子；服务端渲染也使用中性快照。

`transitions.reset` 在切换 suite 时对每一套都调用（`app/switchLibrarySuite`），丢掉还没用掉的转场计划。

各 suite 的做法：

- **网格**在 `suites/grid/transitions/gridBackdrop.ts` 解析「降低动态效果」的 `collectionMorph` 设置：正常入场 0.62 秒、退场 0.28 秒；降低动效时使用 0.18 秒中性背景板，并关闭移形换影（`Overlay`）。应用内返回与浏览器后退仍走同一套 `beforeBack`，一次返回只调用一次。
- **TUI** 没有声明转场，使用中性背景板。
- **带 stage 的 suite（bravais）** 的转场由 stage 观察导航深度驱动，所以只声明需要的钩子：`beforePush`（宿主压栈前记下起点磁贴）与 `reset`（丢掉没用掉的起点）。不声明 `beforeBack`（应用内返回、浏览器后退、折叠往返、跳层都是一次深度变浅，stage 各翻一次）、`Overlay` 与 `backdrop`（宿主不给它垫背景板；「降低动态效果」由 stage 自己解析）。entry 只能静态 import react，钩子的实现由 stage 的 chunk 加载后装上，没选过它的人钩子是空操作。

## 常驻舞台（stage）

有的 suite 不是「首页一张图、集合层盖一张图」，而是一块横跨首页与集合层的画面（bravais 的整面墙：换层时墙上的磁贴原地翻牌，不能因为换 surface 而重挂）。这种 suite 在 manifest 上声明可选的 `stage`（类型 `LibrarySuiteStageProps`，在 `core/suite/suite.contract.ts`）：

- **输入**：`isInteractive`（首页外壳层的值，集合层打开时仍为真；上面盖了别的层时为假）、`theme`、`isDaylight`、`navigation`（集合导航快照：`depth` / `origin` / `activeType` / `trail`，首页时 `depth` 为 0），以及回调 `reportPlayerOcclusion` 与 `reportPlayerBackdrop`（见下面「遮挡播放页」「透出的画面」）与可选的 `onBackToPlayer`（回到播放页，与首页数据的同名回调同一个；bravais 左上角的隐藏式返回在首页根层、有歌时用它，不在根层时它是缝里 ‹ 的层返回）、`onTogglePlayback`（暂停 / 继续正在播放的那首，首页数据的同名回调；bravais 正在播放的聚焦卡上的播放键用它）与 `onEnterPlaybackView`（按「播放后进入的视图」去 Lattice 或播放页，「留在原处」时去播放页，与播放胶囊同一条规则；bravais 聚焦卡的「进入」用它）、`onOpenLattice`（进入 Lattice，首页数据的同名回调，与首页工具格「队列拼贴」同一个入口；bravais 右下角工具面板的「前往 Lattice」用它）。墙上工具面板的洗牌、生成主题、音量预览、前往播放页与队列编辑不经 stage 契约：App 在 `WallToolsDockHost` 上提供墙面工具宿主（`components/wall/wallToolsHost`，App 侧由 `components/app/wall-tools/useAppWallToolsHost` 组装，命令面板的同一条命令 `theme-generate-current` / `playback-shuffle` 与队列操作），bravais 与 Lattice 的工具面板经 `components/wall` 直接读它；音量本身读写应用的音量 store。播放端口另有可选的 `togglePlayback`（同一个开关），网格在「留在原处」时给正在播放的卡片用。导航快照不含当前层的数据；层身份与内容由这套 suite 的 surface 交给 stage。
- **分工**：stage 负责画面；这套 suite 的首页 / 集合 / 歌手 surface 不画画面，只把自己的数据投影成层描述交给 suite 内部的 store，并照常注册命令面板。
- **宿主怎么挂**：`GridViewOverlayHost` 经 `registry.resolveLibraryStage(store 的 suite)` 只挂**生效 suite** 的 stage（未知 id 生效的是 grid，grid 与 TUI 都没有 stage），挂载位 `app/LibrarySuiteStageSlot.tsx` 在首页容器之后、中性背景板与集合层之前，包 `Suspense`（fallback 为 null）。打开 / 关闭集合只换 props，不重挂；换 suite 时卸载（换成另一套带 stage 的 suite 时重挂）。首页外壳整个卸载时（播放页全屏约 350ms 后 `Home` 返回 null）stage 也卸载，跨卸载要保留的布局放进 sessionStorage 或模块级 store，并在 `layout.forget` 里能丢掉。设置弹窗盖在首页上时首页外壳**不卸载也不隐藏**（2026-10-09，用户要求）：首页层照常显示在设置的半透明遮罩下面（不淡出、不 `visibility: hidden`），只是不可交互（`isInteractive` 为假、首页层 `pointer-events: none`，键盘让给设置）；关掉设置原样回来，不重新入场、不重新请求。规则在 `components/app/presentation/buildHomeSurfacePresentation.ts`：`shouldKeepHomeMounted`（挂着）、`shouldRevealHomeSurface`（看得见：首页视图且没被面板盖住，或交接进 Lattice 期间）、`shouldShowHomeSurface`（可交互：首页视图且设置弹窗与面板都没盖着）。播放页上打开设置不受影响（首页本来就没显示）；面板盖着、回播放页、Lattice 照旧。
- **背景板与首页**：渲染当前层（集合或歌手页）的 suite 正是挂着 stage 的那套时，宿主不渲染中性背景板，首页容器也不加 `visibility: hidden`（`aria-hidden` 与 `pointer-events: none` 照旧）；当前层回退到 grid 时与没有 stage 一样。规则是 `core/suite/libraryStage.ts` 的 `resolveLibraryLayerPresentation`。
- **和 `transitions.Overlay` 的区别**：Overlay 是**每一套** suite 都常驻挂载的转场层，只拿到 `enabled`，`enabled=false`（降低动效、或当前层不归它）表示「不做转场」，承载不了常驻画面；stage 只在这套 suite 生效时挂载，是画面本身。网格的移形换影继续用 Overlay；有 stage 的 suite 一般不需要 Overlay。
- **按需加载**：非默认 suite 的 stage 必须是 `React.lazy`（`test/unit/library/suiteEntries.test.ts` 按源码检查），没选它的用户不加载它的 chunk。
- **与 Lattice 的翻牌交接**（可选，manifest 的 `stageWallHandoff`）：进 / 出 Lattice 时 stage 与 Lattice 叠着换内容，而不是首页层瞬间卸载、Lattice 整层淡出。协议在 app 层的 `src/stores/useWallHandoffStore.ts`：stage 用 `registerHomePeer({ canHandoff, seeThrough, reduced })` 登记「首页墙」，App 的 director（`components/app/presentation/wallHandoffDirector.ts`）在视图切换的同一刻开会话；stage 按会话阶段（进 Lattice：closing → flipping；回来：waiting → flipping → opening）合上 / 张开缝与窗、翻出 / 翻进磁贴，用 `markHomeReady` 报准备好（进 Lattice 时带上起点与对齐信息，回来时带上有没有窗），回来时挂上就 `reportSeeThrough`。会话期间宿主让首页层留着（进）或 Lattice 留着（出），不跑首页层的 0.25s 淡入淡出；visualizer 的挂载多一条「交接要求挂着」（见下一节）。离开 Lattice 时 stage 还没挂上，宿主据 `registry.libraryStageHandsOffWall(suite)` 决定要不要让 Lattice 等它接手；不声明的 suite（grid / TUI）照旧。时间表与对齐几何在 wall 引擎的 `components/wall/wallHandoff.ts`，bravais 的实现见设计稿 §7「进 / 出 Lattice」。

### 遮挡播放页（`reportPlayerOcclusion`）

stage 用 `reportPlayerOcclusion(occludes)` 告诉宿主自己此刻是否**完全**盖住了下面的播放页（visualizer）。只有画面完全不透光时才报 `true`（bravais 的「实色」档）；只要有透光处（窗、半透明材质）就报 `false`；没报过视为 `false`。值不变时重复报告没有开销，函数引用在同一次挂载内稳定。

- 宿主怎么用：挂载位把报告写进 `src/stores/useLibraryPlayerOcclusionStore.ts`，App 读 `selectLibraryOccludesPlayer`，visualizer 的挂载条件是 `handoffKeepsVisualizer || (currentView !== 'lattice' && hasLatticeExited && !(shouldRevealHomeSurface && libraryOccludesPlayer && hasLibraryOcclusionSettled))`（`components/app/presentation/playerVisualizerMount.ts`）。`handoffKeepsVisualizer` 来自与 Lattice 的翻牌交接（`wallHandoffPresentation`）：stage 有窗时，进 Lattice 在窗关上之前、回来从 stage 报「有窗」起都挂着。App 不认识任何 suite，也不读 suite 的偏好。
- 时序：进入时首页显示着并且遮挡持续约 0.3 秒（首页 0.25 秒淡入结束）之后才卸载 visualizer（`hooks/useLibraryOcclusionSettled.ts`），淡入过程中仍能看到它；首页一不显示（回播放页、面板盖上）或 stage 改报 `false`，同一次渲染里就重新挂载。设置弹窗盖着首页时首页仍显示在遮罩下面（遮罩是半透明的黑，不模糊，透出来的是墙而不是播放页），遮挡照旧成立、visualizer 不重挂——设置开着时也省下 visualizer 的渲染与重新初始化；在设置里切到透光档时 stage 改报 `false`，照常立即挂上。改报 `false` 之后 visualizer 出画面前有一小段空白（Pixi 初始化），透光的 suite 应在透光处自己垫一层底色。
- 复位不靠 stage：挂载位卸载（包括离开首页约 350ms 后 `Home` 返回 null）、换 suite、生效 suite 没有 stage 时自动回到 `false`，stage 不需要在卸载时报 `false`；已卸载的 stage 晚到的报告不生效。grid / TUI 没有 stage，永远是 `false`，visualizer 的行为与以前相同。

### 透出的画面（`reportPlayerBackdrop`）

stage 用 `reportPlayerBackdrop({ lyrics, blur })` 告诉宿主：从它的透光处透出来的 visualizer 要不要画歌词文字、要不要模糊（bravais「墙后的画面」设置，2026-10-09）。只有画面有透光处时才可能报 `true`；没报过、复位后都是两项 `false`（与没有 stage 的 suite 一样）。持有者、生效与复位规则与遮挡相同（同一个 store，`selectLibraryPlayerBackdrop`，没报时返回同一个常量）。

- 歌词：visualizer 的 `showText` 原来只在播放页为真；首页显示着（不被面板盖住；设置弹窗盖着时首页仍显示着，照画，墙后的画面不随设置开关变）且报了 `lyrics` 时首页也画（`components/app/presentation/playerVisualizerBackdrop.ts` 的 `resolveVisualizerShowText`，`useVisualizerRendererModel` 读）。播放页不受影响。
- 模糊：首页墙露着（`shouldRevealHomeSurface`，含设置弹窗盖着、进 Lattice 的交接期间）且报了 `blur` 时，App 给 visualizer 那一层（`player-visual-surface`）加 `filter: blur(24px)`（过渡 300ms，`data-library-backdrop-blur`）；回播放页立即撤掉。用一次合成层模糊而不是在每个透光处放 `backdrop-filter`，开销与透光处的多少无关。

## 外观动作（suite-chrome）

suite 自己的外观操作（bravais 的缝等级、打开面板、定位正在播放、透光档位）不是 core 的资料动作，挂不到任何 surface 上，又不该占全局快捷键。它们走命令面板的 `suite-chrome` 作用范围。

- **什么时候用**：只属于这套 UI 的呈现操作，别的 suite 没有对应物。core 的资料动作（播放、筛选、排序、删歌……）照旧走 grid / directory / artist surface；网格的三个局部动作（信息面板、曲目侧栏、编辑模式）仍是 grid surface 的 `extraActions`，不改造。
- **manifest 声明**（静态，命令契约测试能枚举）：`chromeActions: [{ id, title, description, keywords, executeShortcut? }]`，类型 `LibrarySuiteChromeActionMeta`（`core/suite/suiteChrome.contract.ts`）。没有 `labelKey`：`id` 是 suite 内唯一的小写 kebab-case；`title` / `description` 只是缺译时的英文回退，正式文案写在 en / zh-CN / in 三份 locale 的 `commandPalette.commands.<命令 id>`（与其它命令同一约定，契约测试缺一份就红）。`keywords` 写英文与中文，不手写拼音、ASCII 关键词不照抄标题；拼音由构建期插件从中文生成，它只扫 `suites/<id>/entry.ts` 与同目录的 `chromeActions.ts`，所以声明只能放在这两种文件里。建索引时校验 id 格式、重复与空文案（`core/suite/suiteChrome.ts`）。
- **运行时注册**：suite 用 `useLibrarySuiteChromeRegistration({ suiteId, isInteractive, handlers })`（`core/suite/useLibrarySuiteChromeRegistration.ts`），`handlers` 是「动作 id → `{ isAvailable(): boolean; run(): void }`」，每次渲染可以给新对象（latest-ref，不重注册）。`isInteractive` 为假或组件卸载（换 suite）时注销；旧实例晚一步卸载不会清掉接手的新实例。store 是 `core/suite/useLibrarySuiteChromeStore`，命令面板经 `useCommandPaletteContext` 的 `scope.chrome` 读它。动作只描述做什么，不碰 DOM。
- **命令 id 与可用性**：命令 id 为 `<suiteId>-<动作 id>`（`libraryChromeCommandId`），由 `createSuiteChromeCommand` 生成，group 为 `grid`。可用要同时满足：当前视图是首页（`suite-chrome` 作用范围要求 `view === 'home'`，集合层打开时也是首页视图）、注册着的正是这套 suite、它给了这条动作的实现且 `isAvailable()` 为真。执行时再问一次 `isAvailable()` 才调 `run()`。
- **怎么进命令列表**：命令文件不 import registry（会把默认 suite 的整套组件拉进命令面板的模块图），所以命令不是静态声明的：`library/app/installLibrarySuiteChromeCommands` 在 bootstrap 渲染前（只在主窗口）用 registry 的可用 suite 生成命令，经 `commandRegistry.setSuiteChromeCommands` 装进列表（重复调用替换上一批）。契约测试与拼音覆盖测试用同一个 `buildSuiteChromeCommands(listLibrarySuites())` 自己生成并检查。Vitest 与 dev-probe 不经过 bootstrap：组件用例要从命令面板执行外观动作时，探针里先调一次 `installLibrarySuiteChromeCommands()`（幂等）。
- **执行键**：给不给 `executeShortcut` 的判断与其它命令相同（危险、不可撤销、要确认的不给）。装入时对整张列表做无前缀冲突检查，冲突直接抛错（启动即暴露）。`suite-chrome` 只在首页视图成立，与 `lattice`（Lattice 视图）、`player-surface`（播放页）互斥，可以复用它们的键（例如 Lattice「聚焦当前歌曲」的 `c`）；不同 suite 的外观动作同一时刻只有一套可用，彼此也可以同键。与全局命令（`n` 下一首、`l` 循环……）和同时可能出现的 grid / directory / artist surface 命令必须无前缀冲突。

## 页面教程（Ponder）

页面教程跟实际渲染的页面走，按可见的 `data-ponder-page-scope` 解析。网格首页、集合 / 歌手页和目录保留各自的教程标记；TUI 的 `home` / `collection` / `artist` 显式声明 `data-ponder-page-scope="none"`，表示当前页面没有教程；bravais 的这三个 surface 声明 `bravais-wall`（墙的页面教程，信息条 `bravais-seam` 作为本页组件挂在它下面）。某套 suite 回退到网格时，由网格页面的标记提供教程。

显式的 `none` 与没有标记不同：`none` 返回空目标；缺失或未知标记仍按主视图回退。隐藏或尺寸为零的标记不参与解析；设置、帮助等上层页面可覆盖底下的页面，首次使用引导优先打开总览。

`services/ponder/pagePonderTarget.ts` 的 `readCurrentPagePonderTarget()` 统一读取当前目标；它与 `resolvePagePonderTarget()`、`openCurrentPagePonder()` 都可能返回 `null`。空目标时，长按 Ctrl+G 不显示提示、不预热教程层、不启动计时，触屏和命令入口也不创建教程 session。新 suite 没有对应教程时，应显式声明 `none`，避免继承主视图的教程。

## 能力清单：哪些建议实现

分级的意思：

- **基础**：不做的话，这套 UI 在这个页面基本没法用。
- **推荐**：常用；做起来不难，core 已经把规则和动作都备好了。
- **可选**：低频，或者需要额外的交互（输入框、确认框、选择器）。不做也没关系，用户可以切回网格完成。

### 集合详情（`collection`）

建议**第一个**实现的页面：它是浏览的核心。

| 动作 | 是什么 | 分级 | 用到的 core |
| --- | --- | --- | --- |
| `play` | 播放某一首（队列 = 当前筛选范围） | 基础 | `useCollectionActions().playTrack` |
| `enqueue` | 某一首加入队列 | 基础 | `.enqueueTrack` |
| `play-scope` | 播放当前筛选范围 | 基础 | `.playScope` |
| `enqueue-scope` | 当前筛选范围加入队列 | 基础 | `.enqueueScope` |
| `filter` | 按关键词筛选 | 基础 | `useLibrarySessionQuery` + 命令面板筛选框（`useGridCommandFilter`）；自己画输入框的 suite 在注册里给 `ownInput`（见第 4 步，bravais） |
| `reload` | 跳过缓存重新拉取在线集合 | 推荐 | `.reload`，能力 `capabilities.reload` |
| `resume-sync` | 后台补页中断后续传 | 推荐 | `.resumeSync`；快照的 `sync.status === 'interrupted'` |
| `remove-entry` | 删一首（每日推荐里是「不喜欢」） | 推荐 | `mutations.removeEntry`；能力 `capabilities.removeEntry` |
| `subscribe` | 收藏 / 取消收藏歌单或专辑 | 推荐 | `mutations.toggleSubscribe`；快照 `subscribed` / `subscribing` |
| `sort` | 本地文件夹排序 | 推荐（有本地曲库时） | `useLocalTrackSortStore` |
| `rename` | 改名（本地 / Navidrome 歌单） | 可选，需要输入框 | `mutations.rename` |
| `delete-collection` | 删除歌单 / 文件夹 | 可选，需要确认 | `mutations.deleteCollection` |
| `resync-folder` / `resync-all-folders` | 重新扫描文件夹 | 可选 | `mutations.resyncFolder` / `resyncAllFolders` |
| `export-playlist` | 导出本地歌单 | 可选 | `mutations.exportPlaylist` |
| `edit-entity` / `organize-song-info` / `match-song` | 打开宿主的编辑 / 整理 / 匹配对话框 | 可选，几乎零成本（对话框由宿主提供） | `mutations.editEntity` / `organizeSongInfo` / `matchSong` |
| `set-cover` | 打开宿主的集合封面对话框（本地文件夹 / 专辑 / 歌单的自定义封面：poster.png、上传、选一首歌的封面，或恢复默认） | 可选，几乎零成本（对话框由宿主提供） | `mutations.setCover`；能力 `capabilities.setCover`。封面本身由 core 解析好（首页分组、集合描述的 `coverUrl`、本地歌手页的专辑），suite 不必自己查；画曲目本身时用描述的 `automaticCoverUrl` |
| `daily-date` | 切换每日推荐的历史日期 | 可选 | `mutations.setDailyDate` |
| `add-to-playlist` / `create-playlist` | 加入 / 新建 Navidrome 歌单 | 可选，需要歌单选择器 | `mutations.addToPlaylist` / `createPlaylist` |
| `open-album` / `open-artist` | 打开曲目上的专辑 / 歌手（嵌套压栈） | 推荐 | `resolveTrackAlbumLink` / `resolveTrackArtistLinks`（`core/shared/trackLinks`，在线曲目注入 `canResolveSongCatalogRef`）→ `onOpenAlbum` / `onOpenArtist` |

此外建议：

- 显示加载中、错误（`snapshot.error`，不要和「歌单本来就是空的」混在一起）、后台补页进度与中断。
- 动作结果是判别式（`ok`，或 `busy` / `stale` / `limit-reached` / `failed` …），文案由 UI 自己翻译。重复提交时控制器会返回 `busy`，UI 不需要自己防抖。
- 打开嵌套的专辑 / 歌手之前，把焦点写回浏览会话（`setFocusedEntry`）；离开（卸载、换 suite 的冲刷）时也写，但只在用户在这里动过焦点时写——没动过就写，会把会话里别处记下的焦点盖成第一行。返回时按会话里的条目键恢复焦点。
- 面包屑（可选）：用导航快照的 `trail` 显示中间层，点击经 `onPopTo(depth)` 跳层（见「导航栈」）。

### 首页与目录（`home`）

推荐实现：让这套 UI 从首页就能开始浏览。不实现时首页由网格渲染，用户从网格点开集合后照样进入你的集合页。

页面本身（不是动作）要做的：来源与分区页签、条目列表、打开条目（`homeResources.actions.openOnlineCard` / `openLocalGroup` / `openNavidromeCard`）。core 的 hooks 是 `useLibraryHomeSources`、`useLibraryHomeOnline`、`useLibraryHomeLocal`、`useLibraryHomeNavidrome`、`useLibraryHomeDirectory`。

首页的**特殊集合**（我喜欢的音乐、云盘、私人 FM、每日推荐、本地的全部歌曲与「我喜欢」、Navidrome 的随机 / 收藏）由 core 的纯函数 `resolveLibraryHomeSpecial(card, source)`（`core/home/homeSpecialCards`，先后在 `LIBRARY_HOME_SPECIAL_ORDER`）判定：只看卡片的身份字段（id、type、`isVirtual`、来源对象上 provider 给的 `isLiked`），不看显示名；`source`（`online` / `local` / `navidrome`）决定同样的字段怎么解释。全部歌曲的 id 是 `LOCAL_ALL_SONGS_ID`（`localHomeModel`）。想给它们特别标识或直达入口的 suite 用它，不要在组件里按名字判断；grid / TUI 目前不用。`useLibraryHomeNavidrome()` 另给 `cardsBySection`（五个 section 各自的卡片，不限当前 section）。

| 动作 | 是什么 | 分级 | 用到的 core |
| --- | --- | --- | --- |
| `directory-filter` | 筛选目录条目 | 基础 | `useLibraryDirectoryQuery` |
| `directory-select` | 批量选择（全选 / 清空 / 逐个） | 推荐 | `useLibraryDirectorySelection` |
| `directory-play-selection` / `directory-enqueue-selection` | 播放 / 入队选中的 | 推荐 | `useLibraryDirectoryActions`、`runDirectoryBatchAction` |
| `directory-manage-hidden` / `directory-toggle-hidden` | 管理隐藏的歌单 | 推荐 | `useLibraryDirectoryVisibility`、`useHiddenCollections` |
| `directory-create-playlist` | 用选中的歌新建本地歌单 | 可选，需要输入框 | 同上 |
| `directory-remove-selection` | 从曲库删除选中的 | 可选，需要确认 | 同上 |
| `directory-rescan-root` / `directory-remove-root` / `directory-clear-ignore` | 导入根的重扫、移除，恢复被忽略的文件夹 | 可选 | 同上 |
| `home-import-folder` / `home-refresh-folders` / `home-import-playlist` | 导入文件夹、刷新、导入歌单文件 | 可选 | `useLibraryHomeActions` |
| `home-refresh-navidrome` | 刷新 Navidrome 概览 | 可选 | `useLibraryHomeNavidrome().refresh` |

隐藏项的规则由 core 统一：只有「歌单类」条目能隐藏；隐藏按来源分作用域；隐藏的条目不出现在浏览、筛选和任何批量范围里，只在「管理隐藏」视图里能看到。UI 只负责显示和切换。

在线账户的入口（选平台、登出）也在首页上，但它的动作声明在 account surface 里，见下面「账户」一节。

### 歌手页（`artist`）

可选：不实现时自动由网格渲染。

| 动作 | 是什么 | 分级 | 用到的 core |
| --- | --- | --- | --- |
| `play` / `enqueue` | 播放 / 入队某首热门歌曲 | 基础 | `playback` 端口；歌手资源的 `topSongs` |
| `open-album` | 打开歌手的某张专辑 | 基础 | `artistAlbumLink(album, collection)` → `onOpenAlbum` |
| `filter` | 按名字筛选专辑 | 推荐 | `useLibrarySessionQuery` |
| `play-scope` / `enqueue-scope` | 播放全部热门歌曲 / 整批加入队列 | 推荐 | `playback.enqueueAll(tracks, { suppressToast: true })` 返回实际收下的条数 |
| `open-artist` | 打开歌曲上的其他歌手 | 推荐 | `onOpenArtist` |
| `reload` / `resume-sync` | 加载失败时重试、专辑分页中断时续页 | 推荐 | `resource.reload()` / `resource.retryAlbums()` |
| `edit-entity` | 编辑本地歌手实体 | 可选 | `onEditEntity`（对话框由宿主提供） |

歌手资源的状态：`idle` / `loading` 显示加载中；`ready` 但没有 `detail` 是空态；`error` 显示加载失败。

## 账户：登录、选择与切换确认

在线账户的全部流程在 core 的账户 controller 里（`core/account/providerAccountController.service.ts`，契约 `core/account/account.contract.ts`，纯规则 `core/account/accountRules.ts`）：登录会话（扫码，或在系统浏览器里确认）、选平台规则、待确认切换、登出。

登录只有一个窗口：`src/components/login/LoginHost.tsx`，在 `src/App.tsx` 里挂一次，换 suite、离开首页都不卸载。任何界面要登录都调 `openLoginWindow(providerId | null, pressedElement)`（`src/components/login/loginWindowStore.ts`；`null` 是不替用户选平台；给了按下去的元素，窗口就从它那一边出来），关窗只有 `closeLoginWindow`。换平台、登录、选登录方式、失败说明与诊断、重启本地服务、登出都在这个窗口里，经同一个 controller。suite 只画打开窗口的入口和切换确认：

| 入口 | 位置 |
| --- | --- |
| grid 首页没人登录时的登录面板 | `components/login/HomeLoginPanel.tsx` |
| grid 首页右下角的切换器 | `components/login/SwitcherPill.tsx` |
| bravais 首页在线页签窄缝的账户入口 | `suites/bravais/BravaisSeamAccountSwitcher.tsx`（`useBravaisHomeAccount.ts`） |
| TUI 在线页签的平台列表 | `suites/tui/LibraryTuiAccountList.tsx`：调 `selectProvider`，要登录时打开窗口 |
| 播放器面板的账户页 | `components/panelTab/AccountTab.tsx` |

登出先问一句再退。问话框和退出后的提示属于 App（`components/app/dialogs/useProviderSignOut.ts`，经 `useLibraryAccountController` 的 `confirmLogout` / `logout` 端口接进 controller），所以在播放器面板里也能弹出。

### controller 的快照与动作

App 创建一个 controller（`app/useLibraryAccountController.ts`，App 卸载时 `dispose`），交给登录窗口，经首页 props 的 `account` 交给 home surface，经 account surface 的 `account` 交给确认界面，也交给播放器面板的 AccountTab。suite 只订阅、调动作，不创建也不销毁。

快照（`getSnapshot` / `subscribe`，没有变化时保持身份）：

| 字段 | 内容 |
| --- | --- |
| `providers` / `activeProviderId` | provider 列表 × 账户 store；当前平台已回落（存的平台不在列表里时是默认平台，`resolveActiveProviderId`） |
| `login` | 当前登录会话，同一时间最多一个：`phase`（`resolving-methods` / `choosing-method` / `ready` / `loading`，以及 provider 轮询回的状态）、`methods` 与 `selectedMethodId`、`inBrowser`（在浏览器里确认，没有二维码）与 `codeImage`、`canReopenLoginPage`、`failure`（分好类的失败，见下）、`selfCheck`、`localService`（登录要靠的本地服务：可不可用、没起来、正在重启）、`texts`（平台自己的登录标题与说明） |
| `pendingSwitch` | 待确认切换 `{ id, from, to, reason }`，`reason` 是 `switch` 或 `activate-after-login` |
| `logout` | 登出进度，同一时间最多一个在途（含问用户的那一会儿） |
| `lastLoginCompletion` | 最近一次登录确认的结局（`completed` / `refresh-failed` / `activation-declined`），登录窗口据它放登录成功的动画 |

动作全部返回判别式结果，文案由 UI 翻译（绑定 `core/account/useLibraryAccount.ts`：`useLibraryAccountLogin` 给登录会话，`useLibraryAccountPendingSwitch` 给翻译好的切换确认，`useLibraryAccountProviders` 给平台列表）：

| 动作 | 语义 | 结果 |
| --- | --- | --- |
| `selectProvider(id)` | 选平台：未配置或不在列表 → 不可用；能直接切（已登录 / 无需登录）→ `requestSwitch`；否则 `startLogin` | `unavailable` / `switch` / `login`，后两支带各自的结果 |
| `requestSwitch(id)` | 同平台直接 `switched`（`changed: false`）；否则生成 `pendingSwitch` 等用户答复，已有的待确认请求按 `declined`（`superseded`）结算 | 用户答复后才 resolve：`switched` / `declined`（`cancelled` / `superseded` / `disposed`）/ `unavailable` |
| `confirmSwitch(requestId)` / `cancelSwitch(requestId)` | 按请求 id 结算 | `confirmed` / `cancelled`；过期的 id 返回 `stale` |
| `startLogin(id)` | 先停掉旧会话；解析登录方式（带竞态代次），多方式停在 `choosing-method` | `started`（`step` 为 `choosing-method` / `ready` / `started`）/ `superseded` / `unavailable` |
| `selectLoginMethod(methodId)` / `retryLogin()` | 在当前会话里重新开始，旧会话的 key 单独取消；重试保留已选的方式 | `requested` / `no-session` / `rejected`（`unknown-method` / `method-required` / `cooling-down` / `not-retryable`） |
| `openLoginPage()` | 浏览器登录时再打开一次登录页 | `opened` / `failed` / `no-session` / `rejected`（`not-reopenable`） |
| `closeLogin()` | 停轮询、取消会话、清快照（同步） | `closed` / `no-session` |
| `restartLocalService()` | 只在本地服务可重启时（`canRestartLocalService`）；恢复运行且登录没有自己走下去时重新开始 | `resumed` / `still-down` / `no-session` / `rejected`（`not-restartable`） |
| `buildLoginDiagnosticReport()` | 诊断报告文本 | `ok` / `no-session` |
| `logout(id)` | 只对已登录的平台（`resolveLogoutEligibility`）；先经宿主端口问用户，再走 per-provider logout；退出当前平台且播放器里有歌时会清空播放器 | `logged-out` / `cancelled` / `rejected`（`unknown-provider` / `not-authenticated`）/ `busy` / `failed` |

确认切换后的顺序：清掉 `pendingSwitch` → 宿主端口 `resetForProviderSwitch(next, previous)`（清 automix 尾音、audio、队列、歌词、prefetch、track profile、搜索运行态与集合导航；抛错只记日志，照样切换）→ 作废上一个平台的在途请求（默认装配是 `omni.invalidateActiveRequests()`）→ 写当前平台 → `reason` 为 `switch` 时刷新新账户。`requestSwitch` 的 Promise 在刷新之后才 resolve。

登录确认后的链路：会话的确认回调只刷新账户。刷新返回 `false` 或抛错 → 会话回到 `error`，界面重新显示失败；成功且登录的不是当前平台 → 回调结束后发起 `reason: 'activate-after-login'` 的待确认切换；用户拒绝时结局是 `activation-declined`，登录本身仍成功。刷新期间登录被关掉或换了，不再发起激活确认。

单一在途登录：新的 `startLogin` 先停掉旧会话再解析方式，旧会话不会在后台替旧平台确认登录；解析方式期间又来一次 `startLogin`，前一次返回 `superseded`。

开始请求串行：上一轮的开始请求还没回来时，新一轮先等它结算再发，等待期间又被取代就不发。后端同一时间只允许一个码在建会话，并发的第二个会被拒（409）。

失败分类：登录没成功时，会话把知道的事实交给 `services/onlineMusic/login/loginFailureCase.ts`，分成一种有名字的情况（`LoginCaseId`，例如 `code-expired`、`retry-later`、`device-limit`、`local-service-stopped`、`browser-not-opened`、`unknown`），登录窗口按情况给标题和操作（刷新二维码、重新登录、等一会再试、重启本地服务、重新打开浏览器）。平台自己的状态码是什么意思，由那个平台的 adapter 说，这个文件不认识任何平台。平台要求等多久（`retryAfterMs`）时，重来要等到那时：`canRetryLogin` 为 false，`retryLogin` 返回 `rejected`（`cooling-down`）。播放与集合读取的失败用另一套同样的分法（`services/onlineMusic/failure/onlineFailureCase.ts`，`OnlineFailureCaseId`）。

日志：会话与 controller 里的错误（开始、轮询、取消、方式解析、确认后与切换后的刷新、本地服务重启、登出）经 `accountRules` 的 `describeLoginError` 描述，不分 provider。轮询遇到网络层瞬时失败（`transient`）时，会话连续容忍 `PROVIDER_LOGIN_TRANSIENT_POLL_LIMIT` 次再算失败，每次记一条 `poll:retry`。

自检：会话进入失败后，provider 有自检能力（`canRunLoginSelfCheck`）就自动跑一次 `runLoginSelfCheck`，快照的 `selfCheck` 先是 running，结果回来后带上结构化结果与结论（`core/account/loginSelfCheckRules` 的 `resolveLoginSelfCheckVerdict`）；新一轮开始时晚到的结果作废。

寿命：controller 与登录窗口都属于 App，换 suite 不重建，登录会话与待确认切换都在 controller 里，所以登录进行中切换 suite，窗口照常开着，新 suite 接着显示同一个待确认请求。account surface 的宿主 `app/LibraryAccountHost.tsx` 挂在首页外壳 `components/app/Home.tsx` 里，首页整个卸载时关闭登录会话、把待确认切换按取消结算。启动恢复会话时直接写当前平台，不经确认。

### account surface

登录不在 account surface 里：七个账户动作里的登录、选方式、诊断、重启本地服务都由登录窗口答复，与当前 suite 无关。account surface 要答复的只剩切换确认。确认会阻塞流程，必须有人答复，所以 account surface **整体回退**：当前 suite 没有 `account` surface 就由 grid 的 `GridAccountSurface` 答复（bravais 就是）；声明了 `account` surface 就必须列全三个基础动作，缺一个时建 suite 索引直接抛错（`core/suite/librarySuites.ts` 的 `LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS`）。

| 动作 | 是什么 | 分级 | 谁画 |
| --- | --- | --- | --- |
| `account-login` | 登录会话的状态、重试、关闭 | 基础 | 登录窗口 |
| `account-login-method` | 多方式 provider 先选方式再开始 | 基础（有多方式的 provider 才用到） | 登录窗口 |
| `account-switch-confirm` | 确认 / 取消待确认切换 | 基础 | account surface（`useLibraryAccountPendingSwitch`；`confirmSwitch` / `cancelSwitch`） |
| `account-select` | 首页上的平台入口，选平台 | 推荐 | 首页入口与登录窗口（`useLibraryAccountProviders`；`selectProvider`） |
| `account-logout` | 登出 | 推荐 | 登录窗口、TUI 平台列表、AccountTab（`canLogoutProvider`；`logout`） |
| `account-login-diagnostics` | 失败后的说明、自检结论、诊断报告 | 可选 | 登录窗口（`buildLoginDiagnosticReport`） |
| `account-backend-restart` | 本地服务没起来时重启 | 可选 | 登录窗口（`restartLocalService`） |

`account-select` / `account-logout` 画在首页上，但和其余账户动作一起声明在 entry 的 `surfaces.account` 里。

account surface 只在 `pendingSwitch` 非空时渲染内容。它不是一页，叠在首页之上：

- grid：`GridAccountSurface` 是通用确认框，portal 到 `body`（fixed，z-200，盖住首页与切换器）。
- TUI：自己渲染一个 fixed 全屏层（z-200）里的确认方框。

写首页上的账户入口与 account surface 时：

- 不要调 Omni 的登录 / 登出接口，也不要读 `useOnlineProviderAccountStore`、`useNeteaseApiStatusStore`，数据和动作都来自 controller；要登录就调 `openLoginWindow`，不要自己画登录界面。
- 确认框按下确认后立即收起：`confirmSwitch` 同步清掉 `pendingSwitch`，不要 `await confirmSwitch` 再关框（它要等清理与刷新走完）。
- 登出入口的可用性用 `core/account/accountRules` 的 `canLogoutProvider`，且 `logout.status` 不是 `pending`；与 controller 的判定、登录窗口、AccountTab 一致。
- 键盘只在 `isInteractive` 为真且确认框显示着时接。`isInteractive` 是首页外壳层的值，集合层打开时可能仍为真；确认框在最上层时，挂 `data-folia-keyboard-window` 让底下的页面按键与全局热键让路。独占不带修饰键的按键可以复用 `src/hooks/useExclusiveKeyLayer`。

## 写一套新 suite 的步骤

1. 新建 `src/library/suites/<id>/entry.ts`，默认导出一个 `LibrarySuiteManifest`：`id`、显示名（`labelKey`）、`surfaces`（每个页面的组件 + 声明的动作），可选的 `transitions`（转场钩子与背景板订阅）、`layout`（「完成」时忘掉布局记录）、`stage`（横跨首页与集合层的常驻舞台，见「常驻舞台」一节）、`stageWallHandoff`（stage 参与与 Lattice 的翻牌交接）与 `chromeActions`（只出现在命令面板里的外观动作，见「外观动作」一节）。组件与 stage 必须用 `React.lazy` 引入（只有默认 suite 例外）。registry 会自动发现它，不需要在别处登记。
2. 先实现 `collection`。用 core 的 hooks 拿数据和动作：`useCollectionResourceState`（订阅资源）、`useCollectionView`（筛选与范围）、`useCollectionActions`（播放、入队、重拉）、`useCollectionMutationSnapshot`（变更能力与状态）、`useLibrarySessionQuery`（筛选词）。
3. 向命令面板注册：集合页用 `useGridSurfaceRegistration` + `buildCoreSurfaceParams`（它会按你的声明过滤）；目录用 `useLibraryDirectorySurfaceRegistration`；歌手页用 `useLibraryArtistSurfaceRegistration`；suite 自己的外观动作用 `useLibrarySuiteChromeRegistration`。只在 `isInteractive` 为真时注册。
4. 键盘：可打印字符留给命令面板分发（它先留下自己的 `:` 执行模式与可选的 `s`），空格是全局的播放 / 暂停。你的页面只用方向键、Enter（可带修饰键）、Delete、Insert、Esc、功能键这类不可打印的键。筛选框默认是命令面板的内联框（`useGridCommandFilter`）；要用自己画的输入框（bravais 的缝），直接 `registerCommandFilter` 并给 `ownInput: { takeKey, open }`（`CommandFilterAnchor`，`src/stores/useAppViewStore.ts`）：命令面板把墙上的打字交给 `takeKey`、把「打开筛选框」的请求交给 `open`，`filter-view` 命令（列表里选、Ctrl/Cmd+F）照常打开它自己的框（没有锚点时是浮层），读写同一个 query。
5. 在 `entry.ts` 里如实声明你做了哪些动作。没把握的先别声明：它会自动在命令面板里消失，用户切回网格就能做。
6. 账户：登录一律调 `openLoginWindow` 打开共用的登录窗口。不做 `account` surface 时切换确认由网格答复；要做就列全三个基础动作，按上面「账户」一节的规则写。
7. 测试：`test/component/libraryBehavior.spec.ts`、`homeBehavior.spec.ts`、`artistBehavior.spec.ts`、`accountBehavior.spec.ts` 里的语义用例按 suite 参数化。把你的 suite 加进去，同一批场景会对它再跑一遍；e2e 的 `test/ui/libraryNavigation.spec.ts` 与 `libraryRendererSwitch.spec.ts` 覆盖真实应用里的导航与切换。

## 规则（写 suite 时不要做的事）

- 不要在 suite 里调用 Omni、本地曲库服务、Navidrome 服务或 core 的 service（`*.service.ts`）。数据和动作都由宿主经 props 交给你。
- 不要 import 别的 suite（包括网格的卡片、六边形视口、转场）。需要共享的东西应放进 core，或者（与资料库无关的画面引擎）放进 `src/components/` 下的共享目录，例如 `src/components/wall/`。
- 不要自己实现删歌、订阅、批量范围这类规则，用 core 的。否则两套 UI 会对同一个动作给出不同的结果。
- 不要把筛选词、选中项、焦点存在组件 state 里。它们在会话 store 里，切换 suite 时才不会丢。
- 布局相关的东西（滚动位置、坐标、展开状态）属于 suite 自己，不要放进 core；但要在 `layout.forget` 里能按会话键丢掉它。
- 不要在 suite 的返回按钮里自己清会话或布局记录：调 `onDone`，由宿主统一做（Escape 调 `onBack`）。
- suites 之外只有 `registry.ts` 引用 suite（宿主、首页外壳都经 registry 解析）；stores / services / utils / types 不 import suites 与 `app/`；不建 barrel。
- 设置 UI（`src/components/modal/settings`）不能 import suite，所以 suite 专属的偏好放 app 层 store（例如 bravais 的透光 `useLibraryWallLookStore`），由 suite 读它。
- wall 引擎（`src/components/wall/`）的边界连 `import type` 与动态 import 一起查（`test/unit/wall/wallBoundaries.test.ts`，codemap 的 `BOUNDARY_RULES` 同一条）。新几何写成不 import React 的纯函数放进 wall；透光 / 底板等 bravais 专属的东西不放 wall，Lattice 的队列模型、键盘焦点（`useWallKeyboardFocus`，名字带 Wall 但仍在 Lattice 目录）、播放展开也不放。wall 的 CSS 类名与变量沿用 `.lattice-*` / `--lattice-*`（测试选择器依赖它们），bravais 的 DOM 也用这些类名。

## 现有 suite 的对照

| 页面 | grid（默认、回退） | bravais（正式新 UI） | tui（开发验证） |
| --- | --- | --- | --- |
| home | 全部 15 个动作；没人登录时的登录面板与右下角的切换器（都打开登录窗口） | 全部 15 个动作；六个页签各是一面墙（F6 整墙出场 / 入场），探索页签的条目照网格的探索拼贴的排法铺在墙上（`BravaisHomeExplore.tsx`，墙形 `bravaisWallShape.ts`），本地四行与 Navidrome 分区是缝里的二级切换；每个页签都有当前页过滤（墙上打字进窄缝里的输入位，目录会话的 query）；目录树面板（= 批量模式）、管理隐藏视图、导入 / 刷新与 app 入口在首页窄缝里 | 全部；在线页签是可操作的平台列表（未登录时即页签内容，已登录时 F2 打开） |
| collection | 全部 23 个，另有信息面板、曲目侧栏、编辑模式三个局部动作 | 全部 23 个；三个局部动作改为外观动作（缝等级、`list`）与改名表单态 | 除 `add-to-playlist` / `create-playlist` 外全部（行上的歌手 / 专辑可打开，Alt+Enter / Alt+Shift+Enter） |
| artist | 全部 10 个 | 全部 10 个；热门歌曲与专辑混排在一面墙上，信息在缝里 | 全部 |
| account | 全部 7 个动作：通用确认框（portal 到 body）；登录在共用的登录窗口里 | 不声明：确认回退到 grid 的确认框；首页在线页签窄缝的账户入口打开登录窗口 | 全部 7 个动作：fixed 全屏层里的确认方框；在线页签的平台列表要登录时打开登录窗口 |
| stage | — | `BravaisStage`（墙、相机、缝、翻牌、聚焦卡、键盘、面板） | — |
| transitions | `beforePush` / `beforeBack` / `Overlay`（移形换影）/ `backdrop` | 只有 `beforePush` / `reset` | 无 |
| 外观动作 | — | 10 条（见下） | — |
| 布局记录 | `folia_gridview_state:v2:` / `folia_artist_grid_state:v2:` | sessionStorage `folia_bravais_layout:v1:<会话键>` | 无（焦点写回会话） |

### bravais：一面墙与一道缝

设计与理由在 bravais 的设计稿里（下称设计稿，不随仓库分发）；这里只写它与 core / 宿主的接口。代码在 `src/library/suites/bravais/`，与内容无关的墙面几何在共享的 wall 引擎 `src/components/wall/`（Lattice 也用它；wall 不依赖 `components/app/**` 与 `src/library/**`）。

**stage 与 surface 的分工**

- `BravaisStage`（manifest 的 `stage`）拥有画面：墙（虚拟化的磁贴，最多约 400 张）、相机、缝（信息条 / 书脊 / 折叠三级开口，只开在 12×8 块的边界上；设置「信息条方向」为横向、或自动且屏幕竖着时开在块行之间）、翻牌、聚焦卡、键盘焦点、列表 / 目录树面板、表单态，以及外观动作的注册。
- `BravaisHome` / `BravaisCollection` / `BravaisArtist` 订阅 core 的 binding，把数据投影成**层描述**（`BravaisLayer`：已投影的展示数据 + 身份稳定的回调，不放资源对象），经 `useBravaisLayerRegistration` 推进 suite 内的 `bravaisStageStore`（首页一个位、顶层一个位）；照常注册命令面板；自己只渲染不接指针的锚点（`data-ponder-page-scope="bravais-wall"`）。
- bravais 不声明 account surface：切换确认回退到 grid 的确认框，登录在共用的登录窗口里。首页在线页签窄缝的账户入口（`BravaisSeamAccountSwitcher`）是一个按钮，点了打开登录窗口（已登录时开在当前平台上）。
- stage 按导航快照的 `depth` 与上次显示时记下的深度决定换层种类：变深 = push（被点的磁贴成为起点，排序从它向外展开）、变浅 = back（按布局记忆恢复相机、缝的锚点、起点与焦点）、同深度换层 = replace（首页换页签，整墙出场 / 入场）、`origin` 为 search / player 时 0 ↔ ≥1 是整墙 enter / exit。栈里有重复的集合时，「同键不同深度且正是栈顶」也算换层。stage 根节点的 `data-bravais-shift` / `-seq` 记下每次换层。

**导航**

- transitions 只声明 `beforePush`（墙上点磁贴、聚焦卡的链接已记下起点；命令面板对焦点那一项的打开用键盘焦点所在的 slot）与 `reset`（丢掉没用掉的起点与移除的翻牌起点）；钩子经 entry 的 `installBravaisTransitionHook` 由 stage 的 chunk 装上。
- 集合页的描述（歌单简介、专辑介绍）在完整信息条的标题下方，取自 core 的 `resolveCollectionDescription`（与网格信息面板同一条合并规则：详情盖在集合描述上）；与歌手页的「关于艺术家」共用 `BravaisSeamAbout`（书勒口式的简介：不加小节标题；正文 4 行截断、点开封顶后块内滚动、纯文本保留换行；歌手页另有头像 + 名字的署名与「N 首歌 · M 张专辑」附注），书脊上没有。见设计稿 §10.2「描述」。
- 面包屑在缝里（`BravaisSeamCrumbs`，规则 `bravaisCrumbs`）：根是书库 / 搜索 / 播放页（按 `origin`），中间层名字来自 `trail`，多于一层时折成可展开的「…」；点击调层描述上的 `onPopTo`（集合与歌手 surface 把宿主的 `onPopTo` 包成稳定回调交给 stage）。面板开着时当前层名 = 关面板。
- 面板 history：列表面板与目录树面板是导航状态，`bravaisPanelHistory` 按「suite 自己的 history 记录」的规则 `pushState`（标记 `bravaisPanel`）；应用内返回先关面板，折叠往返与跳层越过它。
- 「降低动态效果」：stage 自己解析（`bravaisMotion`：「队列拼贴」或「歌单展开转场」任一降级）——翻牌换成 0.18 秒淡出淡入、整墙波次换成淡入淡出；相机、缝与悬停的补间只看 `lattice` 动效面。
- 与 Lattice 的翻牌交接（`stageWallHandoff: true`，`useBravaisWallHandoff`）：进 Lattice 时缝合上、窗关上，从聚焦卡 / 键盘焦点 / 视口中心向外一波半圈翻牌，每块翻过去就成了 Lattice 的海报；回来时反过来，翻完缝张开、窗打开，fb3 的展开在这之后。右下角工具按钮是 App 的 `WallToolsDock` 里两面墙共用的一颗。细节见设计稿 §7「进 / 出 Lattice」。
- 唯一的离墙路径：首页缝里的全局搜索提交走 `onSearchCommitted`，去 `SearchWorkspace`（core 的 search surface 落地后再进墙）。从搜索页 / 播放页打开集合时整墙入场，回到来源时整墙出场。
- 特殊集合（core 的 `resolveLibraryHomeSpecial`）：墙上那张卡的类型标签是强调色底 + 小图标（`is-special`、`data-bravais-special`）；首页窄缝中段二级切换下面隔一道分隔线是它们的直达入口（只显示图标，`data-bravais-shortcut`），只在那张集合此刻真有、没被隐藏时出现，在线看当前页签的卡，本地 / Navidrome 不限当前行。点入口与点那张卡同一条打开路径（stage 的 `openShortcut`：墙上屏内找得到就以它为起点磁贴、走 `onOpenItem`；找不到就经同一个 `homeResources.actions.open*` 打开，以缝为中心）。放不下时入口先于二级切换让位，挪进「⋯」菜单。见设计稿 §10.5「特殊集合」、§7.5。
- 磁贴按种类换样子（设计稿 §7.7）：集合（专辑 / 歌单 / 文件夹 / 每日推荐）右下边缘露出两层错开的叠页边（内容层自己的 box-shadow，落在磁贴间距里；设置可关，stage 根节点 `has-stack-edges`），曲目数并进类型标签（「歌单 · 124」，`formatCollectionBadge`，投影时从 `trackCount` 来，未知只写种类；可访问名里是条目的 `trackCountLabel`），歌手是双色调人像（亮端取自头像，`bravaisArtistTone` 复用 `utils/colorExtractor`，取不到回退强调色），歌曲与私人 FM 不变。判定只看条目的 `kind` / `direct`（`bravaisTileForm`）。歌手页专辑的曲目数来自 core `LibraryArtistAlbum.trackCount`（可选，grid / TUI 不用）。

**当前页过滤**（设计稿 §7.6，2026-10-08 起取代「palette 内联框 + 首页不注册过滤」）

- 每一面墙都有：首页各页签（歌单 / 电台 / 专辑 / 本地四行 / Navidrome 各 section）、集合页、歌手页、目录面板。过滤词在 core 的会话里、与 grid / TUI 同一个 port：集合 / 歌手页是浏览会话（`useLibrarySessionQuery`），首页各页签是目录会话（`useLibraryDirectoryQuery(directoryKey)`，`directoryKey` 来自 `useLibraryHomeDirectory`；寿命沿用目录的开关规则：换页签 / section 换目录，离开首页关掉；关目录树面板只丢选择、过滤词留着）。
- 注册：`useBravaisSeamFilter` 向命令面板注册同一个 query（`registerCommandFilter`，`getAnchor` 为 null）并给 `ownInput`。墙上的可打印字符由命令面板分发：先留下 `:`（与打开了交互设置时的 `s`），其余交给 `ownInput.takeKey`——缝里的输入位挂着就把焦点挪进去、这一下按键落进输入框；没挂（书脊、折叠、翻牌途中、首页窄缝里还没出现）就让缝临时展开、字符先追加进 query。Space 不算；首页非批量模式时 `/` 是保留键（搜索在线平台）。所以 bravais 上 `s` 只是过滤字符，Ctrl/Cmd+K 照常打开命令面板。
- 输入位是缝自己的（`BravaisSeamFilterField`：漏斗 + 下划线 +「过滤当前页」+ 匹配数 / 清除）：完整信息条、列表 / 目录面板里一直在；首页窄缝里只在正在输入或有过滤词时出现；书脊上过滤中只有一个过滤图标。Esc 先清空再结束输入，↓ / Enter 把键盘焦点交给墙上 rank 0（过滤词保留），组词期间不处理也不过滤（输入位报告组词，墙用的过滤词停在组词开始前）。「正在输入」（`bravaisUiStore.filterEditing`）决定书脊 / 折叠的临时展开（`bravaisSeamTarget` 的 `filterOpen`），结束输入后缩回原等级。过滤时墙退化为有限拼贴。
- 命令面板路径保留：`filter-view`（列表里选、Ctrl/Cmd+F）在 bravais 上是命令面板自己的浮层，读写同一个 query；`--play` / `--add` 只在那里（缝里的输入位不解析 `--` 参数）。
- 与搜索明确区分：搜索在线平台只经首页工具格的 ⌕ 与 `/` 进入，整条缝换成搜索态（放大镜、带框的输入框、「搜索在线平台」、一行说明、「搜索」按钮），提交才发 provider 请求、切到搜索结果；过滤不发请求，只收窄当前墙。搜索结果还在 `SearchWorkspace`（不在墙上），墙内的搜索层落地后同样注册当前页过滤。

**外观动作**（命令 id `bravais-<id>`）

| id | 做什么 | 执行键 | 可用 |
| --- | --- | --- | --- |
| `seam-full` / `seam-spine` / `seam-hide` | 缝的开口：完整信息条 / 书脊 / 折叠到屏幕侧边 | — | 当前等级不是它 |
| `seam-here` | 缝随墙滑出屏后在当前视野里重新裂开 | — | 缝收在屏幕边缘（没有折叠） |
| `list` | 打开列表面板（grid 曲目侧栏的对应） | —（`l` 被全局循环播放占用） | 非首页层、面板没开 |
| `directory` | 打开目录树面板（批量模式） | — | 首页本地有批量的那几行、面板没开 |
| `locate-playing` | 集合层与网格的集合页一样问定位器（`locatePlayingSongOnPage`）：歌在墙上就把离缝最近的那一份移到屏幕中间、展开它的聚焦卡（`useBravaisLocate.ts`，stage 的 `showSlot`），不在就由定位器在状态行说；其它层直接展开墙上那一份。按钮在墙的工具按钮正上方，与网格、Lattice 的定位按钮同一颗 | `c` | 集合层：有歌在放；其它层：墙上有正在播放的条目 |
| `wall-look` | 循环透光三档 | `p` | 有当前层即可 |
| `more-windows` / `fewer-windows` | 部分透明时每块多开 / 少开一个窗 | — | 部分透明且没到 1 / 6 的边界 |

**透光与遮挡播放页**

- 三档：实色（默认；2026-10-08 起，此前默认部分透明，已存的选择不迁移）/ 部分透明（每块 12 个 slot 里固定 k 个是透明的「窗」，k = 1–6，默认 3）/ 全透明（墙上的磁贴只画标题，聚焦卡照常画封面）。窗是 wall 引擎的保留位（`blockReservedSlots`），rank→slot 跳过它们，不可聚焦、不可点。
- 偏好是 app 层的 `src/stores/useLibraryWallLookStore.ts`（`look`、`windowsPerBlock`，localStorage `library_wall_look` / `library_wall_windows_per_block`）——设置 UI 不能 import suite，所以不放在 suite 里。设置在界面设置「Bravais 墙面」分组（`BravaisSettingsSection`，紧跟「资料库界面」，只在生效 suite 是 bravais 时显示；bravais 独有的设置都放这里）里的 `LibraryWallLookSettings`，命令面板有 `library-wall-look-picker` 与 `library-wall-windows-picker`（窗数只在部分透明时可用），外观动作 `wall-look` / `more-windows` / `fewer-windows` 写同一个 store。**不进外观配置的导入导出**（用户决定，是 `skills/settings-feature-integration` 视觉设置规则的明确例外，store 的 `@note` 写明）。同一 store 的集合叠页边开关 `collectionStackEdges`（`library_wall_stack_edges`）没有这个例外，进导入导出（`libraryWallStackEdges` / 短码 `lwse`）；命令 `library-wall-stack-edges-toggle`，分组锚点命令 `settings-bravais`。信息条的材质与墙后的画面（2026-10-09）同样没有例外、同样进导入导出：`seamClear`（信息条始终透明，`library_wall_seam_clear`，`libraryWallSeamClear` / `lwsc`）、`seamStyle`（实色模式的 8 个预设，`library_wall_seam_style`，`libraryWallSeamStyle` / `lwss`，材质定义在 `utils/libraryWallSeamStyle.ts`）、`backdropLyrics` / `backdropBlur`（`library_wall_backdrop_lyrics` / `_blur`，`lwbl` / `lwbb`）；命令 `library-wall-seam-clear-toggle`、`library-wall-seam-style-picker`（透明开着时不可用）、`library-wall-backdrop-lyrics-toggle`、`library-wall-backdrop-blur-toggle`。信息条方向 `seamDirection`（自动 / 竖向 / 横向，默认自动；`library_wall_seam_direction`，`libraryWallSeamDirection` / `lwsd`，命令 `library-wall-seam-direction-picker`，规则在 `utils/libraryWallSeamDirection.ts`）同样进导入导出。自动只看视口形状：高至少是宽的 1.1 倍时算竖屏、用横向，转屏时缝合上再换方向张开。横向时首页窄缝 / 书脊、集合与歌手页的信息条 / 书脊和首页搜索框从块行之间的横向缝隙裂开（锚点是块行边界的世界 y，墙上下分开，`bravaisAnchor`、`BravaisSeamRow` / `BravaisSeamHomeRow`、`bravaisSeamRow.css`）；列表 / 目录面板、表单与歌手 / 专辑海报仍是竖的，换方向时缝先合上再在另一个方向张开（`useBravaisSeam`）。折叠标签仍在左右侧边。
- 叠色与熄灯（`useLatticeSettingsStore`，与 Lattice 共用）也作用到缝与集合的叠页边（设计稿 §7.5「缝（信息条）也受叠色与熄灯影响」、§7.7），样式在 `bravaisAppearance.css` / `bravaisTileKinds.css`，共享的 `wall.css` 不动。
- 两个透明档下，墙面由按块的实色底板铺（每个已挂载的 12×8 块一张内联 SVG，只在窗位挖洞，随相机平移；聚焦卡让位时只逐帧重画那一块），详见设计稿 §11。
- 实色档、且信息条不是「始终透明」时 stage `reportPlayerOcclusion(true)`，首页停稳后 visualizer 卸载（与 Lattice 一致）；其余情况（透光档，或透明的缝）报 `false`，visualizer 照常在墙下渲染。墙后画面的歌词 / 模糊经 `reportPlayerBackdrop` 报给宿主（只在透着时为真）。

**布局记忆**：每层的相机视图中心、缝的锚点、无限墙的起点 slot、键盘焦点 slot 存在 sessionStorage `folia_bravais_layout:v1:<会话键>`（首页的会话键是 `'home'`），`layout.forget` 整条删除；缝的开口等级是全局的（`useBravaisSeamStore`，跨层沿用、跨 stage 卸载存活），不按层记。

**测试**

- 参数化：`libraryBehavior` / `homeBehavior` / `artistBehavior` / `accountBehavior` 的 suite 列表含 bravais（含 `[switch]`）；另有 `[bravais-only]` 用例。墙是虚拟化的，用例经列表面板或键盘焦点定位条目，翻牌期间 stage 根节点挂 `data-bravais-settling`，要等它消失再点。
- bravais 自己的组件用例：`test/component/bravaisWall.spec.ts`、`bravaisLook.spec.ts`、`bravaisHome.spec.ts`、`bravaisSpecialCards.spec.ts`（特殊集合的标签与直达入口）、`bravaisPerf.spec.ts`（性能护栏：计数为主）。首页探针的 probe-a 歌单列表里 public 标成 `isLiked`（`HOME_LIKED_PLAYLIST`），探针另有 `signOut(providerId)` 让在线页签回到未登录。e2e：`test/ui/bravaisCollectionFilter.spec.ts`、`bravaisVisualizerMount.spec.ts`、`bravaisPanelFold.spec.ts`，以及 `libraryNavigation` / `libraryRendererSwitch` 里的 bravais 用例。单测在 `test/unit/library/bravais/`，wall 引擎的在 `test/unit/wall/`。
- 当前页过滤：组件探针里没有命令面板，`libraryBehavior` / `homeBehavior` 探针挂了 `dev/probes/paletteTypingStandIn.ts`（只照搬命令面板把打字交给 `ownInput` 的那一支），组件用例因此能在墙上直接打字（`libraryBehavior` 的 `[bravais-only] collection page`、`artistBehavior` 的 `[bravais-only] artist page wall`、`bravaisHome` 的首页过滤 / 搜索与过滤的区分 / 书脊下打字）；真实命令面板的那一支、`filter-view` 浮层与 `--play`、首页 `s` 与 `/` 在 e2e `bravaisCollectionFilter.spec.ts`。
- 性能探针：`dev-probe.html?probe=bravaisPerf`（`npm run dev:probe`），整套矩阵 `npm run manual:bravais-perf`；用法与换机实测清单在 `dev/probes/bravais-perf/README.md`。
- 探针标记统一用 `data-bravais-*`（磁贴 `data-bravais-slot` / `-kind`、聚焦卡 `data-bravais-focus-card`、缝 `data-bravais-seam` / `-seam-level` / `-seam-action`、面板 `data-bravais-list`、表单 `data-bravais-form` 等）；集合曲目磁贴另有通用的 `data-library-entry`。

### TUI：开发验证 suite

TUI 的账户按键：

| 位置 | 按键 |
| --- | --- |
| 首页 | F2 打开 / 关上在线页签的平台列表（不在在线来源时先切过去）；列表里 ↑↓ / Home / End 移动，Enter 选平台（`selectProvider`），Delete 登出当前且已登录的平台，Esc 或 F2 关掉（未登录时列表就是页签内容，不关） |
| 切换确认 | Enter 确认，Esc 取消 |

账户层的按键在 window 的捕获阶段独占：不带修饰键的按键一律截住，底下的 TUI 页面、命令面板的打字即筛选和全局空格都收不到；带 Ctrl / Alt / Meta 的组合键与 Tab 放过。账户层可交互时挂 `data-folia-keyboard-window`，只在层显示着且首页外壳 `isInteractive` 为真时装监听。

TUI 保留为 Library Core 的又一个消费者和开发验证 suite。普通开发默认关闭（只有 grid 与 bravais 可用）。要手动验证，显式启用：

```sh
npx cross-env VITE_LIBRARY_TUI=true npm run dev
npx cross-env VITE_LIBRARY_TUI=true npm run dev:probe
```

启用后，开发浮层和界面设置的「资料库界面」都可以在三套之间切换；切换不重新请求，筛选、选中、焦点与当前播放队列都保留。Vitest 的 `test.env` 和 Playwright 的 `webServer.command` 自动显式启用该 flag，参数化回归覆盖全部三套；跑 Playwright 前应保持 4173 端口空闲，避免复用没有开启 TUI、或没把初始选择钉在 grid 的手动服务器。

entry 用同一个 `import.meta.env.DEV && import.meta.env.VITE_LIBRARY_TUI === 'true'` 条件门控三套 lazy surface 与 `available`。生产构建的 DEV 为 false，即使 flag 误设为 true 仍不可用；关闭或未知 suite id 经真实 registry 回到同一个 grid 解析结果。启用/关闭/生产行为矩阵在 `test/unit/library/tuiAvailability.test.ts`，P5 已用显式 flag=true 的实际 Web 生产构建与浏览器预览确认排除，并核对 App / grid 模块作为正对照；以后修改 entry 时仍应核验实际产物。

## 选哪套：设置项、初始选择与回退

- **回退 suite**（`DEFAULT_LIBRARY_SUITE_ID = 'grid'`）：实现全部 surface，未知 id、缺 surface 时都由它渲染。
- **初始选择**（`LIBRARY_SUITE_INITIAL_CHOICE`，`core/suite/librarySuites.ts`）：用户从没选过时 `useLibrarySuiteStore` 的初值。为 `bravais`（下一版起的正式默认，2026-10-10 用户定），构建变量 `VITE_LIBRARY_INITIAL_SUITE` 可覆盖；Vitest 的 `test.env` 与 Playwright 的 `webServer.command` 把它钉在 `grid`，所以现有截图基线与网格用例不受影响，bravais 的覆盖走参数化用例与它自己的用例。
- **持久化**：store 只在用户选择时写 localStorage `library_suite`，没有记录就用初始选择，所以改初始选择会带走所有没选过的人。store 不校验 id（state 不 import registry），值可能是这个构建里没有的 suite，渲染照常回退。
- **展示「当前」用生效的 suite**：`registry.resolveActiveLibrarySuiteId(store.suite)`（React 里用 `app/librarySuiteChoice` 的 `useActiveLibrarySuiteId`；只关心「是不是 bravais」时用 `app/bravaisLibraryActive`）。设置项、命令面板 picker、开发浮层都这样显示；`switchLibrarySuite` 比较的也是生效的 suite，选中已经生效的那套不算一次选择，不写存储。
- **入口**：界面设置的 `LibrarySuiteSection`（「播放进入视图」下面）、命令面板的 `settings-library-suite`（锚点）与 `library-suite-picker`，都经 `chooseLibrarySuite` → `switchLibrarySuite(resolveCurrentLibrarySessionKey(), id)`。只有一套可用时（`hasLibrarySuiteChoice()` 为假）设置节、侧栏目录项与两条命令都不出现；grid 与 bravais 都在 registry 里，所以正式构建里它们总会出现。开发浮层 `DevLibraryRendererSwitch` 只在开发构建里挂。不进外观配置的导入导出（suite 选择是界面偏好，不是视觉调参）。
- **首启引导**（2026-10-10）：发版说明之后的那个提问（`PlaybackEntryViewPrompt`）分两页，第 1 页选资料库界面，第 2 页是原来的「播放后进入的视图」，可前进 / 后退。第 1 页只列 grid（经典）与 bravais（无限）（`ONBOARDING_LIBRARY_SUITE_IDS`，TUI 不出现），两套都可用时才有这一页（`hasOnboardingLibrarySuiteChoice()`）；卡片点下即经 `chooseLibrarySuite` 写入，与设置项同一条路；关掉提问时（确认、点背景都算）把此刻生效的那套记成选择（`confirmOnboardingLibrarySuite`），之后改初始选择不会把人带走。两页各有自己的「问过」标记，提问打开时只带上还没问的页（`requestPlaybackEntryViewPrompt({ withLibrarySuite })` 决定 `promptPages`）：第 2 页看 `playback_entry_view_chosen`，随这一版的启动顺序走；第 1 页看 `library_suite_prompt_seen`，**每个安装问一次、不看版本**（2026-10-10 用户：给所有人都弹一次；发版说明的版本号 `USER_GUIDE_AUTO_OPEN_VERSION` 每版都变，不能拿来门控它）——回答过旧版单页提问的安装只看到这一页。测试的基础状态把它种成问过。
- **按需加载**：选 grid 的用户不加载 bravais 的任何 chunk——bravais 的 entry 只静态 import react，stage 与三个 surface 都是 `React.lazy`；manifest 本身（含布局键前缀与外观动作声明）随 registry 进 bootstrap。

## 相关文件

- 能力契约：`src/library/core/suite/suite.contract.ts`
- suite 发现与回退：`src/library/registry.ts`、`src/library/core/suite/librarySuites.ts`
- 三套 suite 的声明：`src/library/suites/grid/entry.ts`、`src/library/suites/bravais/entry.ts`、`src/library/suites/tui/entry.ts`
- 宿主：`src/library/app/GridViewOverlayHost.tsx`（集合与歌手页、stage 挂载位）、`src/components/app/Home.tsx`（首页）
- 导航栈：`src/stores/useCollectionNavigationStore.ts`（`notifyCollectionPop` / `subscribeCollectionPop`，`push` 返回 `resolveCollectionPush` 的决定）、`src/library/core/collection/collectionNavigation.ts`（`resolveCollectionPush`、`resolveCollectionPopTo`、`projectNavigationTrail`）、`src/hooks/useAppNavigation.ts`（popstate、`popCollectionLayer`、`popCollectionTo`）、`src/hooks/navigationHistoryJournal.ts`（历史日志、`findLayerBaseIndex`）；单测 `test/unit/navigation/navigationHistoryJournal.test.ts`、`test/unit/library/bravais/bravaisPanelNavigation.test.ts`
- 账户：契约 `src/library/core/account/account.contract.ts`；规则 `core/account/accountRules.ts`；服务 `core/account/providerAccountController.service.ts`、`providerLoginSession.service.ts`、`providerAccountDeps.service.ts`；绑定 `core/account/useLibraryAccount.ts`；宿主 `src/library/app/useLibraryAccountController.ts`、`createLibraryAccountPort.ts`、`LibraryAccountHost.tsx`；登录窗口 `src/components/login/`（`LoginHost.tsx`、`loginWindowStore.ts`、`loginHostState.ts`、`window/`）；登出问话 `src/components/app/dialogs/useProviderSignOut.ts`；失败分类 `src/services/onlineMusic/login/loginFailureCase.ts`；grid `suites/grid/account/`；TUI `suites/tui/LibraryTuiAccount*.tsx`、`useLibraryTuiAccountKeys.ts`；bravais `suites/bravais/BravaisSeamAccountSwitcher.tsx`、`useBravaisHomeAccount.ts`
- 账户回归：探针 `dev/probes/accountBehavior*` + `test/component/accountBehavior.spec.ts`（`window.__accountProbe`，按 suite 参数化，另有 `[grid-only]`、`[switch]` 与 AccountTab 用例）；单测 `test/unit/library/core/accountRules.test.ts`、`providerLoginSession.test.ts`、`providerAccountController.test.ts`、`useLibraryAccount.test.ts`，`test/unit/library/app/useLibraryAccountController.test.ts`、`libraryAccountPort.test.ts`，登录窗口 `test/unit/login/`；account surface 的回退与基础动作校验在 `test/unit/library/core/librarySuites.test.ts`、`test/unit/library/registry.test.ts`
- 背景板订阅与网格设置解析：`src/library/app/useLibraryBackdrop.ts`、`src/library/suites/grid/transitions/gridBackdrop.ts`
- 常驻舞台：契约 `LibrarySuiteStageProps`（`core/suite/suite.contract.ts`）；解析 `registry.resolveLibraryStage`；挂载位 `src/library/app/LibrarySuiteStageSlot.tsx`；背景板 / 首页隐藏规则 `core/suite/libraryStage.ts`；单测 `test/unit/library/app/librarySuiteStageSlot.test.ts`（假 suite 的挂载、卸载与 lazy）、`test/unit/library/core/libraryStage.test.ts`
- 遮挡播放页：store `src/stores/useLibraryPlayerOcclusionStore.ts`、接线 `src/library/app/useLibraryPlayerOcclusionReporter.ts`、挂载条件 `src/components/app/presentation/playerVisualizerMount.ts`、时序 `src/hooks/useLibraryOcclusionSettled.ts`，单测 `test/unit/library/app/libraryPlayerOcclusion.test.ts`（假 suite）、`test/unit/navigation/playerVisualizerMount.test.ts`、`test/unit/hooks/useLibraryOcclusionSettled.test.ts`
- 自带输入框的筛选（bravais 的当前页过滤）：契约 `CommandFilterAnchor.ownInput`（`src/stores/useAppViewStore.ts`）；分发 `src/components/command-palette/useCommandPalette.ts`；bravais `suites/bravais/useBravaisSeamFilter.ts`、`BravaisSeamFilterField.tsx`、`useBravaisCollectionFilter.ts`；按键规则 `bravaisKeyboardModel.resolveBravaisTypingKey`；探针替身 `dev/probes/paletteTypingStandIn.ts`
- 与 Lattice 的翻牌交接：会话 `src/stores/useWallHandoffStore.ts`、director 与宿主的摆法 `src/components/app/presentation/wallHandoffDirector.ts` / `wallHandoffPresentation.ts`、时间表与对齐 `src/components/wall/wallHandoff.ts`、共用的工具按钮 `src/components/wall/WallToolsDock.tsx`、bravais 一半 `suites/bravais/useBravaisWallHandoff.ts`、Lattice 一半 `components/app/lattice/useLatticeWallHandoff.ts`；单测 `test/unit/stores/wallHandoffStore.test.ts`、`test/unit/wall/wallHandoff.test.ts`，e2e `test/ui/wallHandoff.spec.ts`
- 外观动作：契约 `src/library/core/suite/suiteChrome.contract.ts`；规则 `core/suite/suiteChrome.ts`；store `core/suite/useLibrarySuiteChromeStore.ts`；绑定 `core/suite/useLibrarySuiteChromeRegistration.ts`；命令 `src/components/command-palette/commands/suiteChromeCommands.ts`、`commandFactories.createSuiteChromeCommand`、`commandRegistry.setSuiteChromeCommands`；装入 `src/library/app/installLibrarySuiteChromeCommands.ts`（bootstrap 调用）；单测 `test/unit/command-palette/suiteChromeCommands.test.ts`、`test/unit/library/core/useLibrarySuiteChromeRegistration.test.ts`、`suiteChrome.test.ts`
- suite 选项与透光偏好：`src/library/app/librarySuiteChoice.ts`、`bravaisLibraryActive.ts`、`switchLibrarySuite.ts`；设置 `src/components/modal/settings/LibrarySuiteSection.tsx`、`BravaisSettingsSection.tsx`（Bravais 分组）、`LibraryWallLookSettings.tsx`；store `src/library/core/suite/useLibrarySuiteStore.ts`、`src/stores/useLibraryWallLookStore.ts`（取值规则 `src/utils/libraryWallLook.ts`）；命令 `settingsCommands.ts`（`settings-library-suite` / `library-suite-picker`）、`libraryWallLookCommands.ts`
- bravais 首页的探索页签：`suites/bravais/BravaisHomeExplore.tsx`（数据经 `src/components/app/lattice/useExploreWall.ts`，与 Lattice 的探索墙同一份）、墙形 `suites/bravais/bravaisWallShape.ts`；单测 `test/unit/library/bravais/bravaisWallShape.test.ts`
- 定位正在播放：定位器 `src/components/app/playing-song-locator/`（`playingSongLocator.ts` 的 `locatePlayingSongOnPage`、规则 `resolveLocateStep.ts`、页键 `useNavigationPageKey.ts`）；bravais `suites/bravais/useBravaisLocate.ts`；单测 `test/unit/playing-song-locator/resolveLocateStep.test.ts`
- 共享 wall 引擎：`src/components/wall/`（几何、相机、标题、海报样式 `wall.css`）；边界测试 `test/unit/wall/wallBoundaries.test.ts`
- 页面教程解析与回归：`src/services/ponder/pagePonderTarget.ts`、`test/component/pagePonder.spec.ts`
- 分层规则：`skills/codebase-navigation/SKILL.md` 的 Boundaries 段、`test/unit/library/layerBoundaries.test.ts`

## 验收入口

P5 的六项结构与行为条件可由以下入口复查。行为用例同时驱动 grid、bravais 与显式启用的 TUI；支持范围以各 suite 声明为准，不要求开发验证 UI 补齐产品界面。

| 条件 | 验证入口 |
| --- | --- |
| 第二 UI 独立于 grid / hex / morph 完成浏览与支持的动作 | `test/unit/library/layerBoundaries.test.ts`；`libraryBehavior` / `homeBehavior` / `artistBehavior` 组件用例 |
| 业务契约、纯规则、controller 无展示依赖，环境依赖明确 | 分层测试与本页「环境与依赖注入」；React 订阅在 bindings |
| 按钮、命令与 suite 能力 / 范围一致 | `collectionMutationCapabilities`、`collectionSurface`、`directorySurface`、`artistSurface` 单测与参数化行为用例 |
| 切 suite 保持会话与队列，布局隔离 | 三组行为探针；真实应用 `libraryRendererSwitch.spec.ts` 的播放引用身份回归；`registry.test.ts` 的布局清理 |
| Grid 视觉、500 / 5000 首性能与有界资源寿命 | `app.screenshot.spec.ts`；`gridEntrancePerf.spec.ts`；`npm run test:render`；资源 registry 与 suite resolver 单测 |
| 同业务新 UI 只新增视图、展示适配与注册 | TUI 与 bravais 的 surface 与 entry；本页新增 suite 步骤；生产构建的 manifest / retained modules 检查 |

账户流程进入 core 的验收入口：

| 条件 | 验证入口 |
| --- | --- |
| suite 不直接调扫码 / 登出接口、不读账户与网易后端 store | `src/library/suites/` 下 rg 无 Omni 扫码 / 登出调用与这两个 store 的引用；`layerBoundaries.test.ts` 钉住 suite 不用 core 的 service、账户服务只经端口 |
| 切换确认由 controller 持有，确认后的清理是宿主端口 | `providerAccountController.test.ts`；`libraryAccountPort.test.ts`；`accountBehavior` 的切换用例 |
| 各套 suite 经登录窗口完成扫码登录（含 QQ 两步）、切换（含确认）、登出 | `accountBehavior.spec.ts` 的参数化用例 |
| 登录进行中切 suite，会话与待确认切换保持 | `accountBehavior` 的 `[switch]` 用例 |
| account surface 整体回退、基础动作缺失时报错 | `test/unit/library/core/librarySuites.test.ts`、`registry.test.ts` |
| 扫码状态机、竞态与选平台规则 | `providerLoginSession.test.ts`、`providerAccountController.test.ts`、`accountRules.test.ts` |
| 登录窗口、网格的切换器、确认框不变 | `accountBehavior` grid 用例；`test/unit/login/` 单测；`app.screenshot.spec.ts` 三张首页基线 |

bravais 的验收入口：

| 条件 | 验证入口 |
| --- | --- |
| home / collection / artist 三个 surface、动作集与 grid 相同（15 / 23 / 10），account 回退到 grid，外观动作文案齐全 | `suites/bravais/entry.ts`；`registry.test.ts`；`commandRegistryContract.test.ts` 与 `suiteChromeCommands.test.ts` |
| 参数化行为用例与切换 suite | 四组 `*Behavior.spec.ts` 的 [bravais] 与 `[switch]`；`libraryRendererSwitch.spec.ts` |
| 每一种返回只翻一次（应用内返回、浏览器后退、折叠往返、跳层） | `libraryNavigation.spec.ts` 的 bravais 用例（`data-bravais-shift` 序列）；`bravaisPanelFold.spec.ts` |
| 选 grid 时不加载 bravais 的 chunk | entry 只静态 import react（`suiteEntries.test.ts`）；生产构建产物检查 |
| 实色档卸载 visualizer，grid / TUI / Lattice 不变 | `bravaisVisualizerMount.spec.ts`；`playerVisualizerMount.test.ts`；`lattice*` 组件用例 |
| 设置弹窗盖着首页时资料库原地留着（grid 与 bravais：同一节点、不重新请求、不重新入场，实色墙下 visualizer 不重挂） | `settingsKeepsLibrary.spec.ts`；`homeSurfacePresentation.test.ts`；`playerVisualizerMount.test.ts` |
| 拖动 / 翻牌 / 聚焦让位的渲染开销有界 | `bravaisPerf.spec.ts`；`npm run test:render` |

开发行为与截图分别验证。正式三张首页截图基线属于 Linux；Windows 上的同机截图比较不能替代 Linux / CI 基线。生产门控应以实际 Web 构建确认，而不是仅依赖 entry 注释：即使构建环境设置 `VITE_LIBRARY_TUI=true`，产物仍不得包含 TUI 组件（含账户层 `LibraryTuiAccount*`）、其键盘 / 焦点实现（含 `useLibraryTuiAccountKeys`）或 `DevLibraryRendererSwitch`；grid 的 `GridAccountSurface` 应在产物里。通用 locale 中保留 TUI 文案不表示其 UI 被加载。
