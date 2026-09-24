# Folium 1：Folia 模组平台

> **实验性功能，默认关闭。** 需先在「设置 → 实验室 → 模组系统」中开启，命令面板的「模组」命令与模组
> 管理面板才会出现，加载器也才会扫描目录。开关关闭时**不加载任何模组代码**——不是隐藏 UI，而是已启用
> 的模组也会被停用（执行其 deactivate），相关 IPC 一律拒绝。开关本身不替代单个模组的启用确认。

Folium 是 Folia 的模组平台，形状参照 Minecraft Forge：模组通过**注册表**往宿主里加东西，
通过**事件总线**介入宿主行为，通过**服务**调用宿主能力；确实要碰宿主内部时，走一个明确标注、
钉死宿主版本的 **internals** 通道。

本文件就是 Folium 1 的规范。「稳定」的部分在 folium 1.x 内只增不改（见[版本与演进](#版本与演进)）；
标了「实验」的部分需要在清单里显式选用，任何 minor 都可能变。

公开类型全部在 [`src/mods/folium/contract.ts`](../src/mods/folium/contract.ts)，这是契约的唯一来源。
仓库里的样例模组都是按本规范写的，可以直接照抄：

| 样例 | 演示 |
| --- | --- |
| `sample-aurora-visualizer` | 歌词动画模式（visualizers），纯 client |
| `k3panel` | 给内置模式「商籁」调参（tunings），纯 client |
| `sample-transparent-mov-export` | client 注册命令，经 rpc 交给 main 调导出服务 |
| `sample-progress-bar` | 改造进度条：按钮、样式、外部动态数据图层、设置分区、net.fetch、storage |
| `sample-rickroll` | 在播放页嵌入外部网页（stageLayers + ui.embed + embedOrigins） |
| `sample-video-layer` | 歌词后方视频层：ui.pickFile/restoreFile（重启后恢复所选文件）、storage、播放事件同步、设置分区、命令 |

## 安全声明（重要）

模组是**可信代码，不是沙箱**：`main` 入口运行在主进程，拥有完整 Node.js 权限；`client` 入口运行在
主界面所在的渲染进程，能读写界面里的一切。`mod.json` 的 `permissions` 是功能开关约定（未声明的 API
调用 fail closed），**不构成安全边界**。

- **两道开关**：实验室总开关决定加载器是否工作；总开关开启后，单个模组仍默认禁用，需逐个确认启用。
- **启用需二次确认**：主进程原生确认窗口列出模组 id、安装位置、声明的权限、界面代码入口、选用的实验接口、
  可嵌入的外部网页、是否使用内部接口（及兼容的宿主版本）与内容指纹，默认按钮为「取消」。窗口刻意不在渲染
  进程绘制——那里的弹窗可被模组代码伪造或自动点击。
- **信任绑定到内容**：确认结果与模组目录的内容摘要（sha256）一并保存。任何文件变化都会使摘要失配，
  加载器随即**撤销授权并保持禁用**，需要重新确认。
- 仅安装并启用可信来源的模组；启用前请审阅它的 `main` 与 `client` 代码。

## 目录结构

```
mods/
  your-mod-id/            # 目录名任意，模组身份以 mod.json 的 id 为准
    mod.json              # 必填：清单
    index.cjs             # 可选：main 入口（Node）
    client.mjs            # 可选：client 入口（渲染端 ESM），可以 import 同目录下的其它 .mjs/.js
```

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
| `depends` | 模组 id 或 `id@^1.2.3`（仅支持 `^` 与 `*`）。缺失、版本不符、成环或依赖未启用时，只有该依赖子图不加载 |
| `permissions` | 见下表。未知权限直接拒绝 |
| `embedOrigins` | `folium.ui.embed` 可以加载的 https origin（形如 `https://host[:port]`），需要 `net.embed` |
| `experimental` | 选用的实验接口：`omni.providers`、`omni.hooks`、`ponder.targets` |
| `folia` | 宿主版本范围（空格分隔的比较式，支持 `>= > <= < = ^` 与 `*`）。**使用 `folium.internals` 时必填**；宿主版本不在范围内时加载器拒绝加载（`host-version-mismatch`） |

| 权限 | 解锁 |
| --- | --- |
| `filesystem.data` | `api.storage.data.*`（main）与 `folium.storage.*`（client），两边共用一个数据文件 |
| `runtime.playback` | `api.runtime.getPlaybackSnapshot()`（main） |
| `render.export` | `api.render.exportVideo()`（main） |
| `playback.control` | `folium.playback` 的播放、暂停、跳转、切歌、入队 |
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
  只属于界面的注册表（commands、stageLayers、playerPanelTabs、controlButtons、progressLayers、styles）
  是空实现——照常调用、不生效，所以同一份代码两边都能跑；服务（playback / ui / net / storage / rpc）
  在导出窗口里调用会抛 `*-unavailable-in-export-context`。
- `folium.host`：`{ folium: { major, minor }, folia: '<宿主版本>' }`，用于运行时的功能探测。

### folium 对象一览

| 成员 | 说明 |
| --- | --- |
| `modId` / `host` / `env` / `log` | 基本信息与日志（`log.error` 会记到模组面板） |
| `registries.*` | 见[注册表](#注册表) |
| `events.on(type, handler, { priority })` | 见[事件](#事件)，返回取消函数 |
| `playback` / `ui` / `net` | 见[服务](#服务) |
| `storage.get/set/has/delete/keys` | 异步；需 `filesystem.data`；单模组数据上限 1 MB |
| `rpc.call(name, ...args)` | 调用本模组 main 侧 `api.rpc.handle(name, fn)` 注册的函数；参数与返回值需可 JSON 序列化 |
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
| `controlButtons` | 进度条左右的按钮（`progress.leading` / `progress.trailing`） | 稳定 |
| `progressLayers` | 叠在进度条轨道上的图层 | 稳定 |
| `styles` | 模组 CSS，只针对公开 part | 稳定 |
| `experimental['omni.providers']` | 在线音乐源 | 实验 |
| `experimental['ponder.targets']` | 思索（应用内教程）目标 | 实验 |

### 宿主托管容器

界面类条目都是 `mount(container, ctx) => dispose?`：宿主创建容器（面板、图层、按钮放在 **ShadowRoot**
里，样式互不泄漏），通过继承的 CSS 变量传主题色：`--folium-bg`、`--folium-primary`、`--folium-secondary`、
`--folium-accent`、`--folium-font`；移除容器时调用 dispose。**模组不查询、不修改容器以外的宿主 DOM**，
也不需要轮询——生命周期全部由宿主管。

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
| `lines` / `song` / `staticMode` / `staticLineIndex` | 本次挂载内不变的快照（`FoliumLine` 已含渲染结束时间） |
| `currentTime.get()` / `.on('change', cb)` | 歌词时钟 |
| `getLineIndex()` / `isPaused()` / `getTheme()` / `getSettings()` / `getSurface()` | 随时读取，每帧读也没问题 |
| `subscribe(cb)` | 行号、暂停、主题、设置、表面任一变化时回调（暂停时时钟不走，靠它得知变化） |

- **只在歌词数据、歌曲、`staticMode` 或静态预览行变化时重挂载**；换行不会重挂载，行号从 `getLineIndex()` 读。
- `hostLayers.background`：宿主在你下面画用户选的背景；`getSurface().hostBackground` 为真时，画满整屏且不透明
  的模组应自己让位。`hostLayers.subtitles`：宿主在上面画底部字幕（翻译 / 下一句），走用户的字幕设置。
- `settingsPanel` 必须配合 `settings`：它只替换「画法」，键、默认值和校验仍由 schema 决定，面板通过
  `panelCtx.params`（`get / set / reset / subscribe`）读写。

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
`getSettings()`、`getCoverUrl()`、`subscribe()`。可带 `settings` / `settingsPanel`。透明表面（OBS、透明导出）下
宿主不渲染背景。

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

### controlButtons 与 progressLayers

两者共用 `FoliumProgressContext`：`currentTime`、`getDuration()`、`timeToRatio(t)`、`seek(t)`、
`getColors()`（宿主进度条的颜色）、`subscribe()`（时长或颜色变化）。三处进度条（悬浮控件两处、Lattice）
都渲染同一个宿主组件，所以扩展会同时出现在三处。

- `controlButtons`：`slot` 为 `progress.leading` 或 `progress.trailing`，容器按内容大小排布。
- `progressLayers`：容器铺满轨道且**不拦截指针**，拖动进度照常可用；标记等需要点击的元素自己设 `pointer-events: auto`。

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

**钩子**（同一个事件对象依次经过每个处理器，处理器可以改它）：

| 钩子 | 说明 |
| --- | --- |
| `lyrics.transform`（同步） | 新歌词进入播放页之前。给 `event.lines` 赋新数组即可改写；**原样保留的行对象**保留宿主的全部数据（渲染提示、演唱者、和声……），新建或修改的行由 DTO 重建。输入总是未改写的歌词，不会叠加到自己的输出上：宿主重建已显示的歌词（例如分词更新）时从未改写的版本重新跑一遍，处理器不需要幂等 |
| `playback.beforePlay`（异步） | 任何歌曲开始播放之前。`event.cancel()` 取消；`event.replaceWith(song)` 换歌（song 必须带宿主给的 `ref`）。单个处理器超过 1.5s 被跳过。automix 过渡自动切到的下一首不经过它：过渡按固定时间表提前数秒启动下一首，不能等处理器 |
| `omni.lyricsResolved` / `omni.audioSourceResolved`（异步，**实验**，需 `omni.hooks`） | Omni 拿到在线歌曲的歌词 / 音频地址之后，可改写行或给 `event.url` 赋新地址 |

## 服务

**`folium.playback`**：`getState()` 返回 `{ song, state, position, duration }`；`play / pause / toggle / seek / next / previous`、
`playSong(song)`、`enqueue(song)` 需要 `playback.control`。歌曲 DTO 带不透明的 `ref`，宿主靠它找回真正的歌曲。

**`folium.ui`**：

| 方法 | 说明 |
| --- | --- |
| `toast(message, { type, durationMs })` | 提示条 |
| `openPlayerPanel(tabId?)` | 打开播放器面板，可指定本模组注册的标签 |
| `navigate('home' \| 'player')` | 页面导航 |
| `pickFile({ accept: 'video' \| 'audio' \| 'image' \| 'any', persist })` | 原生选择框；返回 `{ url, name, size }` 或 `null`。`url` 是本次会话有效的 `folia-mod://_files/...`，支持 Range，可直接做 `<video>` 的 src。`persist: true`（1.1）时宿主记住这次选择，返回值多一个不透明的 `grantId` |
| `restoreFile(grantId)`（1.1） | 把之前 `persist` 选中的文件换成本次会话的新句柄（含同一个 `grantId`）；授权不属于本模组或文件已不存在时返回 `null`，后者的授权随即作废。模组始终拿不到文件路径 |
| `releaseFile(grantId)`（1.1） | 放弃授权；已经发出的 URL 本次会话内仍然有效 |
| `embed(container, url, { title, allow })` | 在容器里建一个沙箱 iframe；origin 必须在 `embedOrigins` 里，需 `net.embed`。返回移除函数 |

> 持久授权按模组 id 保存（每个模组最多 32 条，超出时丢弃最旧的），要跨重启使用就把 `grantId` 存进 `folium.storage`（需 `filesystem.data`）。
> 1.0 宿主没有 `restoreFile`，用 `typeof folium.ui.restoreFile === 'function'` 或 `folium.host.folium.minor >= 1` 判断。示例见 `sample-video-layer`。

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
| `api.runtime.getPlaybackSnapshot()` | 需 `runtime.playback`；返回 `FoliumPlaybackSnapshot` DTO，`position` 在播放中按推送时间外推 | 稳定 |
| `api.render.exportVideo(spec)` | 需 `render.export`；spec 只有输出参数 `{ codec: 'vp9' \| 'prores', width, height, fps, startSec, endSec, background: 'transparent' \| 'theme' }`，模式、调参、歌词、主题与 Folium 参数值由宿主按当前状态取 | 稳定 |
| `api.experimental` | 目前为空 | 实验 |

导出上限（3840×2160、60fps、15 分钟、全局互斥）与 ffmpeg 查找顺序属于宿主行为，不属于契约，可能调整。

### 依赖 ffmpeg（导出类模组）

- 查找顺序：`FOLIA_FFMPEG_PATH` 环境变量 → 应用目录下 `ffmpeg-8.1.2/ffmpeg(.exe)` → 打包资源目录下 `ffmpeg/ffmpeg(.exe)` → 系统 PATH。
- 需要**完整** ffmpeg（`rawvideo` demuxer、`prores_ks` 或 `libvpx-vp9`、MOV/WebM 封装）。应用自带的 `ffmpeg-audio/`
  只含 FLAC/WAV 音频转码，不能用于导出。
- 输出目录：`视频/Folia Exports`。透明通道：Windows 完整支持；Linux/macOS 下可能不含 Alpha，返回值里会有警告。

## 实验接口

选用方式：清单 `"experimental": ["omni.providers"]`，然后 `folium.experimental['omni.providers']`。

**`omni.providers`**：注册一个在线音乐源，宿主把它适配成内置 provider 的形状（搜索、播放、LRC 歌词）。
provider id 为 `folium.<modid>.<id>`；歌曲的 `mediaId` 就是模组自己的歌曲 id，模组停用后队列里的歌只是暂时不能播放。

```js
folium.experimental['omni.providers'].register({
  id: 'radio', displayName: 'My Radio',
  search: async (query, { limit, offset }) => ({ items: [{ id, title, artists: [...] }], hasMore: false }),
  getAudioUrl: async (song, quality) => ({ url }),
  getLyrics: async (song) => ({ lrc, translationLrc }),
});
```

**`omni.hooks`**：`folium.experimental['omni.hooks'].on('lyricsResolved' | 'audioSourceResolved', handler)`，
或者直接 `folium.events.on('omni.…')`（未选用时抛错）。

**`ponder.targets`**：往思索（应用内教程）注册表加目标，定义直接沿用宿主的 `PonderTargetDefinition`，
id 带 `<modid>:` 前缀，`titleKey` 可以直接写文字。

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

## 从 UI 安装与管理

- **打开模组目录**：模组面板右上角按钮，打开用户模组目录 `userData/mods`（打包版为 `%APPDATA%\Folia\mods`）。
- **拖放 zip 安装**：把 `.zip` 拖到模组面板；`mod.json` 可以在根目录或唯一顶层文件夹里。
  - 安全校验：拒绝路径穿越与绝对路径；压缩包 ≤ 64 MB，解压后 ≤ 64 MB，单文件 ≤ 32 MB，条目 ≤ 2000。
  - **原子安装**：先解压到 `userData/mods/.staging/` 校验（清单、声明的 `main` / `client` 文件必须存在），通过后才换入；
    失败则回滚，旧版本原样保留。
  - 同 id 覆盖即升级；内容指纹改变后模组保持禁用，直到重新确认。

## 稳定性约束

- 单模组加载失败不影响宿主与其他模组；依赖图损坏只波及相关子图。
- 每次加载周期先停用当前模组再重新激活，不会叠加多代定时器与监听器。
- 导出会话全局互斥（`export-already-running`）；取消 / 失败时清理 ffmpeg 进程、离屏窗口与半成品文件。
