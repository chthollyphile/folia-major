# Folium 模组开发与贡献指南

这份指南面向想为 Folia 写模组的开发者：从零写出第一个模组、在本地调试，到把它发布到 [模组市场](https://folium-compound.cielaniska.top) 并获得官方认证。

四份文档分工如下：

| 文档 | 内容 |
| --- | --- |
| [第一个模组：从零到跑起来](quickstart.md) | 第一次写先看这一页：一条命令生成起点，一条命令检查，在应用里跑起来 |
| 本指南 | 怎么做：开发环境、示例、编写要点、发布流程 |
| [Folium API 参考](api.md) | 查什么：每个接口、成员和类型（由契约自动生成） |
| [Folium 规范](../../mods/README.md) | 规则是什么：清单字段、权限、注册表语义、事件、安全模型、版本策略 |

## 1. 开始之前

- **先确认接口边界。** 稳定扩展接口目前只有 UI 相关部分、歌词原文解析（`folium.lyrics.parse` 与 `getLyrics` 的返回形状），以及播放控制补全（音量、静音、循环模式、播放队列）、首页页面（`homeTabs`）、播放失败通知（`playback.failed`）与 main 入口的文件目录（`api.storage.paths`）；1.7 加了 main 入口向 client 推送消息（`api.rpc.send` / `folium.rpc.on`）、密钥类设置字段（`secret`）、登录状态（`folium.account`）、可以放进系统级全局快捷键的命令（`globalShortcut`）、整表替换播放队列（`folium.playback.replaceQueue`，权限 `playback.queue`），经 Omni 只读在线音源的 `folium.omni`（搜索、按 id 解析、歌词、专辑与歌手），以及音效（`folium.equalizer`：读宿主的均衡器、切换用户的音效、施加模组自己的曲线）。其余部分，尤其是 `omni.providers` 等 Omni provider 接口和平台后端直通 `platform.raw`，仍属实验接口，能力尚不能与应用内置 Omni provider 对等。在 Folium v2 发布前，请绝对不要尝试制作超出当前实验接口能力的完整音源模组；这类实现必然遇到接口缺口，浪费开发者和维护者的时间。
- **原始音频导出模组不得上架。** 任何尝试导出 provider 的原始音频流或解密之后的原始音频文件的模组，都有极高的平台法律风险。无论采用何种实现方式，此类模组都不会上架官方模组市场。
- **模组是可信代码，不是沙箱。** `client` 入口运行在主界面的渲染进程里，`main` 入口运行在主进程里、拥有完整的 Node.js 权限。`mod.json` 里的权限是功能开关，不是安全边界。
- **只在桌面版可用。** 网页版和 PWA 没有模组系统。
- **默认关闭。** 需要在「设置 → 模组」里开启；开启后每个模组仍默认禁用，启用时会弹出主进程的原生确认窗口。
- **确认绑定到文件内容。** 模组目录里任何文件变化都会让确认失效，模组被自动禁用，需要重新确认。唯一的例外是开发版里仓库 `mods/` 目录中的模组，见[调试循环](#调试循环)。
- **签名只是标识。** 发布到模组市场的模组带有 Folium 签名，安装后显示「官方认证」（先行测试渠道显示「先行测试」），但启用时同样要确认，权限也不会因此变少。

当前契约版本是 Folium 1.7（见[兼容与版本](#兼容与版本)）。

## 2. 准备开发环境

**用源码运行桌面版（推荐）**

```bash
npm install
npm run dev:electron
```

开发版会先扫描仓库根目录的 `mods/`，再扫描用户目录下的 `mods/`，所以把模组放进仓库的 `mods/<你的模组>/` 就能直接加载。仓库里的示范模组也在这里，可以对照着看。

**用已安装的桌面版**

把模组放进用户模组目录：打开模组面板，点右上角的「打开模组目录」（Windows 上是 `%APPDATA%\Folia\mods`）。也可以把模组的 zip 包拖到模组面板上安装。手动解压 zip 时多出来的一层文件夹不影响加载，直接把解压结果放进模组目录即可。

**打开模组面板**

开启「设置 → 模组」后，在命令面板里执行「模组」命令。面板列出所有发现的模组、它们的状态、签名标识、权限、设置分区和命令，出错时也会在这里显示。

### 调试循环

**在开发版里（`npm run dev:electron`），模组放在仓库的 `mods/` 目录中：**

1. 第一次启用时照常确认（确认窗口会注明「开发模式」）。
2. 修改模组文件后，在模组面板里点「重载」即可，不需要重新确认。

这是只给开发者源码目录的豁免：加载器发现文件变了，会把确认直接更新到新内容。面板里这类模组会标注「开发目录中的模组」。

**在安装版里，或模组放在用户模组目录时：**

1. 修改模组文件。
2. 在模组面板里点「重载」。内容指纹变了，加载器会撤销之前的确认并把模组禁用（面板提示「文件在你上次确认之后发生了变化」）。
3. 点模组行上的电源按钮重新启用，并确认。

`client` 入口按内容指纹带版本号导入，所以重载后加载的一定是最新代码。修改已签名的模组（比如仓库里的示范模组）后，它会显示「签名不匹配」，这是预期的。调试渲染端代码时可以直接打开开发者工具；模组调用 `folium.log.error()` 或抛出的错误会显示在模组面板里该模组的「界面代码出错」下。

## 3. 第一个模组：一个歌词动画

想直接要一个能跑的起点，用 `npm run folium:new <文件夹名>` 生成，再用 `npm run folium:check <文件夹名>` 检查（见[第一个模组：从零到跑起来](quickstart.md)）。下面是手写的做法，看得到每一行是干什么的。

新建目录 `mods/hello-lyrics/`，放三个文件。

`mod.json`：

```json
{
  "folium": 1,
  "id": "hello-lyrics",
  "name": "你好歌词",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "居中显示当前歌词，跟随主题与歌词字号。",
  "client": "client.mjs",
  "preview": "preview.png"
}
```

`client.mjs`：

```js
// mods/hello-lyrics/client.mjs
// 一个最小的歌词动画：居中显示当前行，跟随主题、字体与用户的歌词字号。

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'hello',
    label: { 'zh-CN': '你好歌词', en: 'Hello lyrics' },
    mount: (container, ctx) => mountHello(folium, container, ctx),
  });
}

// 挂载一次；换行、暂停、换主题、改显示设置都通过 ctx.onChange 得知，不需要重新挂载。
function mountHello(folium, container, ctx) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:0 8%;text-align:center;line-height:1.3;';
  container.appendChild(box);

  const render = () => {
    const theme = ctx.getTheme();
    const index = ctx.staticMode ? ctx.staticLineIndex : ctx.getLineIndex();
    const line = index !== null && index >= 0 ? ctx.lines[index] : null;
    box.textContent = line ? line.fullText : '';
    box.style.color = theme.primaryColor;
    box.style.fontFamily = folium.theme.resolveFontStack(theme);
    box.style.fontWeight = String(folium.theme.resolveFontWeight(theme, 600));
    box.style.fontSize = `${48 * ctx.getDisplay().lyricsFontScale}px`;
  };

  render();
  ctx.onChange(render); // 挂载结束时宿主替你停掉
  return () => box.remove();
}
```

`preview.png`：一张 1280×720 的截图，发布到模组市场时必需，本地开发可以先随便放一张。

然后：在模组面板点「重载」，启用「你好歌词」并确认，再到歌词样式设置的「歌词动画」里选择「你好歌词」。

这个例子用到的接口：[FoliumVisualizerDef](api.md#foliumvisualizerdef)、[FoliumStageContext](api.md#foliumstagecontext)、[FoliumThemeHelpers](api.md#foliumthemehelpers)、[FoliumDisplay](api.md#foliumdisplay)。完整的示范见仓库里的 `mods/sample-aurora-visualizer`（逐字扫光）和 `mods/visualizer52hz`（PixiJS、音频分析、设置、思索教程）。

## 4. 能做什么：速查

| 想做的事 | 用什么 | 需要的权限 | 参考 |
| --- | --- | --- | --- |
| 新的歌词动画模式 | `registries.visualizers` | — | [FoliumVisualizerDef](api.md#foliumvisualizerdef)，`sample-aurora-visualizer`、`visualizer52hz` |
| 新的背景类型 | `registries.backgrounds` | — | [FoliumBackgroundDef](api.md#foliumbackgrounddef) |
| 在播放页上叠加内容 | `registries.stageLayers` | `stageLayers` | [FoliumStageLayerDef](api.md#foliumstagelayerdef)，`sample-rickroll` |
| 给内置模式加调参项 | `registries.tunings` | — | [FoliumTuningDef](api.md#foliumtuningdef)，`k3panel` |
| 模组自己的设置 | `registries.settingsSections` | — | [FoliumSettingsSectionDef](api.md#foliumsettingssectiondef) |
| 命令（模组面板与命令面板） | `registries.commands` | — | [FoliumCommandDef](api.md#foliumcommanddef) |
| 系统级热键（Folia 在后台也能按，1.7） | 无参数的命令标 `globalShortcut: true`，用户在「设置 → 全局快捷键」里按下组合键（至少一个修饰键）；不要在 main 入口用 Electron 的 `globalShortcut`。原生 Wayland 下暂不提供 | — | [FoliumCommandDef](api.md#foliumcommanddef)，规范里的「系统级全局快捷键」，`dev/folium/sample-account-console` |
| 播放器面板里的标签页 | `registries.playerPanelTabs` | — | [FoliumPlayerPanelTabDef](api.md#foliumplayerpaneltabdef) |
| 首页导航里的完整页面 | `registries.homeTabs`，用 `folium.ui.openHomeTab` 打开 | — | [FoliumHomeTabDef](api.md#foliumhometabdef)，[首页页面](home-tabs.md)，`dev/folium/sample-home-tab` |
| 进度条旁的按钮、轨道上的标记 | `registries.progressButtons` / `progressLayers` | — | [FoliumProgressContext](api.md#foliumprogresscontext)，`sample-progress-bar` |
| 改宿主外观 | `registries.styles`（只针对公开 part） | — | [FoliumStyleDef](api.md#foliumstyledef)，规范里的「styles 与公开 part」 |
| 改写歌词、拦截播放 | `events.on('lyrics.transform' / 'playback.beforePlay')` | — | [FoliumHookEvents](api.md#foliumhookevents) |
| 读取或控制播放、点击歌词跳转 | `folium.playback` | 控制需 `playback.control` | [FoliumPlaybackService](api.md#foliumplaybackservice) |
| 音量、静音、循环模式，浏览并点播播放队列，整表替换播放队列（1.7） | `folium.playback.getVolume` / `setVolume` / `setMuted` / `getLoopMode` / `setLoopMode` / `getQueue` / `playQueueItem` / `replaceQueue`，变化看 `playback.volumeChanged` / `loopModeChanged` / `queueChanged` | 读取不需要；设置与点播需 `playback.control`；整表替换需 `playback.queue` | [FoliumPlaybackService](api.md#foliumplaybackservice)，[FoliumQueueSnapshot](api.md#foliumqueuesnapshot)，[FoliumQueueReplaceResult](api.md#foliumqueuereplaceresult)，`dev/folium/sample-playback-console` |
| 得知一首歌放不了 | `events.on('playback.failed')` | — | [FoliumNotificationEvents](api.md#foliumnotificationevents)，规范里的「事件」 |
| 访问网络（不受 CORS 限制） | `folium.net.fetch` | `net.fetch` | [FoliumNetService](api.md#foliumnetservice) |
| 嵌入外部网页 | `folium.ui.embed` | `net.embed` + `embedOrigins` | [FoliumUiService](api.md#foliumuiservice) |
| 保存数据 | 设置大小的数据（上限 1 MB）：`folium.storage`，与 main 入口的 `api.storage` 共用；文件：main 入口写进 `api.storage.paths.data`，可重建的放 `api.storage.paths.cache`。密钥不放这里，见下一行 | `filesystem.data` | [FoliumStorage](api.md#foliumstorage)，[FoliumModPaths](api.md#foliummodpaths)，`dev/folium/sample-playback-console` |
| 让用户填 API 密钥、令牌（1.7） | 设置分区里 `type: 'secret'` 的字段，值用 `folium.secrets` / `api.secrets` 读 | — | [FoliumSettingType](api.md#foliumsettingtype)，[FoliumSecretAccess](api.md#foliumsecretaccess)，`dev/folium/sample-account-console` |
| 让用户选择本地文件 | `folium.ui.pickFile` / `restoreFile` | — | [FoliumFileHandle](api.md#foliumfilehandle) |
| 使用宿主图标 | `folium.ui.icon` | — | [FoliumIconOptions](api.md#foliumiconoptions) |
| 需要 Node 的工作（文件、进程、ffmpeg） | `main` 入口 + `folium.rpc` | 视用到的 api 而定 | [main 入口](api.md#main-入口node)，`sample-transparent-mov-export` |
| main 入口主动通知 client（1.7） | main 入口 `api.rpc.send`，client `folium.rpc.on` | — | [FoliumMainRpc](api.md#foliummainrpc)，[FoliumRpc](api.md#foliumrpc)，`dev/folium/sample-account-console` |
| 知道谁登录了在线音源、换号时丢掉旧数据（1.7） | `folium.account.getState`，变化看 `account.changed` | — | [FoliumAccountService](api.md#foliumaccountservice)，[FoliumAccountState](api.md#foliumaccountstate)，`dev/folium/sample-account-console` |
| 读在线音源：搜歌、按存下的 `{ source, id }` 找回歌、歌词、专辑与歌手（1.7） | `folium.omni`；放和入队把拿到的歌交给 `folium.playback.playSong` / `enqueue` | 不需要（以用户在 Folia 登录的平台账号发请求，按模组限额）；放和入队需 `playback.control` | [FoliumOmniService](api.md#foliumomniservice)，[FoliumSongResolution](api.md#foliumsongresolution)，规范里的「folium.omni」，`dev/folium/sample-omni-console` |
| 读当前均衡器、切换用户的音效、施加自己的曲线（1.7） | `folium.equalizer`，变化看 `equalizer.changed` | 读不需要；写需 `equalizer.control` | [FoliumEqualizerService](api.md#foliumequalizerservice)，规范里的「folium.equalizer」，`dev/folium/sample-equalizer-console` |
| 调用 Omni 还没有的平台专有接口（后备，1.7） | `experimental['platform.raw']`，清单选用 `platform.raw`；`folium.omni` 有的不要用它读 | `platform.<平台>.read`，改动账号的接口另要 `.write` | [FoliumPlatformService](api.md#foliumplatformservice)，规范里的「platform.raw」，`dev/folium/sample-account-console` |

## 5. 写好一个模组

### 生命周期

- 所有界面类条目都是 `mount(container, ctx) => dispose`。只在宿主给的容器里操作，不要查询或修改容器以外的宿主 DOM。
- `dispose` 里释放你创建的一切：动画帧、定时器、事件订阅、WebGL 上下文。`activate` 也可以返回一个清理函数。用[现成的函数](#现成的函数)开的监听和定时器不用自己释放。
- 模组被禁用、重载或卸载时，宿主会先调用你的清理函数，再撤下你注册的所有条目和事件处理器。
- 启动有时限：从宿主开始导入你的 `client` 到 `activate` 返回（返回 promise 的话，到它给出结果），一共 5 秒。超过了不算出错，算慢：宿主提示用户一次「过了 5 秒还没有启动完」，然后去启动下一个模组；你的启动不会被取消，之后完成了，登记的条目照样生效，你那一行写着启动用了多少秒并标「慢」。启动时抛错才算出错，按时抛的和超时之后抛的都算；你的模组已经被禁用或被新代码换掉之后，旧的那次启动才抛的错不记在你头上。
- 应用打开时，第一屏最多等所有模组 1.5 秒。到时间还没启动完的模组在第一屏出来之后继续启动；用户存着的歌词样式或背景是你的，等你启动完会自动换回来。**晚启动的模组收不到第一首歌的 `lyrics.transform` 和 `playback.beforePlay`**（那首歌开始时你还没在听）。要赶上第一屏，就别在 `activate` 里等网络或大文件：先登记条目，数据到了再用。
- 导出窗口不设 1.5 秒这一条，它等每个模组启动完（各自最多 5 秒）；要导出的歌词样式所属的模组那时还在启动，导出就一直等到它启动完（用户可以取消导出）；它启动时出了错、没有这个模组、或者它启动完了却没登记这个样式，这次导出会报错停下，不会换成内置样式去导。
- 你的代码抛错时，宿主接住它、照常运行，并提示用户一次是哪个模组的哪一种条目出了错；每个出错的地方在「设置 → 模组」里这个模组那一行各记一行（次数、最近一次的时间和原因）。宿主不会因此停掉你的条目，所以 `mount` 抛错之后容器是空的，每帧都抛错的绘制会一直抛下去：自己接住能恢复的错，接不住的让它抛出来。

### 现成的函数

`ctx` 上有几个函数，它们替你反复调用你给的函数，直到这次挂载结束；挂载结束时宿主替你停掉，不用自己写取消的代码。除了 `onDispose`（它什么都不返回），每个都返回一个「停止」函数，想提前停就调用它，调用两次也没关系。`mount` 抛错（或它返回的 promise 失败）的话，这次挂载当场结束：它在抛错之前用这些函数开的监听和定时器，宿主当场停掉，登记给 `onDispose` 的函数当场调用。

监听属于订阅它的那一次挂载：同一个函数在两处挂载里各订一次，每次变化就各调用一次。

**`ctx.onLyricTime(listener)`**：歌词时钟每次变化时调用，参数是秒（`ctx.lyricTime.get()` 读到的那个数）。歌词动画和播放页图层的 `ctx` 有它。进度条的按钮和图层用 `ctx.onPlaybackTime(listener)`，参数是播放位置（`ctx.playbackTime`，`seek` 收的就是这个时间）。两个钟可以不同：用户调了歌词偏移时，歌词时钟和播放位置差这么多。

```js
const mount = (container, ctx) => {
  ctx.onLyricTime((seconds) => { container.textContent = seconds.toFixed(1); });
};
```

**`ctx.onChange(listener)`**：`ctx` 的某个 getter 读到的值变了就调用；每种 `ctx` 在 API 参考里写着哪些值会通知。

```js
const mount = (container, ctx) => {
  ctx.onChange(() => { container.style.color = ctx.getTheme().primaryColor; });
};
```

**`ctx.onFrame(listener)`**：应用每画一帧调用一次，参数是应用的帧循环开始这一帧的时刻（毫秒，和 `performance.now()` 是同一个钟；它比浏览器传给 `requestAnimationFrame` 回调的那个数晚一点，两个数不要混着比）。所有模组共用应用自己的那一个帧循环。一帧里每个监听最多调用一次：在监听里停掉自己再订一次，新订的从下一帧开始。它跟着屏幕走，不跟着歌走；跟着歌走的内容用 `onLyricTime`。

```js
const mount = (container, ctx) => {
  ctx.onFrame((timestamp) => { draw(timestamp, ctx.lyricTime.get()); });
};
```

**`ctx.onResize(listener)`**：容器排好版时调用一次，之后大小每变一次调用一次，参数是 `{ width, height }`（CSS 像素）。

```js
const mount = (container, ctx) => {
  ctx.onResize(({ width, height }) => { resizeCanvas(width, height); });
};
```

**`ctx.every(ms, listener)`**：每隔 `ms` 毫秒调用一次。`ms` 最小是 16，最大是 2147483647（浏览器的定时器最长只能等这么久），超出的按这两个数算；每帧都要做的事用 `onFrame`。`folium.every(ms, listener)` 是模组级的同一个函数，到模组停掉为止。

```js
const mount = (container, ctx) => {
  ctx.every(5000, () => { refresh(container); });
};
```

**`ctx.onDispose(fn)`**：挂载结束时调用 `fn`，排在 `mount` 返回的清理函数之后，后登记的先调用。挂载已经结束才登记，就立刻调用。`folium.onDispose(fn)` 是模组级的，在模组停掉时调用。

```js
const mount = (container, ctx) => {
  const app = createApp(container);
  ctx.onDispose(() => app.destroy());
};
```

`mount` 也可以是异步的：返回一个 promise，它最后给出清理函数。清理函数到的时候挂载已经结束，宿主立刻调用它。

```js
const mount = async (container, ctx) => {
  const app = await createApp(container);
  return () => app.destroy();
};
```

模组停掉之后（被禁用、重载或卸载），它手里那个 `folium` 对象的 `registries.*.register` 和 `events.on` 不再生效，开发者日志里会有一行带模组名的警告。挂载结束之后再调用上面这些函数也一样。

### 时间与性能

- 歌词动画只在歌词、歌曲、`staticMode` 或静态预览行变化时重新挂载；换行不会。当前行从 `ctx.getLineIndex()` 读，连续时间用 `ctx.onLyricTime` 或在自己的帧循环里 `ctx.lyricTime.get()`。
- 暂停时时钟不走，行号、主题、设置、显示设置的变化靠 `ctx.onChange` 得知。
- `ctx.audio.getBands()` 每次返回同一个对象、原地刷新，要保留读数就复制一份。
- 各个 getter 在帧循环里调用没有问题；不要为了读取它们触发 React 或 DOM 布局。
- 用户看得到你的开销。「设置 → 模组」里你那一行展开后写着：启动用了多少秒（启动时出了错就写「启动时出错了」，不写秒数）；运行时每秒约用多少毫秒（宿主反复调用的那些函数，也就是经 `ctx`、`folium` 订的监听和[现成的函数](#现成的函数)的回调，在它们运行的那些秒里用掉的时间，除以这些秒的个数；宿主不知道一帧在哪里结束，所以这个数不按帧算）；出错几次、在几个地方；有 Node 入口的话，它在主进程里一共用了多少毫秒、最长的一次多少毫秒。启动满 1.5 秒（或者过了 5 秒还没启动完）、运行时每秒满 240 毫秒、主进程里一次调用满 100 毫秒，这一行会标「慢」。宿主不会因为慢关掉任何东西。你自己开的 `requestAnimationFrame` 和定时器不经过宿主，不在这些数里。

### 预览、静态与导出

- `ctx.staticMode` 为真时只画 `ctx.staticLineIndex` 这一帧，不要启动动画。`ctx.isPreview` 表示在设置里的预览中。
- `folium.env.context === 'export'` 时运行在透明视频导出窗口：只属于界面的注册表照常可以调用但不生效，服务调用会抛 `*-unavailable-in-export-context`（`ui.icon` 除外）。同一份代码两边都能跑，只要不在导出窗口里调用服务。
- `ctx.getSurface().transparent` 为真时（OBS、透明导出）不要画不透明的底；`hostBackground` 为真时宿主在你下面画背景，画满整屏的模组应该让位。

### 歌词与主题

歌词行和主题与内置歌词动画收到的结构同名同义，内置模式的写法可以直接照搬：

- `line.endTime` 是歌词原始结束时间；这一行何时离开屏幕看 `line.renderHints.renderEndTime`，或用 `folium.lyrics.getLineRenderEndTime(line)`。
- 分词用 `folium.lyrics.segmentWords(line)`，它会优先使用用户保存的分词（`line.wordSegments`）。
- 关键词配色用 `folium.lyrics.buildWordColorRanges(line.fullText, theme.wordColors)`。
- 字体用 `folium.theme.resolveFontStack(theme)`，字号乘上 `ctx.getDisplay().lyricsFontScale`。
- 和声在 `line.backgroundVocals`，翻译与罗马音在 `translation` / `romanization` / `alternateTexts`。

### 设置

- 用 [FoliumSetting](api.md#foliumsetting) 声明 `settings`，宿主负责渲染表单、校验、持久化，并把值带进视觉配置的导入导出和导出窗口。
- 想要自己的面板外观时用 `settingsPanel(container, panelCtx)`，但仍然必须声明 `settings`：键、默认值和校验由 schema 决定，面板通过 `panelCtx.settings`（`get`、`set`、`reset`、`onChange`）读写。
- 用户要填的 API 密钥、令牌用 `type: 'secret'` 的字段（Folium 1.7，只能放在设置分区里），不要用 `text`，也不要用 `settingsPanel` 自绘再存进 `folium.storage`：`text` 的值随视觉配置导出、交给导出窗口，设置页也是明文；`folium.storage` 是明文文件。`secret` 的值由主进程加密保管，不在 `settings.get()` 里，client 用 `folium.secrets`、main 入口用 `api.secrets` 读，宿主不记进日志，你的代码也别记。每次启动 Folia，main 入口都比 client 先启动：client 登记分区之前，没有值的 key 读出来是 `null`，写它会被拒绝为 `secret-undeclared:<key>`。规则见规范里的「密钥字段」。

### 读在线音源

- 用 `folium.omni`（Folium 1.7）：搜歌、按 id 找回歌、歌词、专辑与歌手，拿到的歌直接交给 `folium.playback.playSong` / `enqueue`。它不需要权限，但以用户在 Folia 登录的平台账号发请求，启用确认窗口里不会提这一句：模组这样访问平台时，在 `description` 里写清楚。
- 存歌存 `{ source, id }`，存专辑、歌手存 `{ source, kind, id }`，不存 `ref`：`ref` 只在这次运行里有效，同一首歌两次读到的 `ref` 也可能不同，判断是不是同一首歌比 `source` 和 `id`。下次启动用 `resolveSongs` / `resolveCollection` 找回来；回 `unsupported` 的键留着，音源回来就又能查。
- 只读要显示的：宿主每替你问一次平台，就算进这个模组每分钟的额度（和 `platform.raw` 共用），超了直接拒绝。翻页用 `nextCursor`，解析只解析马上要显示的那一段。
- 给每次调用传 `signal`，换了搜索词、不再要那份回答时中止旧的（模组停掉时宿主替你中止）；`aborted` 只是丢掉回答，平台那边的请求可能还在跑。
- 失败看 `code`，不认识的按 `network` 处理。规则见规范里的「folium.omni」，完整的例子见 `dev/folium/sample-omni-console`。

### 系统级热键

- 想让用户在 Folia 不在前台时也能按键触发模组的动作，就给一条没有参数的命令标上 `globalShortcut: true`（Folium 1.7）。它会出现在桌面版「设置 → 快捷操作 → 全局快捷键」的命令下拉框里，键由用户按下组合键选定（至少一个修饰键），保留组合、重复组合和被别的程序占用的提示都由宿主管。按下时 `run` 拿到空的 `values`，结果不显示，需要反馈就用 `folium.ui.toast`。
- 不要在 main 入口 `require('electron')` 拿 `globalShortcut` 自己注册，再用 `executeJavaScript` 把动作塞进窗口：那样会绕开宿主的规则，在 Windows 上独占别的程序的组合键，也可能先占走宿主自己的键，让宿主注册失败。`globalShortcut.unregisterAll()` 会把宿主的键一起清掉。
- 媒体键（播放/暂停、上一首、下一首）由宿主经 Media Session 处理，不要抢。
- 原生 Wayland 下暂不提供：那里的全局快捷键由桌面环境的快捷键门户接管，宿主交出去的是固定的播放命令整表。

### 第三方库

`client` 只能用相对路径 import 模组目录里的 `.mjs` / `.js` 文件，不能 import 裸模块名，也拿不到宿主打包的库。要用第三方库，把它的 ESM 构建放进模组目录（例如 `vendor/pixi.min.mjs`）并附上许可证，见 `visualizer52hz`。

### 兼容与版本

- 清单里写 `"folium": 1`。Folium 1.7 的宿主上，[API 参考](api.md)里的每个成员都在；`folium.host` 给显示和日志用。用到 1.7 新加的成员（`rpc.send` / `rpc.on`、`secret` 字段与 `secrets`、`account`、`omni`、`equalizer`、`playback.replaceQueue`）时先检查 `folium.host.folium.minor >= 7`（main 入口是 `api.host.folium.minor`；`replaceQueue` 再加上 `typeof folium.playback.replaceQueue === 'function'`）：旧宿主上没有它们（`folium.omni`、`folium.equalizer` 读出来是 `undefined`），`secret` 字段会被丢掉，分区丢完字段一个不剩时注册会抛错。`minor` 检查救不了新权限：声明了 `playback.queue` 或 `equalizer.control` 的清单在 Folium 1.6 的宿主上整份被拒（未知权限一律拒绝），模组根本装不上。要兼容 1.6，均衡器只能只读、不声明 `equalizer.control`（见规范里的「folium.equalizer」）；`replaceQueue` 离不开 `playback.queue`，用它的模组装不上 1.6（见规范里的 replaceQueue）。命令的 `globalShortcut` 不用检查：旧宿主只是不认它，命令照常出现在命令面板和模组面板里。
- 为 Folium 1.5 写的模组照旧能用，用到的旧名字在「设置 → 模组」里这个模组那一行各提醒一次，`npm run folium:check` 也会列出来。改成现在的写法见 API 参考的[仍可用的旧名字](api.md#仍可用的旧名字)，Folium 2 起旧名字不再有效。
- 实验接口（`omni.providers`、`omni.hooks`、`ponder.targets`、`player.layout`、`remote.actions`、`platform.raw`）需要在清单的 `experimental` 里选用，任何 minor 版本都可能变化。`platform.raw` 返回的是平台原始 JSON，跟着宿主钉住的后端库变，按字段防御着读。读歌曲详情、歌词、搜索、专辑与歌手先用稳定的 `folium.omni`（1.7），它给的是宿主的歌曲 DTO，可以直接交给 `playSong` / `enqueue`；`platform.raw` 只留给 `folium.omni` 没有的平台专有接口。
- 模组更新时提升 `mod.json` 的 `version`（`MAJOR.MINOR.PATCH`）。

## 6. 发布到模组市场

官方模组和通过审查的社区模组收录在 [folium-compound](https://github.com/chthollyphile/folium-compound)，发布在 [模组市场](https://folium-compound.cielaniska.top)。收录的模组都带有 Folium 签名，分两个发布渠道：

- **正式发布**：通过安全审查和功能审查，用户安装后显示「官方认证」。
- **先行测试**：仅通过了安全审查，不保证功能实现的整洁，甚至功能可能完全无法工作，主要给社区开发者做创意实验。用先行测试密钥签名，用户安装后显示「先行测试」，模组市场只在「先行测试」标签页里列出它们。Folia 0.7.20 起才认识先行测试密钥，更早的版本会把先行测试模组显示为「签名不匹配」。

提交时在 issue 表单里选择渠道；维护者可以把正式发布的申请降为先行测试。先行测试的模组以后可以开「模组更新」issue 申请转为正式发布。

不需要 fork 任何仓库：你只需要把模组放在自己的公开源码仓库里，再开一个 issue。

### 准备

- 公开的 https 仓库（GitHub、GitLab、Codeberg 等）。模组可以在仓库根目录，也可以在某个子目录。
- `mod.json` 通过 Folia 的清单校验，`id` 与收录时的目录名相同、没有被占用。
- **介绍图片**：`"preview"` 指向模组目录里的 PNG / JPG / WebP。推荐 1280×720（接近 16:9，至少 640×360），不超过 1 MB。它显示在模组市场的卡片顶部，最好是模组运行时的真实截图。
- 为要发布的版本打一个 tag。
- 以 `.` 开头的文件和目录（`.git`、`.github`、编辑器配置）和 `node_modules` 不会被收录，其余文件原样收录；不要包含 `folium.sig.json`；不能有符号链接；最多 300 个文件、16 MB。
- 包含第三方库时，把它们的许可证文件放在模组目录里。

### 提交

1. 在 folium-compound 开一个 [「模组提交」issue](https://github.com/chthollyphile/folium-compound/issues/new?template=mod-submission.yml)，填写模组 id、源码仓库、版本（tag、分支或完整 commit）、模组目录、模组说明、逐条的权限说明和许可证。
2. CI 会把版本解析成具体的 commit，只取回这一个提交，按收录规则整理并检查，然后在 issue 里回复：
   - 通过：「格式检查通过，请等待维护者审查」，附源码链接、将要签名的完整文件清单和签名摘要；
   - 未通过：列出问题。修改后打新 tag 并编辑 issue 里的版本，会自动重新检查。

### 审查与签名

维护者审查的是那个 commit 的模组目录，至少会确认：

- 通读 `main` 与 `client` 的全部代码，以及它们能加载的所有文件，包括 `vendor/` 里的第三方库；
- 声明的权限、`embedOrigins`、实验接口与 issue 里的说明、与实际用途相符，没有多余的权限；
- `platform.<平台>.read` / `.write`（实验接口 `platform.raw`）从严审：issue 里要写明调哪些接口、读来做什么，读到的账号数据和其它用户数据一样不上传；Omni 已经提供的能力要改用 Omni。`write` 让模组能以用户的账号点赞、增删歌单里的歌、关注，维护者会确认功能确实需要它，而且每次改动都由用户在界面上明确触发；
- 不上传用户数据，不下载并执行远程代码；只写 `api.storage.paths.data` 与 `api.storage.paths.cache`，写别处要在 issue 的模组说明里申报。
- 读在线音源要用 `folium.omni`。用 `folium.internals.omni` 或 `platform.raw` 做 `folium.omni` 已经能做的事（搜索、按 id 读歌曲、歌词、专辑与歌手）算功能问题：不影响先行测试，但拦正式发布。
- 系统级热键要用命令的 `globalShortcut` 字段。在 main 入口直接用 Electron 的 `globalShortcut` 注册算功能问题：不影响先行测试，但拦正式发布。调用 `globalShortcut.unregisterAll()` 会清掉宿主自己的全局快捷键，算改动宿主状态，必须在 issue 的模组说明里申报。

审查通过后，维护者在 issue 里评论 `/sign <commit>`。CI 会再次取回同一个 commit、重跑检查，把文件复制进 folium-compound，签名，登记你为这个模组的维护者，然后发布。几分钟后模组就会出现在模组市场，issue 自动关闭。

签名绑定的是 commit，不是 tag：审查之后如果 tag 被移动或 issue 改成了别的版本，签名命令会被拒绝，需要按新的提交重新审查。

### 更新

发布新版本时：

1. 提升 `mod.json` 的 `version`，打新 tag。
2. 开一个 [「模组更新」issue](https://github.com/chthollyphile/folium-compound/issues/new?template=mod-update.yml)，填模组 id、新版本和更新说明。源码仓库和目录沿用登记的那一个；只接受登记维护者提交的更新。
3. CI 检查并附上与上一个签名版本的对比链接，维护者审查差异后签名，新版本替换旧版本。

需要更换源码仓库或目录、增减维护者时，在 issue 里说明，由维护者处理。

### 用户看到的签名状态

| 状态 | 含义 |
| --- | --- |
| 官方认证 | 正式发布渠道的签名有效，文件自签名后没有改动 |
| 先行测试 | 先行测试渠道的签名有效：仅通过了安全审查，不保证功能可用 |
| 未验证 | 没有签名文件：没有经过 Folium 审查的第三方模组 |
| 签名不匹配 | 有签名但校验失败，最常见的原因是签名后文件被改动过（包括用户在本地修改了模组） |

没有签名的模组照样可以安装和使用，只是显示「未验证」。签名规则和密钥管理见规范里的「签名与官方认证」。

## 7. 常见问题

**改了代码没有生效？**
先在模组面板点「重载」并重新启用。还不行的话，确认用户模组目录里没有同 id 的旧副本：同一个 id 只认最先扫描到的那一份（开发版的扫描顺序是仓库 `mods/`、用户目录 `mods/`、安装目录 `resources/mods`）。

**为什么改完代码要重新确认？**
启用确认绑定到模组目录的内容摘要，任何文件变化都会让它失效，这是为了防止别人替换已启用模组的文件。开发时把模组放进仓库 `mods/` 并用 `npm run dev:electron` 运行，就只需要第一次确认。

**模组出错会影响应用吗？**
不会。`activate`、每个事件处理器、每次挂载都在各自的错误边界里，出错只影响这个模组，错误显示在模组面板里。

**网页版能用模组吗？**
不能，模组系统只在桌面版里可用。

**怎样让我的模组显示「官方认证」？**
按[第 6 节](#6-发布到模组市场)提交到 folium-compound，发布渠道选「正式发布」，通过安全审查和功能审查后由 CI 签名。只通过安全审查的模组会收录到先行测试，显示「先行测试」。本地自己签名不会被认可：只有 Folium 的密钥签出的签名会被宿主信任。
