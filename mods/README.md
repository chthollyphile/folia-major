# Folium 1：Folia 模组平台

> **实验性功能，默认关闭。** 需先在「设置 → 实验室 → 模组系统」中开启，命令面板的「模组」命令与模组
> 管理面板才会出现，加载器也才会扫描目录。开关关闭时**不加载任何模组代码**——不是隐藏 UI，而是已启用
> 的模组也会被停用（执行其 deactivate），相关 IPC 一律拒绝。开关本身不替代单个模组的启用确认。

Folium 是 Folia 的模组平台，形状参照 Minecraft Forge：模组通过**注册表**往宿主里加东西，
通过**事件总线**介入宿主行为，通过**服务**调用宿主能力；确实要碰宿主内部时，走一个明确标注、
钉死宿主版本的 **internals** 通道。

本文件就是 Folium 1 的规范。「稳定」的部分在 folium 1.x 内只增不改（见[版本与演进](#版本与演进)）；
标了「实验」的部分需要在清单里显式选用，任何 minor 都可能变。

> **模组开发与上架注意事项**
>
> - Folium 1.3 是首个稳定版本，稳定扩展接口目前只有 UI 相关部分，1.4 起的歌词原文解析（`folium.lyrics.parse` 与 `getLyrics` 的返回形状），以及 1.5 起的播放控制补全（音量、静音、循环模式、播放队列）、首页页面（`homeTabs`）、播放失败通知（`playback.failed`）与 main 入口的文件目录（`api.storage.paths`）。其他部分，尤其是 `omni.providers` 等 Omni provider 接口，仍属实验接口，尚不具备应用内置 Omni provider 的对等能力。在 Folium v2 发布前，请绝对不要尝试制作超出当前实验接口能力的完整音源模组；接口缺口必然导致问题，浪费开发者和维护者的时间。
> - 任何尝试导出 provider 的原始音频流或解密之后的原始音频文件的模组，都有极高的平台法律风险。无论采用何种实现方式，此类模组都不会上架官方模组市场。

公开类型全部在 [`src/mods/folium/contract.ts`](../src/mods/folium/contract.ts)，这是契约的唯一来源。
仓库里的样例模组都是按本规范写的，可以直接照抄：

| 样例 | 演示 |
| --- | --- |
| `sample-aurora-visualizer` | 歌词动画模式（visualizers），纯 client |
| `visualizer52hz` | 「52Hz」PixiJS 歌词动画：逐字点亮，按节拍沿字形轮廓发出年轮，纯音乐时从随机髓心生长；visualizers + settings + `ctx.audio`（1.2）+ 思索教程（`ponder.targets`，通用骨架 + 双语字幕）+ 模组自带第三方库 |
| `k3panel` | 给内置模式「商籁」调参（tunings），纯 client |
| `sample-transparent-mov-export` | client 注册命令，经 rpc 交给 main 调导出服务 |
| `sample-progress-bar` | 改造进度条：按钮、样式、外部动态数据图层、设置分区、net.fetch、storage |
| `more-progress-buttons` | 进度条两侧加「打乱队列」「音量」「喜爱」按钮，可分别关闭；用 `--folium-player-bar-extra` 把胶囊加宽补回轨道长度（1.3） |
| `sample-rickroll` | 在播放页嵌入外部网页（stageLayers + ui.embed + embedOrigins） |
| `sample-beta-hello` | 先行测试渠道的最小示例：启用后在控制台打印 hello world，用先行测试密钥签名 |

`dev/folium/` 下还有两个 1.5 的示范模组。它们**没有签名**，开发版也**不会自动扫描**这个目录，需要手动安装：
把模组目录打成 zip 拖到模组面板，或复制到用户模组目录（见[从 UI 安装与管理](#从-ui-安装与管理)），装好后显示为「未验证」。

| 样例 | 演示 |
| --- | --- |
| `dev/folium/sample-home-tab` | 首页页面（homeTabs + `ui.openHomeTab`）：双栏页面、输入不触发宿主快捷键、挂载与清理、注销入口后回到原生首页，纯 client、不需要权限 |
| `dev/folium/sample-playback-console` | 首页页面里的播放控制台：音量、静音与循环模式可调，`getQueue` 分页列出队列并用 `playQueueItem` 点播，订阅 `volumeChanged` / `loopModeChanged` / `queueChanged` / `failed`；main 入口把失败记录追加到 `api.storage.paths.data` 下的日志，在 `paths.cache` 放一个可重建的缓存 |

## 安全声明（重要）

模组是**可信代码，不是沙箱**：`main` 入口运行在主进程，拥有完整 Node.js 权限；`client` 入口运行在
主界面所在的渲染进程，能读写界面里的一切。`mod.json` 的 `permissions` 是功能开关约定（未声明的 API
调用 fail closed），**不构成安全边界**。

- **两道开关**：实验室总开关决定加载器是否工作；总开关开启后，单个模组仍默认禁用，需逐个确认启用。
- **启用需二次确认**：主进程原生确认窗口列出模组 id、安装位置、声明的权限、界面代码入口、选用的实验接口、
  可嵌入的外部网页、是否使用内部接口（及兼容的宿主版本）与内容指纹，默认按钮为「取消」。窗口刻意不在渲染
  进程绘制——那里的弹窗可被模组代码伪造或自动点击。
- **信任绑定到内容**：确认结果与模组目录的内容摘要（sha256）一并保存。任何文件变化都会使摘要失配，
  加载器随即**撤销授权并保持禁用**，需要重新确认。唯一的例外是**未打包的开发版**里、位于仓库 `mods/`
  目录的模组：首次启用仍需确认，之后文件变化会把授权更新到新内容，方便开发调试。安装版不扫描仓库目录，
  用户模组目录（`userData/mods`）与 `resources/mods` 永远没有这项豁免。
- **官方签名只是标识**：带有效官方签名的模组在确认窗口和模组面板里标为「官方认证」，但照样要二次确认，
  启用后也照样拥有完整权限。签名证明的是「Folium 审查过这些字节、之后没被改动」，不是沙箱。见[签名与官方认证](#签名与官方认证)。
- 仅安装并启用可信来源的模组；启用前请审阅它的 `main` 与 `client` 代码。

## 签名与官方认证

官方模组和通过审查的第三方模组发布在 folium-compound 仓库，每个模组目录里带一个 `folium.sig.json`：
用 Folium 签名私钥（Ed25519）对模组内容做的签名。宿主用内置的公钥校验，结果有四种：

| 状态 | 含义 | 界面 |
| --- | --- | --- |
| 官方认证（verified） | 签名有效，签名后文件没有改动 | 面板里模组名旁的绿色盾牌；确认窗口写明签名密钥 |
| 先行测试（beta） | 签名有效，但签名密钥属于先行测试渠道（`channel: 'beta'`）：只通过了安全审查，不保证功能可用 | 面板里的紫色烧瓶；确认窗口换成先行测试的风险提示，不显示「官方认证」 |
| 未验证（unsigned） | 没有签名文件，即未经 Folium 审查的第三方模组 | 展开后注明「未验证」；确认窗口保留完整风险提示 |
| 签名不匹配（invalid） | 有签名文件但校验失败，附原因 | 黄色盾牌；按未验证处理，仍可启用，但会明确警告 |

签名不匹配的原因：`digest-mismatch`（签名后文件被改动，最常见，包括你在本地改了官方模组）、`mod-mismatch`
（签名对应的 id 或版本与 `mod.json` 不符）、`unknown-key` / `revoked-key`（密钥不受信任或已吊销）、
`revoked-mod`（该版本已被官方撤回）、`bad-signature`、`malformed`、`unverifiable`。

**先行测试**：folium-compound 把社区模组分为正式发布和先行测试两个渠道。先行测试模组用单独的密钥
（`folium-beta-2026-1`）签名，定位是「仅通过了安全审查，不保证功能实现的整洁，甚至功能可能完全无法工作」，
主要供社区开发者做创意实验。渠道由签名密钥决定，写在 `trustedKeys.cjs` 里；不认识这把密钥的旧版宿主（Folia 0.7.20 之前）会把
先行测试模组显示为签名不匹配（`unknown-key`）。宿主不认识的渠道值同样按 `unknown-key` 处理，不会退回官方认证。

**签名覆盖什么**（签名摘要 v1，与用于绑定启用确认的内容摘要是两套算法）：

- 模组目录下的所有普通文件，**除了**根目录的 `folium.sig.json` 和任意位置的 `.DS_Store`、`Thumbs.db`、
  `desktop.ini`（文件管理器会自动生成它们，不应让浏览一次目录就破坏签名）。
- 每个文件一行 `<文件的 sha256> <相对路径>\n`，路径用 `/` 分隔并做 NFC 规范化，按码元顺序排序
  （和 `sha256sum` 的输出格式相同，可以手工复现）；整份清单再做一次 sha256。
- 目录里有符号链接或特殊文件时无法签名，也无法校验。
- 被签名的消息是固定格式的几行文本：`folium-signature/1`、`modId=`、`modVersion=`、`digest=`、`keyId=`、
  `signedAt=`。所以改 `mod.json` 里的版本号也会使签名失效，升级版本必须重新签名。

算法实现在 `electron/modSystem/modSignature.cjs`，folium-compound 的签名工具里有一份相同的实现；
两边的单测钉住同一组测试向量，任何一边改了算法都会有一边测试失败。

**密钥**：受信任的公钥与撤回的模组列表在 `electron/modSystem/trustedKeys.cjs`，随宿主版本发布，没有联网
查询；新增、吊销密钥或撤回模组都要发新版才生效。轮换密钥时先发布带新公钥的宿主，再用新密钥签名，最后才把
旧密钥标为 `revoked`（用已吊销密钥做的签名会显示为签名不匹配）。私钥泄露时立即吊销。

本仓库 `mods/` 里的示范模组都已用官方密钥签名（`sample-beta-hello` 用先行测试密钥签名，演示「先行测试」状态），
`sampleMods.test.ts` 会校验它们；改动任何示范模组后都要用 folium-compound 的 `tools/sign.mjs` 重新签名，否则测试失败，开发时面板里也会显示「签名不匹配」。

**第三方模组作者**不需要做任何事：不带签名的模组照常可以安装和启用，只是显示为「未验证」。想获得官方认证，
就把模组提交到 folium-compound，审查通过后由维护者签名。

## 目录结构

```
mods/
  your-mod-id/            # 目录名任意，模组身份以 mod.json 的 id 为准
    mod.json              # 必填：清单
    index.cjs             # 可选：main 入口（Node）
    client.mjs            # 可选：client 入口（渲染端 ESM），可以 import 同目录下的其它 .mjs/.js
```

`mod.json` 也可以放在模组目录下唯一的子文件夹里（`mods/your-mod-1.0.0/your-mod-id/mod.json`），规则与 zip 安装相同。
手动解压下载的 zip 常会多出这一层，不需要再挪出来。

client 只能用相对路径 import 模组目录里的 `.mjs/.js`，**不能 import 裸模块名**（`'pixi.js'`），也拿不到宿主
打包进去的库。要用第三方库就把它的 ESM 构建放进模组目录（例如 `vendor/pixi.min.mjs`，附上许可证），
再相对 import，见 `visualizer52hz`。

扫描顺序见 `electron/modSystem/modSystem.cjs` 的 `getModsDirectories`：开发版先扫仓库 `mods/`，
再是 `userData/mods`、`resources/mods`；**同 id 只认先扫到的那一份**。改了文件却没生效时，先确认
`userData/mods` 下没有同 id 的旧副本。

## 清单（mod.json）

清单只放元数据，内容一律在代码里注册。

```json
{
  "folium": 1,
  "id": "your-mod-id",
  "name": "显示名称",
  "version": "1.0.0",
  "author": "可选",
  "description": "可选",
  "main": "index.cjs",
  "client": "client.mjs",
  "preview": "preview.jpg",
  "depends": ["base-mod", "other@^1.2.0"],
  "permissions": ["net.fetch"],
  "embedOrigins": ["https://www.youtube-nocookie.com"],
  "experimental": ["omni.providers"],
  "folia": ">=0.7.0 <0.8.0"
}
```

| 字段 | 说明 |
| --- | --- |
| `folium` | 必须是 `1`。旧草案的 `apiVersion` / `entry` / `visualizers` 字段会被直接拒绝并提示迁移方式 |
| `id` | `^[a-z0-9][a-z0-9-]*$`，全局唯一 |
| `version` | `MAJOR.MINOR.PATCH` |
| `main` / `client` | 都可选，至少一个。`main` 是模组目录下的单个 `.cjs/.js` 文件；`client` 是目录内的 `.mjs/.js` 相对路径。纯渲染端模组不写 `main`，Node 里就不执行它的任何代码 |
| `preview` | 可选。模组目录里的一张介绍图片（`.png` / `.jpg` / `.webp`），模组市场在卡片顶部以 16:9 展示；宿主只校验路径与扩展名。提交到 folium-compound 的模组必须提供，推荐 1280×720、不超过 1 MB |
| `depends` | 模组 id 或 `id@^1.2.3`（仅支持 `^` 与 `*`）。缺失、版本不符、成环或依赖未启用时，只有该依赖子图不加载 |
| `permissions` | 见下表。未知权限直接拒绝 |
| `embedOrigins` | `folium.ui.embed` 可以加载的 https origin（形如 `https://host[:port]`），需要 `net.embed` |
| `experimental` | 选用的实验接口：`omni.providers`、`omni.hooks`、`ponder.targets`、`player.layout`、`remote.actions`、`playback.sessions` |
| `folia` | 宿主版本范围（空格分隔的比较式，支持 `>= > <= < = ^` 与 `*`）。**使用 `folium.internals` 时必填**；宿主版本不在范围内时加载器拒绝加载（`host-version-mismatch`） |

| 权限 | 解锁 |
| --- | --- |
| `filesystem.data` | `api.storage.data.*`（main）与 `folium.storage.*`（client），两边共用一个数据文件；1.5 起还有 main 入口的文件目录 `api.storage.paths`（`data` / `cache`） |
| `runtime.playback` | `api.runtime.getPlaybackSnapshot()`（main） |
| `render.export` | `api.render.exportVideo()`（main） |
| `playback.control` | `folium.playback` 的播放、暂停、跳转、切歌、入队、打乱队列、喜爱；1.5 起还有设置音量、静音、循环模式与点播队列里的歌 |
| `net.fetch` | `folium.net.fetch()`（经主进程代发，不受 CORS 限制） |
| `net.embed` | `folium.ui.embed()`，还需要 `embedOrigins` |
| `ui.stage` | `registries.stageLayers`（往播放页上画东西） |

## client 入口

```js
// client.mjs
export default function activate(folium) {
  folium.registries.visualizers.register({ id: 'my-mode', label: { 'zh-CN': '我的模式', en: 'My mode' }, mount });
  folium.events.on('playback.songChanged', (event) => { /* … */ });
  return () => { /* 可选：清理自己开的定时器等 */ };
}
```

- 启用并确认后，宿主从 `folia-mod://<id>/<client>?v=<指纹>` 导入它；指纹变了就是新模块，改完代码重载即生效。
- **自动回收**：模组被禁用、重载或卸载时，宿主先调它返回的 disposer，再撤下它注册的所有条目与事件处理器。
- **错误隔离**：activate、每个事件处理器、每次 mount 都在各自的错误边界里；出错只影响这个模组，
  错误列在模组面板里该模组的「界面代码出错」下。
- **运行环境**：`folium.env.context` 是 `'main'`（主窗口）或 `'export'`（透明视频导出窗口）。导出窗口里
  只属于界面的注册表（commands、stageLayers、playerPanelTabs、homeTabs、controlButtons、progressLayers、styles）
  是空实现——照常调用、不生效，所以同一份代码两边都能跑；服务（playback / ui / net / storage / rpc）
  在导出窗口里调用会抛 `*-unavailable-in-export-context`（`ui.icon` 例外，两边都能用）。
- `folium.host`：`{ folium: { major, minor }, folia: '<宿主版本>' }`，用于运行时的功能探测。

### folium 对象一览

| 成员 | 说明 |
| --- | --- |
| `modId` / `host` / `env` / `log` | 基本信息与日志（`log.error` 会记到模组面板） |
| `registries.*` | 见[注册表](#注册表) |
| `events.on(type, handler, { priority })` | 见[事件](#事件)，返回取消函数 |
| `playback` / `ui` / `net` | 见[服务](#服务) |
| `storage.get/set/has/delete/keys` | 异步；需 `filesystem.data`；单模组数据上限 1 MB。更大的内容由 main 入口写成文件，放进 `api.storage.paths.data`（1.5） |
| `rpc.call(name, ...args)` | 调用本模组 main 侧 `api.rpc.handle(name, fn)` 注册的函数；参数与返回值需可 JSON 序列化 |
| `lyrics` / `theme`（1.3） | 内置模式共用的函数，见[歌词与主题](#歌词与主题13)；导出窗口里也能用。`lyrics.parse`（1.4）把歌词原文交给宿主解析 |
| `experimental[name]` | 选用了才能访问，否则抛 `experimental-not-declared:<name>` |
| `internals` | 见 [internals](#internals自由度出口) |

## 注册表

所有注册表同一种用法：`register(def)` 返回 `{ id, unregister() }`。`def.id` 是 `^[a-z0-9][a-z0-9-]*$`，
宿主加上命名空间成为 `<modid>:<id>`（类似 Forge 的 ResourceLocation）；同一模组内重复 id 被拒绝。

| 注册表 | 用途 | 稳定性 |
| --- | --- | --- |
| `visualizers` | 歌词动画模式 | 稳定 |
| `tunings` | 给声明了 Folium 可调键的内置模式调参 | 稳定 |
| `backgrounds` | 背景类型（出现在背景选择器，预览与导出同样生效） | 稳定 |
| `stageLayers` | 播放页图层（需 `ui.stage`） | 稳定 |
| `settingsSections` | 模组自己的设置，显示在模组面板里该模组展开后的区域 | 稳定 |
| `commands` | 命令：出现在模组面板与命令面板 | 稳定 |
| `playerPanelTabs` | 播放器面板的标签页 | 稳定 |
| `homeTabs` | Grid 与 Bravais 首页导航里的完整页面（1.5） | 稳定 |
| `controlButtons` | 进度条左右的按钮（`progress.leading` / `progress.trailing`） | 稳定 |
| `progressLayers` | 叠在进度条轨道上的图层 | 稳定 |
| `styles` | 模组 CSS，只针对公开 part | 稳定 |
| `experimental['omni.providers']` | 在线音乐源 | 实验 |
| `experimental['ponder.targets']` | 思索（应用内教程）目标 | 实验 |
| `FoliumStageContext.getLayout()` | 播放页只读布局快照（需选用 `player.layout`） | 实验 |
| `experimental['remote.actions']` | 在独立遥控窗口末尾追加宿主绘制的按钮 | 实验 |

### 宿主托管容器

界面类条目都是 `mount(container, ctx) => dispose?`：宿主创建容器（面板、首页页面、图层、按钮放在 **ShadowRoot**
里，样式互不泄漏），通过继承的 CSS 变量传主题色：`--folium-bg`、`--folium-primary`、`--folium-secondary`、
`--folium-accent`、`--folium-font`；移除容器时调用 dispose。**模组不查询、不修改容器以外的宿主 DOM**，
也不需要轮询——生命周期全部由宿主管。

容器外层（1.2 起）带三个属性，供思索的 `hoverSelector` 和 `dom` 锚点定位某一个条目：
`data-folium-owner`（模组 id）、`data-folium-kind`（`visualizer`、`visualizer-settings`、`background`、
`background-settings`、`stage-layer`、`panel-tab`、`home-tab`（1.5）、`control-button`、`progress-layer`、`settings-section`、
`tuning`）、`data-folium-entry`（带命名空间的条目 id，如 `visualizer52hz:rings`）。ShadowRoot 里面的元素
选择器够不到，只能指到这个外层容器。

### 参数 schema（FoliumParam）

设置分区、visualizer / background 设置、tunings、命令参数共用一种字段声明：

```js
{ key: 'size', type: 'number', label: { 'zh-CN': '大小', en: 'Size' }, min: 0, max: 10, step: 0.5,
  defaultValue: 4, description: { en: 'tooltip' }, group: { en: 'Layout' } }
```

- `type`：`number`（滑块）/ `text` / `boolean` / `select`（需 `options: [{ value, label }]`）。
- `group` 相同的字段放在同一个小标题下。没写 `step` 的数值：上下界都是整数按 1，否则按 0.01。
- schema 是值的唯一来源：读到的值**已合并默认值**，写入时按 schema 校验（未知键丢弃、数值夹到范围内、
  select 必须是声明过的选项）；非法字段声明（重复 key、未知类型、非数值默认值……）会被丢弃。
- 值持久化在宿主，并随「视觉配置」导入导出一起走，也会带进导出窗口。

### visualizers

```js
folium.registries.visualizers.register({
  id: 'aurora-text',
  label: { 'zh-CN': '虹光', en: 'Aurora' },
  order: 420,
  mount(container, ctx) { /* … */ return () => { /* dispose */ }; },
  settings: [/* FoliumParam[]，可选 */],
  settingsPanel(container, panelCtx) { /* 可选：自绘设置面板，值仍按 settings 存 */ },
  hostLayers: { background: true, subtitles: true },   // 缺省都是 true
});
```

模式 id 是 `mod:<modid>:<id>`。`mount` 拿到的 `FoliumStageContext`：

| 成员 | 说明 |
| --- | --- |
| `lines` / `song` / `staticMode` / `staticLineIndex` | 本次挂载内不变的快照；`lines` 的结构见[歌词与主题](#歌词与主题13) |
| `seed`（1.3） | 内置模式用的几何种子（当前歌曲 id，没有时是按模式的回退值），预览、播放、导出一致；拿它做种子，随机结果与内置模式同步变化 |
| `isPreview`（1.3） | 是否在设置预览里渲染 |
| `currentTime.get()` / `.on('change', cb)` | 歌词时钟 |
| `getLineIndex()` / `isPaused()` / `getTheme()` / `getSettings()` / `getSurface()` | 随时读取，每帧读也没问题 |
| `getSubtitleTheme()` / `getCoverUrl()` / `getDisplay()`（1.3） | 字幕主题（没有单独的字幕主题时等于 `getTheme()`）、封面地址、显示设置。`getDisplay()` 的字段与内置模式收到的同名 prop 一致：`showText`、`lyricsFontScale`、`subtitleFontScale`、`subtitleOverlayOpacity`、`subtitleOverlayBackground`、`subtitleUpcomingLyricsBlur`、`showHarmonySubtitle`、`harmonySubtitleBackground`、`showSubtitleTranslation`、`hideTranslationSubtitle`、`subtitleContentMode`、`isPlayerChromeHidden`、`isPanelOpen`、`visualizerOpacity`；值不变时返回同一个对象 |
| `getLayout()`（实验） | 选用了 `player.layout` 时读取播放页布局与安全边距；未选用、预览、OBS 或导出中返回 `null`，见 [player.layout](#playerlayout实验只读) |
| `subscribe(cb)` | 行号、暂停、主题、字幕主题、封面、显示设置、模组设置、表面任一变化时回调；选用了 `player.layout` 时也通知布局变化（暂停时时钟不走，靠它得知变化） |
| `audio`（1.2） | 音频分析：`getPower()`、`getBands()`（`bass` / `lowMid` / `mid` / `vocal` / `treble`）都是 0..1；`getSpectrum()` 是原始 FFT 幅值（0–255）或 `null`。每帧都在变且不通知，在自己的帧循环里读；`getBands()` 每次返回同一个对象、原地刷新，要保留读数就复制。预览里是宿主生成的模拟信号，静音或没有分析器时读到 0 |

- **只在歌词数据、歌曲、`staticMode` 或静态预览行变化时重挂载**；换行不会重挂载，行号从 `getLineIndex()` 读。
- `hostLayers.background`：宿主在你下面画用户选的背景；`getSurface().hostBackground` 为真时，画满整屏且不透明
  的模组应自己让位。`hostLayers.subtitles`：宿主在上面画底部字幕（翻译 / 下一句），走用户的字幕设置。
- `settingsPanel` 必须配合 `settings`：它只替换「画法」，键、默认值和校验仍由 schema 决定，面板通过
  `panelCtx.params`（`get / set / reset / subscribe`）读写。
- 用户的全局歌词字号是 `getDisplay().lyricsFontScale`，内置模式都乘上它；模组关掉 `hostLayers.subtitles`
  自己画字幕时，字幕相关设置也从 `getDisplay()` 读。
- 舞台图层（stageLayers）拿到同一种上下文：显示设置读自播放页正在用的设置，`seed` 是当前歌曲 id；
  `getSubtitleTheme()` 等于 `getTheme()`，`hideTranslationSubtitle` 恒为 `false`。

### 歌词与主题（1.3）

模组拿到的歌词行和主题与内置 visualizer 收到的 `Line` / `Theme` **同名同义**，内置模式的写法可以直接照搬。
它们仍是宿主投影出的冻结副本，不是宿主对象本身。

`FoliumLine`：

| 字段 | 说明 |
| --- | --- |
| `fullText` / `startTime` / `endTime` | 整行文字与歌词本身的起止时间。**`endTime` 是歌词原始结束时间**，这一行何时离开屏幕看 `renderHints.renderEndTime`（或 `folium.lyrics.getLineRenderEndTime(line)`） |
| `words` | `{ text, startTime, endTime, syllables? }[]`；`syllables` 是音节（`{ text, startTime, endTime, endsWithSpace?, ruby?, obscene?, emptyBeat? }`，`ruby` 是注音） |
| `renderHints` | 总是存在：`{ rawDuration, timingClass, renderEndTime, lineTransitionMode, wordRevealMode }`，内置模式用它决定短句、极短句的入场、逐字揭示与离场节奏 |
| `translation` / `romanization` / `alternateTexts` | 翻译、罗马音；`alternateTexts` 是带语言与角色的多份替代文本 |
| `id` / `agentId` / `songPart` / `blockIndex` | 行 id、演唱者、段落名（如 `Chorus`）、段落序号 |
| `isChorus` / `chorusEffect` | 副歌标记与副歌效果（`bars` / `circles` / `beams`） |
| `backgroundVocals` | 和声，结构同一行（`text`、时间、`words`、`agentId`、翻译……）。宿主旧的单数 `backgroundVocal` 已并入这里 |
| `wordSegments` | 用户保存的分词，`join('')` 等于 `fullText`；分词用 `folium.lyrics.segmentWords(line)`，它和内置模式一样优先用这份 |

没有的可选字段直接不出现。用户保存分词后歌词会换成新数组，visualizer 随之重挂载，和内置模式重新排版的时机一致。

`FoliumTheme`：`name`、`backgroundColor`、`primaryColor`、`accentColor`、`secondaryColor`、`fontStyle`（`sans` / `serif` / `mono`）、
`fontFamily?`（用户选的字体名，**不是**可直接用的 CSS 值）、`fontFamilyStack?`、`fontWeight?`、`animationIntensity`
（`calm` / `normal` / `chaotic`）、`wordColors?`（关键词配色 `{ word, color }[]`）、`lyricsIcons?`、`provider?`、`description?`，
再加上 Folium 唯一的附加字段 `isDaylight`（内置模式把它作为单独的 prop 收到）。

`folium.lyrics` / `folium.theme` 就是内置模式调用的那几个宿主函数：

| 函数 | 说明 |
| --- | --- |
| `lyrics.getLineRenderEndTime(line)` | 行离开屏幕的时间 |
| `lyrics.segmentWords(line)` | `{ segment, index, isWordLike }[]`：有效的用户分词优先，否则 `Intl.Segmenter` |
| `lyrics.getUpcomingLine(lines, index, time)` / `getUpcomingLines(lines, index, count = 2)` | 下一句 / 后几句 |
| `lyrics.getRecentCompletedLine(lines, index, time)` | 没有当前行时（`index` 为 -1）最近唱完的一句，字幕在间隙里继续显示它 |
| `lyrics.buildWordColorRanges(fullText, wordColors)` | 关键词配色区间 `{ startOffset, endOffset, color, priority }[]`（UTF-16 偏移，互不重叠） |
| `lyrics.resolveWordColor(wordText, wordColors, fallback, { cjkMatchMode })` | 单个词的关键词颜色 |
| `lyrics.parse(track)`（1.4） | 异步。按本地歌词文件的流程解析[歌词原文](#歌词原文14)，得到 `{ lines, isWordByWord }` |
| `theme.resolveFontStack(theme)` / `resolveTranslationFontStack(theme)` | 歌词 / 翻译字幕的 CSS `font-family` 值 |
| `theme.resolveFontWeight(theme, fallback)` | 规范化后的字重 |

#### 歌词原文（1.4）

`lyrics.parse(track)` 和 `omni.providers` 的 `getLyrics` 都收 `FoliumLyricsTrack`：`{ format, text, translationText?, romanizationText? }`，
宿主按本地歌词文件的流程解析，解析器在 worker 里运行。

- `format` 取 `lrc`、`enhanced-lrc`、`yrc`、`qrc`、`krc`、`ttml`、`vtt`、`awlrc`。
  - 宿主不嗅探格式：带 `<mm:ss.xx>` 逐字标记的 LRC 要写成 `enhanced-lrc`，写成 `lrc` 会把标记当成歌词文字。
  - 和本地文件一样有两个例外：Folia 导出的 `.fia` 文档和带 `[awlrc:…]` 容器的 LRC，总是按内容读取。
- **只接受上面列出的格式。** 平台私有的 JSON、SRT、ASS 或自定义的逐字格式，宿主一律不认，
  音源模组必须先自己整理成其中一种再交出来：
  - 有逐字时间时，优先转成 TTML，它能表达逐字、翻译、罗马音、背景人声和对唱；结构简单的也可以用 YRC 或 `enhanced-lrc`。
  - 只有逐行时间时，转成 LRC。
  - 时间轴需要偏移时（例如视频源和母带不同步），在转换时一并改好。宿主不提供偏移。
- **`format` 必须和内容一致，宿主不检查。** 标错格式或写坏的文本有两种结果：
  - 解析不出任何一行：逐字轨退回 `main`，`main` 也不行就当作没有歌词。
  - 解析出错乱的行，宿主照样显示。
  - 开发时用 `folium.lyrics.parse` 检查转换结果，它和 `getLyrics` 走同一条解析流程。
- QRC、KRC 只收**解密后的明文**，宿主不负责解密。
- `translationText` / `romanizationText` 的对齐规则：
  - 和本地 `.t.lrc` 一样，按开始时间与正文对齐；`vtt` 轨道用 VTT cue。
  - TTML 忽略这两项：翻译、罗马音、背景人声、对唱和 `songPart` 都从 TTML 内联读取。
- 每段文本最多 1,048,576 个字符。以下轨道无效：格式不在列表里、`text` 为空、文本超长。
  - `parse` 遇到无效轨道时抛 `TypeError('invalid-lyrics-track: …')`。
  - `getLyrics` 遇到无效轨道时忽略它，并在控制台警告。
- `parse` 的返回值：
  - `lines` 是冻结的 `FoliumLine[]`，不套用户的歌词显示过滤。
  - `isWordByWord` 表示时间来自真实的逐字标记，而不是宿主按行估算的。

`mount` 定义在模块顶层时拿不到 `folium`，在注册时包一层：`mount: (container, ctx) => mountMine(folium, container, ctx)`，
见 `sample-aurora-visualizer`。

### tunings

内置模式在 registry 里声明 `foliumTunables`（键 → `{ min, max, identity }`），这些键名就是公开 API。
目前只有「商籁」（`sonnet`）声明了 11 个倍率键（`cameraScale`、`motionScale`、`breathScale`、`parallaxScale`、
`mgSwimScale`、`driftScale`、`caScale`、`ghostScale`、`transitionMotionScale`、`transitionBlurScale`、
`transitionGlitchScale`，范围 0~3，恒等值 1）。

```js
folium.registries.tunings.register({ id: 'deep', target: 'sonnet', label: {…}, params: [{ key: 'cameraScale', type: 'number', min: 0, max: 3 }] });
```

只接受目标声明过的数值键，范围取两者交集；**同一目标的同一个键只归一个模组**，后注册的冲突项被丢弃并报告。
卡片出现在目标模式的设置卡片下面，值持久化并进入导出。

### backgrounds

`mount(container, ctx: FoliumBackgroundContext)`，没有歌词和时钟：`staticMode`、`isPaused()`、`getTheme()`、
`getSettings()`、`getCoverUrl()`、`subscribe()`，以及 1.2 起的 `audio`（同上）。可带 `settings` / `settingsPanel`。
透明表面（OBS、透明导出）下宿主不渲染背景。

### stageLayers（需 `ui.stage`）

```js
folium.registries.stageLayers.register({ id: 'video', slot: 'player.stage.back', interactive: false, mount });
```

| slot | 位置 |
| --- | --- |
| `player.stage.back` | 背景之上、歌词之下 |
| `player.stage.front` | 歌词之上、播放器控件之下 |
| `app.overlay` | 整个应用最上层 |

只在真实播放页渲染（预览、OBS、导出窗口里没有）。默认**不拦截指针**：要点击的元素自己设 `pointer-events: auto`；
`interactive: true` 则整层接管指针。ctx 同 visualizer 的 `FoliumStageContext`。

### settingsSections

```js
const section = folium.registries.settingsSections.register({ id: 'prefs', label: {…}, description: {…}, settings: [...] });
section.params.get();            // 当前值（已合并默认值）
section.params.subscribe(fn);    // 值变化时回调
```

显示在模组面板里：展开该模组即可看到，位于它的命令卡片上方。导出窗口里同样可用（只读值）。

### commands

```js
folium.registries.commands.register({ id: 'toggle', label: {…}, description: {…}, keywords: ['…'], params: [...], run: async ({ values }) => result });
```

出现在模组面板（带参数表单）与命令面板：无参数的命令直接执行；有参数的打开表单。`run` 在渲染端执行，
需要 Node 的工作请经 `folium.rpc` 交给 main。返回值会作为结果摘要显示（字符串、`{ outputPath }` 或 `{ message }`）。

### playerPanelTabs

`mount(container, ctx: FoliumPanelContext)`；标签用拼图图标，标题取 `label`。`folium.ui.openPlayerPanel('<id>')`
可以直接打开它。模组停用时若正开着它，面板回到封面页。

### homeTabs（1.5）

```js
folium.registries.homeTabs.register({
  id: 'console',
  label: { 'zh-CN': '播放控制台', en: 'Playback console' },
  order: 300,
  mount(container, ctx) { /* … */ return () => { /* 离开页面时清理 */ }; },
});
folium.ui.openHomeTab('console');
```

- 入口接在 Grid 与 Bravais 首页导航的原生页签后面，原生页签的顺序不变；模组页面之间按 `order`（缺省 500）排，同值按 id。
  TUI 首页没有入口，但 `openHomeTab` 打开的页面同样会盖在它上面。
- 选中后宿主盖上一整页：顶部是宿主的页头（返回按钮、原生页签和模组页签），下面是模组的容器，在 ShadowRoot 里、大小确定。
  页头让出自绘标题栏的 32px 拖拽区，整块可点。原生首页保持挂载但不可交互，返回后页签和状态都还在。
  页面开着时主动打开集合（搜索结果、播放页面板里点专辑或歌手等）会先关闭页面。
- `ctx` 与 playerPanelTabs 相同（[`FoliumPanelContext`](../docs/folium/api.md#foliumpanelcontext)）；换界面语言时以新的 `ctx.locale` 重新挂载。
- 离开页面时调用 mount 返回的清理函数。首页整个藏起（切到播放页）时页面也卸载，回到首页时它仍开着，重新挂载。
  注销显示中的入口、停用模组，都会立刻回到原生首页。
- `openHomeTab(id)` 先切到首页再打开页面，只接受本模组已注册的本地 id，否则抛 `home-tab-not-registered:<id>`。
  导出窗口里注册是空操作，`openHomeTab` 抛 `ui-unavailable-in-export-context`。
- 页面开着时，页面里的按键不会触发宿主的全局快捷键（直接输入搜索、切页签等），只有 Ctrl+K（macOS 为 Cmd+K）放行给命令面板；
  Bravais 下的 F6 / Shift+F6 由宿主接着切换首页页签。打开页面时不抢设置、命令面板等窗口的焦点。
  键盘焦点的细节（Tab 绕回、F6、焦点归还）见 [首页页面](../docs/folium/home-tabs.md)。

### controlButtons 与 progressLayers

两者共用 `FoliumProgressContext`：`currentTime`、`getDuration()`、`timeToRatio(t)`、`seek(t)`、
`getColors()`（宿主进度条的颜色）、`subscribe()`（时长或颜色变化）。三处进度条（悬浮控件两处、Lattice）
都渲染同一个宿主组件，所以扩展会同时出现在三处。

- `controlButtons`：`slot` 为 `progress.leading` 或 `progress.trailing`，容器按内容大小排布。
  `hideWhenCollapsed: true`（Folium 1.3）让按钮不出现在收起状态的悬浮胶囊里，只在展开的胶囊和 Lattice 显示；
  收起的胶囊很窄，按钮多了会把进度条挤短。
- `progressLayers`：容器铺满轨道且**不拦截指针**，拖动进度照常可用；标记等需要点击的元素自己设 `pointer-events: auto`。
- 两者容器里的点击由宿主拦在容器内，不会冒泡到外层（悬浮控件的胶囊点击会跳到播放页），模组不需要自己 `stopPropagation()`。

### styles 与公开 part

```js
folium.registries.styles.register({ id: 'look', css: '[data-folium-part="progress.fill"] { background: linear-gradient(90deg, #8b5cf6, #22c55e); }' });
```

CSS 放进 `@layer folium-mods`（在 Tailwind 各层之后声明），不用 `!important` 就能覆盖宿主样式；模组撤下时样式同时撤下。
**稳定的目标只有公开 part**；宿主元素上的其它 class 与结构都不是 API。

| part | 元素 |
| --- | --- |
| `progress.root` | 整条进度条（颜色变量 `--folium-progress-fill / -track / -text` 定义在这里） |
| `progress.track` | 轨道 |
| `progress.fill` | 已播放部分 |
| `progress.thumb` | 滑块（默认 `opacity: 0`，样式里设为可见即出现） |
| `progress.time` / `progress.duration` | 当前时间 / 总时长 |

**公开变量**（1.3）：`--folium-player-bar-extra`（长度，默认 `0px`）把悬浮胶囊加宽这么多，展开和收起两种状态都生效，
超出视口时截止。用来补回在进度条两侧加按钮后被压短的轨道：
`folium.registries.styles.register({ id: 'wider', css: ':root { --folium-player-bar-extra: 56px; }' })`。
这个变量只有一个值，几个模组同时设置时后注册的生效。

## 事件

`folium.events.on(type, handler, { priority })`，优先级 `highest / high / normal / low / lowest`，同级按注册顺序。
每个处理器单独隔离错误；同步处理器超过 16ms 会记警告。

**通知**（只读、冻结、事后发出）：

| 事件 | 载荷 |
| --- | --- |
| `playback.songChanged` | `{ song }` |
| `playback.stateChanged` | `{ state: 'playing' \| 'paused' \| 'stopped' }` |
| `playback.seeked` | `{ position }` |
| `lyrics.loaded` | `{ song, lines }` |
| `app.viewChanged` | `{ view }` |
| `visualizer.modeChanged` | `{ mode }` |
| `theme.changed` | `{ theme }` |
| `playback.likeChanged`（1.3） | `{ liked }`，`getState().liked` 变了（喜爱、取消喜爱，或换到喜爱状态不同的歌） |
| `playback.volumeChanged`（1.5） | `{ volume, muted }`，音量或静音开关变了，不论是谁改的；`volume` 在 0–1 |
| `playback.loopModeChanged`（1.5） | `{ mode }`：`'off'`、`'all'`（列表循环）或 `'one'`（单曲循环） |
| `playback.queueChanged`（1.5） | `{ length, currentIndex }`，队列变了或显示中的歌在队列里换了位置；只是轮廓，歌曲用 `playback.getQueue()` 读。同一个任务里的多次变化合成一次，不按载荷去重（打乱后长度和位置可能都没变） |
| `playback.failed`（1.5） | `{ song, reason, phase, willAutoSkip }`，一首歌放不了，见下 |

**`playback.failed`**（1.5）只在用户看得见「这首歌放不了」时报一次：

- 宿主自己的自动重试（网络错误、超时之后的几次重试）都失败了才报，中间几次不报。恢复上次播放时有备用源静默接管的，不报。
  点歌或恢复还在加载时用户又点了别的歌的，前一首的失败不提示也不报。
- `song` 是放不了的那首（`play` 时是点的那首，其余是当前歌曲），不知道是哪首时为 `null`。
- `phase` 说的是在哪一步失败：
  - `play`：点歌时宿主拿不到能播放的音源（需要登录或会员、已下架、取不到播放地址、本地文件找不到等）。
  - `restore`：启动时恢复上次的播放，同样是拿不到音源。
  - `mid-playback`：播放器在媒体本身上出错（加载不下来、解不了码或中途断流）。媒体出错一律算这一类，所以刚点的或刚恢复的歌
    还没出声就出错，报的也是 `mid-playback`，不是 `play`。
- `reason` 是粗分的五类，宿主自己的原因码不是 API：
  - `auth`：需要登录，或登录已过期。
  - `restricted`：需要会员、需要购买、当前账号没有播放权限、只能试听，或所在地区不能播放。
  - `taken-down`：歌曲已下架。
  - `network`：网络错误、超时、服务暂时不可用或请求太频繁。
  - `unknown`：其它原因，或这条失败路径没有原因码（本地文件、Navidrome、播放器本身的媒体错误）。
- `willAutoSkip` 只代表事件发出那一刻宿主的打算：宿主正在倒计时跳过这首（按它的策略，或用户打开了「无法播放时自动跳过」），
  这时模组不要自己调 `next()`。用户可能在倒计时里点「取消」，所以它为真也不保证真的跳了：取消后宿主按这个原因原本的方式处理
  （例如停播并给出「重试 / 跳过」），不会再报第二次。`restore` 阶段总是 `false`。
- 只在主窗口发出，导出窗口不发。

**钩子**（同一个事件对象依次经过每个处理器，处理器可以改它）：

| 钩子 | 说明 |
| --- | --- |
| `lyrics.transform`（同步） | 新歌词进入播放页之前。给 `event.lines` 赋新数组即可改写；**原样保留的行对象**保留宿主的全部数据，新建或修改的行按 `FoliumLine` 的字段逐个校验后重建：`renderHints` 一律由宿主按新时间重算，不采用处理器给的值；和 `fullText` 拼不回去的 `wordSegments` 被丢弃。输入总是未改写的歌词，不会叠加到自己的输出上：宿主重建已显示的歌词（例如分词更新）时从未改写的版本重新跑一遍，处理器不需要幂等 |
| `playback.beforePlay`（异步） | 任何歌曲开始播放之前。`event.cancel()` 取消；`event.replaceWith(song)` 换歌（song 必须带宿主给的 `ref`）。单个处理器超过 1.5s 被跳过。automix 过渡自动切到的下一首不经过它：过渡按固定时间表提前数秒启动下一首，不能等处理器 |
| `omni.lyricsResolved` / `omni.audioSourceResolved`（异步，**实验**，需 `omni.hooks`） | Omni 拿到在线歌曲的歌词 / 音频地址之后，可改写行或给 `event.url` 赋新地址 |

## 服务

**`folium.playback`**：`getState()` 返回 `{ song, state, position, duration, liked, canLike }`；`play / pause / toggle / seek / seekToLyricTime / next / previous`、
`playSong(song)`、`enqueue(song)`、`shuffleQueue()`、`toggleLike()` 需要 `playback.control`。歌曲 DTO 带不透明的 `ref`，宿主靠它找回真正的歌曲。

- `shuffleQueue()`（1.3）打乱播放队列，当前歌曲留在最前；私人 FM、队列只有一首、外部 Stage 播放时不动，返回 `false`。
- `toggleLike()`（1.3）喜爱或取消喜爱正在显示的歌，和宿主的喜爱按钮相同，结果提示也由宿主给出；`canLike` 为 `false` 时
  （没有歌、来源不支持、Stage 播放、播放控制被禁用）不动，返回 `false`。`liked` 的变化见 `playback.likeChanged` 事件。

- `seek(seconds)` 跳到**播放时间**；`seekToLyricTime(seconds)`（1.3）跳到**歌词时间**，也就是内置模式点击歌词行的行为：
  传 `line.startTime` 即可，宿主负责换算歌词偏移、处理只有歌词的舞台源，播放控制被禁用时忽略。歌词有偏移时
  `seek(line.startTime)` 会跳偏，所以点歌词跳转一律用 `seekToLyricTime`。visualizer 容器本身接收指针事件，
  在自己的元素上监听点击即可；在预览里（`ctx.isPreview`）不要触发跳转。

1.5 补全了音量、循环模式和播放队列。读取不需要权限（和 `getState` 一样只要求在主窗口），写入需要 `playback.control`：

- `getVolume()` 返回 `{ volume, muted }`，`volume` 在 0–1，静音开关独立于音量。`setVolume(volume)` 夹到 0–1，和宿主的音量滑块一样，
  不动静音开关；每次调用都会保存，所以只设最终值，不要拿它做渐变。`setMuted(muted)` 是设值而不是切换，两边同时操作不会互相抵消。
  参数不是有限数 / 布尔值时抛错。
- `getLoopMode()` / `setLoopMode(mode)`：`'off' | 'all' | 'one'`。设成新值时宿主像点自己的循环按钮一样弹提示；设成当前值什么都不做；
  未知值抛错。外部 Stage 播放时也能设，循环模式是持久的偏好。
- `getQueue({ offset, limit })` 返回队列的一页 `{ items, length, currentIndex, kind }`：
  - `items` 是 `{ song, index }[]`，`index` 是在整个队列里的位置，队列一变就过期（见 `playback.queueChanged`）。
  - `length` 是整个队列的长度；`currentIndex` 是显示中的歌在队列里第一次出现的位置，不在队列里时为 -1。
  - `kind`：`queue`；`fm`（私人 FM，队列是当前这一批）；`stage`（外部 Stage 播放，队列与正在播放的内容无关）。
  - `limit` 缺省 500，也最多 500，最少 1；不传 `offset` 时这一页以显示中的歌为中心（不在队列里时从头取），传了就夹到 `[0, length]`。
    给了却不是有限数的 `offset` / `limit` 抛错，小数向下取整。
  - 歌曲的 `ref` 和其它歌曲 DTO 共用一个 2000 条的池，最久没被交出去的先失效：刚读到的这一页里每个 `ref` 都有效。
    所以只读要显示的那几页，不要一次读完整个队列。
- `playQueueItem(index, expectedRef?)` 播放队列里的第 `index` 项，播放和跳转与在宿主队列面板里点它相同；没播成时，失败提示里的
  “重试”和“跳过”按按下那一刻的队列走。私人 FM 下宿主面板不列队列，用它点播不退出 FM。
  给了 `expectedRef` 时，那个位置已经不是这首歌（两次调用之间队列变了）就不动、返回 `false`；比较的是同一首歌，宿主开播时把队列项
  换成等值副本，之前拿到的 `ref` 照样认得。越界、外部 Stage 播放、`ref` 已失效时也返回 `false`。`index` 不是整数、没有 `playback.control`
  时返回的 Promise 被拒绝。

**`folium.ui`**：

| 方法 | 说明 |
| --- | --- |
| `toast(message, { type, durationMs })` | 提示条 |
| `openPlayerPanel(tabId?)` | 打开播放器面板，可指定本模组注册的标签 |
| `openHomeTab(tabId)`（1.5） | 切到首页并打开本模组注册的首页页面；没注册的 id 抛 `home-tab-not-registered:<id>`。见 [homeTabs](#hometabs15) |
| `navigate('home' \| 'player')` | 页面导航 |
| `openVolume()`（1.3） | 打开宿主的音量面板（命令面板里的音量命令） |
| `pickFile({ accept: 'video' \| 'audio' \| 'image' \| 'any', persist })` | 原生选择框；返回 `{ url, name, size }` 或 `null`。`url` 是本次会话有效的 `folia-mod://_files/...`，支持 Range，可直接做 `<video>` 的 src。`persist: true`（1.1）时宿主记住这次选择，返回值多一个不透明的 `grantId` |
| `restoreFile(grantId)`（1.1） | 把之前 `persist` 选中的文件换成本次会话的新句柄（含同一个 `grantId`）；授权不属于本模组或文件已不存在时返回 `null`，后者的授权随即作废。模组始终拿不到文件路径 |
| `releaseFile(grantId)`（1.1） | 放弃授权；已经发出的 URL 本次会话内仍然有效 |
| `embed(container, url, { title, allow })` | 在容器里建一个沙箱 iframe；origin 必须在 `embedOrigins` 里，需 `net.embed`。返回移除函数 |
| `icon(name, { size, strokeWidth, color })`（1.2） | 宿主的 lucide 图标，名字与 lucide.dev 一致（如 `play`、`skip-forward`）；异步，得到一个新建的 `<svg>` 元素，归模组所有，未知名字得到 `null`。默认 24px、描边 2、颜色 `currentColor`（跟随周围文字）。导出窗口里也能用。宿主只承诺图标名，图形随宿主的 lucide 版本更新 |

> 持久授权按模组 id 保存（每个模组最多 32 条，超出时丢弃最旧的），要跨重启使用就把 `grantId` 存进 `folium.storage`（需 `filesystem.data`）。
> 1.0 宿主没有 `restoreFile`，用 `typeof folium.ui.restoreFile === 'function'` 或 `folium.host.folium.minor >= 1` 判断。

> 打包版从 `file://` 加载页面，部分站点（例如 YouTube）会因为缺少 Referer 拒绝播放（YouTube 报错 153），
> 页面本身能加载。补 Referer 是后续改进。

**`folium.net.fetch(url, { method, headers, body, timeoutMs })`**：需 `net.fetch`；在主进程发出，只允许 http(s)，
超时默认 15s（最长 60s），响应体上限 5 MB；返回 `{ ok, status, statusText, headers, text(), json() }`。

## main 入口（Node）

```js
// index.cjs
module.exports = function activate(api) {
  api.rpc.handle('export', async (values) => api.render.exportVideo({ codec: 'vp9', width: 1920, height: 1080, fps: 30, background: 'transparent' }));
  api.lifecycle.onDeactivate(() => { /* 释放定时器、子进程… */ });
};
```

| API | 说明 | 稳定性 |
| --- | --- | --- |
| `api.manifest` / `api.host` / `api.log.*` | 冻结的清单、宿主版本、日志 | 稳定 |
| `api.lifecycle.onDeactivate(fn)` | 禁用 / 重载 / 退出前按逆序执行；activate 直接 return 函数等价 | 稳定 |
| `api.rpc.handle(name, fn)` | 供 client 的 `folium.rpc.call` 调用 | 稳定 |
| `api.storage.data.get/set/has/delete/keys` | 异步，需 `filesystem.data`，与 client 的 `folium.storage` 共用数据，上限 1 MB | 稳定 |
| `api.storage.paths.data` / `.cache`（1.5） | 模组自己写文件的目录，见下 | 稳定 |
| `api.runtime.getPlaybackSnapshot()` | 需 `runtime.playback`；返回 `FoliumPlaybackSnapshot` DTO，`position` 在播放中按推送时间外推。1.5 起多了 `volume`（0–1）、`muted`、`loopMode` | 稳定 |
| `api.render.exportVideo(spec)` | 需 `render.export`；spec 只有输出参数 `{ codec: 'vp9' \| 'prores', width, height, fps, startSec, endSec, background: 'transparent' \| 'theme' }`，模式、调参、歌词、主题与 Folium 参数值由宿主按当前状态取 | 稳定 |
| `api.experimental` | 目前为空 | 实验 |

导出上限（3840×2160、60fps、15 分钟、全局互斥）与 ffmpeg 查找顺序属于宿主行为，不属于契约，可能调整。

### 文件目录 api.storage.paths（1.5）

`api.storage.data` 适合设置大小的状态（上限 1 MB）；更大的内容、日志、下载的文件由 main 入口自己写成文件，放在宿主给的两个目录里：

| 路径 | 位置 | 用途 |
| --- | --- | --- |
| `api.storage.paths.data` | `<userData>/mods-data/<id>/files` | 要保留的文件。与 `storage.data` 的数据文件同在 `mods-data/<id>` 下，但不包含它 |
| `api.storage.paths.cache` | `<userData>/mods-cache/<id>` | 可以重建的文件。用户随时可以在模组面板里清空它，模组运行时也一样，所以要预期文件会消失；宿主不限大小，上限自己控制 |

- 两个都是 getter，每次读取都先检查 `filesystem.data`，没有就**同步**抛 `permission-denied:filesystem.data`；然后在目录不存在时创建它，
  返回绝对路径。所以每次用的时候读一次，不要在 activate 里存下字符串就一直用。
- 目录建不出来时 getter 抛文件系统的错误（如 `EEXIST`、`ENOENT`）：比如 `mods-cache/<id>` 的位置上是一个文件，或是目标已经不在的
  链接 / junction。模组面板会把这样的缓存目录标成已损坏，「清空缓存」删掉这个条目后，下次读取就能重新建出目录。
- 两个 getter 不可枚举：`JSON.stringify(api)`、`{ ...api.storage.paths }` 之类遍历属性的写法读不到它们，也就不会抛错或建目录。
- 模组面板的「清空缓存」删除 `cache` 目录里的全部内容（包括子目录），保留目录本身；模组自己在里面建的子目录，用之前要自己再建一次。
- `paths` 对象本身总是在（有没有权限都在），可以用 `'paths' in api.storage` 判断宿主是不是 1.5。
- 路径只用通过校验的清单 `id` 拼出来。client 拿不到路径：它没有文件系统。
- 模组面板显示的「数据」统计整个 `mods-data/<id>`（含 `storage.data` 的数据文件），「缓存」统计 `mods-cache/<id>`，见[从 UI 安装与管理](#从-ui-安装与管理)。

```js
// index.cjs（需要 filesystem.data）
const fs = require('fs');
const path = require('path');

module.exports = function activate(api) {
  api.rpc.handle('appendLog', async (line) => {
    await fs.promises.appendFile(path.join(api.storage.paths.data, 'events.log'), `${line}\n`);
  });
};
```

完整的例子（追加日志、带上限的缓存、缓存被清空后从日志重建）见 `dev/folium/sample-playback-console/index.cjs`。

### 依赖 ffmpeg（导出类模组）

- 查找顺序：`FOLIA_FFMPEG_PATH` 环境变量 → 应用目录下 `ffmpeg-8.1.2/ffmpeg(.exe)` → 打包资源目录下 `ffmpeg/ffmpeg(.exe)` → 系统 PATH。
- 需要**完整** ffmpeg（`rawvideo` demuxer、`prores_ks` 或 `libvpx-vp9`、MOV/WebM 封装）。应用自带的 `ffmpeg-audio/`
  只含 FLAC/WAV 音频转码，不能用于导出。
- 输出目录：`视频/Folia Exports`。透明通道：Windows 完整支持；Linux/macOS 下可能不含 Alpha，返回值里会有警告。

## 实验接口

选用方式：清单 `"experimental": ["omni.providers"]`，然后 `folium.experimental['omni.providers']`。

**`omni.providers`**：注册一个在线音乐源，宿主把它适配成内置 provider 的形状（搜索、播放、歌词）。
provider id 为 `folium.<modid>.<id>`；歌曲的 `mediaId` 就是模组自己的歌曲 id，模组停用后队列里的歌只是暂时不能播放。

```js
folium.experimental['omni.providers'].register({
  id: 'radio', displayName: 'My Radio',
  search: async (query, { limit, offset }) => ({ items: [{ id, title, artists: [...] }], hasMore: false }),
  getAudioUrl: async (song, quality) => ({ url }),
  getLyrics: async (song) => ({
    main: { format: 'lrc', text: lrc, translationText: tlrc },
    wordByWord: { format: 'ttml', text: ttml },
  }),
});
```

`getLyrics` 返回的 `FoliumLyricsResult` 是稳定形状（1.4），`omni.providers` 本身仍是实验接口：

- 两条轨道都是[歌词原文](#歌词原文14)。
  - 有 `wordByWord` 时显示它；它解析失败或解析不出任何一行时，退回 `main`。
  - `wordByWord` 没带翻译、罗马音时，沿用 `main` 的。
- `isPureMusic: true` 时显示纯音乐视图，忽略两条轨道。
- `chorusRanges: [{ startTime, endTime }]` 是歌词时间（秒），落在区间里的行显示副歌效果，最多 64 段。
  - 没给时，宿主按重复的行自动识别。
  - TTML 的 `songPart` 标记优先于这两者。
- 1.3 的 `{ lrc, translationLrc }` 仍然可用，按纯 LRC 解析，和 1.3 完全相同。这个形状从 1.4 起废弃，Folium 2 移除。

注册的音源在界面上可以选为当前音源（1.4）：

- 它出现在首页右下角的音源切换器里，标着「无需登录」，点一下就切过去。和切换内置音源一样，会先确认清空当前在线播放和队列。
  - 切换器、搜索浮层的来源按钮显示 `shortName`，没有时显示 `displayName`；头像是它的首字母。
- 切过去之后，首页搜索框和搜索浮层都搜这个音源。
- 首页的歌单、专辑、电台三个标签禁用，显示「将在 Folium v2 支持」的占位和一个「搜索歌曲」按钮。曲库能力留给 Folium v2 完整的 provider 接口。
- 模组被停用、加载失败或在网页版运行时，已选中的它会回到网易云，并且记住这个结果；重新启用模组后要再切一次。
  这一点和[缺失条目](#缺失条目)里的歌词动画、背景不同，那些选择会保留。

**`omni.hooks`**：`folium.experimental['omni.hooks'].on('lyricsResolved' | 'audioSourceResolved', handler)`，
或者直接 `folium.events.on('omni.…')`（未选用时抛错）。

**`ponder.targets`**：往思索（应用内教程）注册表加目标，定义直接沿用宿主的 `PonderTargetDefinition`
（`src/types/ponder.ts`），id 带 `<modid>:` 前缀。目标是纯数据：场景、骨架框（`anchors`）和时间线（`steps`：
字幕、光标、按键、拖动、高亮、显隐），画面、播放控制、导航页和悬停提示都由宿主渲染，不需要任何外部库。
完整样例见 `visualizer52hz/ponder.mjs`。只在主窗口可用（导出窗口里访问会抛错），注册前先判断
`folium.env.context === 'main'`。

- **文字字段**（目标的 `titleKey` / `summaryKey`、场景的 `titleKey`、`action.labelKey`、骨架框的 `labelKey`、
  字幕的 `textKey`）不填翻译 key，直接写文字，或者按语言写 `{ 'zh-CN': '…', en: '…' }`（1.2），跟随界面语言切换，
  缺的语言按其它模组标签的规则回退。文字里的 `{{mod}}` 会换成当前平台的修饰键（Ctrl / ⌘）。
- **悬停提示**：`hoverSelector` 用上面的容器属性，例如 `[data-folium-entry="mymod:notes"]`。
- **面板骨架**：`role: 'surface'` 的框不写 `surfaceKind` 时画成只有外框的 `plain`（1.2）。也可以借用宿主的
  界面骨架（`player-page`、`side-panel`、`settings-page`……），但它们画的是宿主界面，不是你的。

**限制**：模组画不出自己界面的骨架。`surfaceKind` 只有宿主预置的那些；模组的面板、按钮在 ShadowRoot 里，
`dom` 锚点量不到里面的元素，只能量外层容器，或者用 `synthetic` / `relative` / `derived` 手写位置。

**建议**：别追求把界面画得像。用通用骨架勾出结构——一个 `surface` 面板、几个 `control` 按钮、几条 `rail`
滑轨——再让字幕把意思讲清楚：每一步只讲一件事，用 `pointTo` 把字幕连到它讲的那个框，用 `highlight` 和
`reveal` 标出「现在看这里」。这正是宿主思索的做法：骨架负责「在哪」，文字负责「是什么、为什么」。

### player.layout（实验，只读）

清单声明 `"experimental": ["player.layout"]` 后，通过已有 `mount(container, ctx)` 的
`ctx.getLayout(): FoliumPlayerLayout | null` 读取快照，布局变化并入已有 `ctx.subscribe(listener)` 通知。
此成员仍是 **EXPERIMENTAL (`player.layout`)**，不会提升稳定 Folium 1.5 的版本；
没有单独的 `folium.experimental['player.layout']` 服务。类型定义在 `src/mods/folium/contract.ts` 的 Experimental 段。

- `bounds` 是播放页范围，`insets: { top, right, bottom, left }` 是相对该范围四条边的安全预留像素。
  模组先应用 `insets`，再依据 `obstacles` 逐个做矩形相交判断；局部面板不会把所在整列都变成禁区。
  当前仅自定义标题栏提供顶部 56px 预留（按播放页高度裁剪），其他方向为 0；局部控件由障碍物矩形表达。
- `obstacles` 每项只有粗粒度 `role`、`kind: 'control' | 'reveal-area'`、`rect`，不暴露内部组件 id。
  `role` 可为 `navigation`、`window`、`playback`、`now-playing`、`panel`、`notification` 或其他字符串。
  障碍物**不保证完整，数量、顺序和 role 都不承诺兼容**；同一 role 的多个矩形不能合并为一个大框。
- `FoliumLayoutRect` 是 `{ left, top, width, height }`：坐标为**视口 CSS 像素**，原点在视口左上角，
  与 `getBoundingClientRect()` 一致。`bounds` 和所有障碍物使用同一坐标系，障碍物已裁剪到 `bounds` 内。
  快照深冻结，数值未变时引用不变。
- 清单未选用、非播放页、舞台已卸载、设置预览、OBS 或导出场景返回 `null`。
  无布局订阅或首次测量尚未完成时也返回 `null`；订阅启动测量后会通知新快照。
  静态歌词播放页仍有原生控件，因此仍提供布局。
- 只有选用了 `player.layout` 的模组通过 `ctx.subscribe` 订阅时才测量；单独调用 `getLayout()` 不启动测量。
  动画、滚动、resize 共用 80ms 合并测量，不逐帧更新 React；`ctx.subscribe` 还会通知其他上下文变化，
  可以比较快照引用来跳过无关更新。停用模组自动移除订阅；最后一个布局订阅取消或离开播放页后停止监听/测量。

返回按钮保留完整 **120×120** 的鼠标唤出区域，而不只是按钮点击区域。鼠标在 `app.overlay` 的模组内容
上移动不会穿透并唤出背后的返回按钮，模组应避开这块区域。标题栏预留为**整条宽、56px 高**，
仅在自定义窗口标题栏启用时出现；使用原生窗口边框或浏览器时不预留这一条。

此接口不能修改原生控件、重排、隐藏或替换原生条目，也不提供原生 DOM。
模组自己的完整组件仍挂在已有 `stageLayers` 的 `app.overlay` 槽位（需 `ui.stage`）；
样式与交互由模组负责，通过现有 ShadowRoot 隔离，不增加另一套浮层渲染接口。

```js
export default function activate(folium) {
  if (folium.env.context !== 'main') return;
  folium.registries.stageLayers.register({
    id: 'conversation', slot: 'app.overlay',
    mount(container, ctx) {
      // Mount your component and position only your own nodes from ctx.getLayout().
      const render = () => positionOwnOverlay(container, ctx.getLayout());
      const off = ctx.subscribe(render);
      render();
      return off;
    },
  });
}
```

`dev/folium/player-layout-demo` 提供无账号、无网络、可停用恢复的完整示例。

### remote.actions：独立遥控窗口追加按钮

清单声明 `"experimental": ["remote.actions"]`，在主窗口的 `client` 默认入口注册。
这是 **EXPERIMENTAL (`remote.actions`)**，稳定 Folium 版本保持 1.5。
遥控窗口只接收可序列化的按钮定义，由宿主绘制；模组代码及 `run()` 始终在主窗口执行。

```js
export default function activate(folium) {
  let count = 0;
  const handle = folium.experimental['remote.actions'].register({
    id: 'room-actions', order: 10,
    actions(context) {
      return [{
        id: 'like', label: { 'zh-CN': '房间点赞', en: 'Like in room' },
        icon: 'thumbs-up', count, disabled: !context.song,
        run() { count += 1; handle.invalidate(); },
      }];
    },
  });
  return () => handle.unregister();
}
```

- `actions(context)` 同步返回追加按钮。上下文只有当前显示的 `song: FoliumSong | null` 和
  `state: 'playing' | 'paused' | 'stopped'`。回调应只计算定义，副作用放进按钮的 `run()`。
- 注册项有局部 `id` 和可选 `order`；按钮也有局部 `id`，宿主为其加上模组及注册项前缀。
  `label` 是真正的多语言 `FoliumLabel`，由遥控窗口按自己的语言解析；`icon` 是 Lucide 图标名。
  可选呈现字段为 `disabled`、`pressed`、非负有限数 `count`、`tone: 'normal' | 'alert'`。
- `scope` 缺省为 `track`：按钮对应的显示曲目已变化或当前没有曲目时，旧点击不会执行。
  `session` 允许跨歌执行，适合停止试听等会话动作。两者都检查注册仍有效及最新 `disabled`。
- 状态变化后调用当前注册 handle 的 `invalidate()`，重新计算定义并刷新已打开的遥控窗口。
  它只刷新模组按钮，不改变原生命令，也没有全局 `ui.refreshRemoteControls()`。
  卸载后的旧 handle 不会影响同 id 的新注册；停用模组会自动清理注册及旧点击资格。
- 模组按钮票据在相同注册周期和按钮 id 下稳定，计数、按下态等展示更新不会使第二次连续点击丢失。
  原生播放、切歌、进度条及其他按钮仍直接发送原有命令，不经过模组动作票据。
- 宿主在原生控件末尾绘制追加区域，空间不足时内部滚动；无按钮时不创建额外 DOM。
  颜色、尺寸、图标和焦点样式由宿主统一，计数在悬停或键盘聚焦时显示为圆角标记。
  每模组的最终按钮配额尚未冻结，宿主可限制过大的动作列表，模组应只提供少量必要动作。
- 仅独立 Electron 遥控窗口的播放视图显示这些按钮；录制/透明控制视图及预设弹层中隐藏。
  不提供自由组件、输入框或原生按钮的替换、重排、隐藏、禁用接口，也不授予额外播放权限。

公开类型见 `src/mods/folium/contract.ts` 的 Experimental 段。
离线示例：`dev/folium/sample-remote-actions`，可检查连续点击、键盘操作、状态刷新和停用恢复。

## internals（自由度出口）

`folium.internals` 直接给出宿主内部对象：`React`、`ReactDOMClient`、各 zustand store（`stores.playback` 等）、
`omni` 本体、原始 visualizer 注册表。**没有任何兼容承诺**，任何一个 Folia 版本都可能改。

前提是清单写了 `folia` 版本范围（就像 Forge 模组要钉死 MC 版本），否则访问即抛
`internals-require-folia-range`；确认窗口与模组面板都会标出「使用内部接口」。只在主窗口可用。

如果一个 internals 用法在多个模组里反复出现，说明它该变成稳定的注册表、事件或服务——请提 issue。

## 缺失条目

用户选中了某个模组的歌词动画或背景后，那个模组被停用或卸载时：**已保存的选择不会被改写**，界面先显示默认项，
并提示「来自未运行的模组 X」；模组重新启用后自动恢复。队列里来自模组 provider 的歌同理，只是暂时不能播放。

## 版本与演进

- 清单里的 `folium: 1` 是 major；宿主通过 `folium.host.folium.minor` / `api.host.folium.minor` 暴露 minor。
- 1.x 内只做新增：可选的清单字段、新注册表、新事件、新服务方法、新权限、新参数类型、新公开 part。
- DTO（`contract.ts`）字段只增不减；宿主内部类型不出现在任何稳定契约里。
- 删除或改变语义必须升 major；之前至少有一个 minor 在日志里标记废弃。
- 实验接口可以在任何 minor 变动；稳定下来后原名字保留，`experimental` 里的选用变成空操作。
- 1.3 是 Folium 1 的首个稳定版本，发布时一次性调整了 DTO 形状，让歌词和主题与内置 visualizer 同构：
  `FoliumLine.text` 改名 `fullText`，`endTime` 改为歌词原始结束时间（渲染结束时间移到 `renderHints.renderEndTime`）；
  `FoliumTheme.fontFamily` 改为用户字体名，可直接用的字体栈改由 `folium.theme.resolveFontStack(theme)` 得到，`fontWeight` 变为可选。
- 1.4 新增稳定的歌词原文接口，不依赖 `omni.providers` 也能用：
  - DTO：`FoliumLyricFormat`、`FoliumLyricsTrack`、`FoliumLyricsResult`、`FoliumParsedLyrics`。
  - 方法：`folium.lyrics.parse`。
  - 实验接口 `omni.providers` 的 `getLyrics` 改为返回 `FoliumLyricsResult`；它注册的音源可以在首页切换器里选为当前音源。
  - **废弃**：`getLyrics` 的旧返回形状 `{ lrc, translationLrc }`（`FoliumLegacyLyricsResult`）。1.x 内照旧可用，Folium 2 移除。
  仓库里的样例已同步。
- 1.5 一次加入下面这些稳定接口，`folium.host.folium.minor >= 5`（main 入口是 `api.host.folium.minor`）即全部可用：
  - 播放控制补全：`folium.playback` 的 `getVolume`、`setVolume`、`setMuted`、`getLoopMode`、`setLoopMode`、`getQueue`、`playQueueItem`，
    通知 `playback.volumeChanged`、`playback.loopModeChanged`、`playback.queueChanged`；DTO `FoliumLoopMode`、`FoliumQueueItem`、`FoliumQueueSnapshot`。
  - 首页页面：注册表 `homeTabs`（`FoliumHomeTabDef`）与 `folium.ui.openHomeTab`。
  - 播放失败通知：`playback.failed` 与原因分类 `FoliumPlaybackFailureReason`。
  - main 入口的文件目录：`api.storage.paths`（`FoliumModPaths`）。
  - main 入口的播放快照 `FoliumPlaybackSnapshot` 新增 `volume`、`muted`、`loopMode`。
  - 宿主侧变化，契约不变、模组不用改：
    - 模组声明的 `type: 'select'` 参数（设置分区、visualizer / background 设置、tunings、命令参数）改用宿主自己的下拉框渲染，不再是原生
      `<select>`：外观随主题；可以用键盘选（↑↓ / Home / End 移动，Enter 选中；停在当前项上按 Enter 和 Esc 一样只关下拉框，不算改值），
      读屏会读出移到的选项；存储的值不在选项里时，显示 `defaultValue`（它也不在选项里就显示第一项），存储的值不变，直到用户自己选一次。
    - 新增宿主设置「无法播放时自动跳过」，在播放设置的「播放队列」卡片里，命令面板里也能切换，**默认关闭**。打开后，受限类和原因不明的失败
      也像已下架的歌一样倒计时跳到下一首，`playback.failed` 的 `willAutoSkip` 随之为 `true`；需要登录和网络问题仍然不跳。

## 从 UI 安装与管理

- **打开模组目录**：模组面板右上角按钮，打开用户模组目录 `userData/mods`（打包版为 `%APPDATA%\Folia\mods`）。
- **拖放 zip 安装**：把 `.zip` 拖到模组面板；`mod.json` 可以在根目录或唯一顶层文件夹里。
  - 安全校验：拒绝路径穿越与绝对路径；压缩包 ≤ 64 MB，解压后 ≤ 64 MB，单文件 ≤ 32 MB，条目 ≤ 2000。
  - **原子安装**：先解压到 `userData/mods/.staging/` 校验（清单、声明的 `main` / `client` 文件必须存在），通过后才换入；
    失败则回滚，旧版本原样保留。
  - 同 id 覆盖即升级；内容指纹改变后模组保持禁用，直到重新确认。
- **占用与清空缓存**（1.5）：声明了 `filesystem.data` 的模组，展开它的行时会显示「数据 X」「缓存 Y」两行和「清空缓存」按钮。
  - 只在展开时统计，停用的模组也能查、能清。统计只算普通文件，不跟随符号链接或 junction。
  - 「数据」是整个 `mods-data/<id>`（含 `storage.data` 的数据文件），「缓存」是 `mods-cache/<id>`。
  - 「清空缓存」删除缓存目录里的所有内容，保留目录本身，然后重新统计，并在面板上方的提示条里报告释放了多少。缓存为 0 或目录不存在时按钮不可用。
    缓存目录的位置上是一个文件或目标已经不在的链接时（这时模组读 `paths.cache` 会一直抛错），面板显示缓存目录已损坏，按钮可用，
    清空会删掉这个条目本身（不跟随链接），模组下次读取时重新建出目录。指向现存目录的链接照常可用，只是不统计。
    运行中的模组占着某些文件删不掉时，其余照删，并提示「缓存未能全部清空」（`cache-clear-partial`），停用模组后再试。
  - 这两项操作走 `window.electron.mods` 上的面板 IPC（`getModStorageUsage` / `clearModCache`，通道 `folia-mods:storage-usage`、
    `folia-mods:clear-cache`），和 `folium.storage` 用的存储 IPC 一样，以渲染进程传来的模组 id 为准：同一个渲染进程里的模组代码
    理论上也能调用它们，去查或清别的模组的缓存。
    这与[安全声明](#安全声明重要)里的边界一致：client 能读写界面里的一切，权限不是安全边界。

## 稳定性约束

- 单模组加载失败不影响宿主与其他模组；依赖图损坏只波及相关子图。
- 每次加载周期先停用当前模组再重新激活，不会叠加多代定时器与监听器。
- 导出会话全局互斥（`export-already-running`）；取消 / 失败时清理 ffmpeg 进程、离屏窗口与半成品文件。

## 外部播放会话（实验接口）

`playback.sessions` 允许模组通过宿主播放器跟随外部队列和时间线，需要同名 experimental 声明及 `playback.control` 权限。会话绑定模组生命周期，禁用或激活失败时由宿主清理。参见 [接口说明](../docs/folium/playback-sessions.md)；它不属于稳定的 Folium 1.x 播放服务，也不需要使用 internals。
