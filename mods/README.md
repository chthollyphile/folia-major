# Folium 1：Folia 模组平台

> **实验性功能，默认关闭。** 需先在「设置 → 模组 → 模组系统」中开启，命令面板的「模组」命令与模组
> 管理面板才会出现，加载器也才会扫描目录。开关关闭时**不加载任何模组代码**——不是隐藏 UI，而是已启用
> 的模组也会被停用（执行它的清理函数），相关 IPC 一律拒绝。开关本身不替代单个模组的启用确认。

Folium 是 Folia 的模组平台，形状参照 Minecraft Forge：模组通过**注册表**往宿主里加东西，
通过**事件总线**介入宿主行为，通过**服务**调用宿主能力。

本文件就是 Folium 1 的规范。「稳定」的部分在 folium 1.x 内只增不改（见[版本与演进](#版本与演进)）；
标了「实验」的部分需要在清单里显式选用，任何 minor 都可能变。

> **模组开发与上架注意事项**
>
> - 稳定扩展接口目前只有 UI 相关部分、歌词原文解析（`folium.lyrics.parse` 与 `getLyrics` 的返回形状），以及播放控制补全（音量、静音、循环模式、播放队列）、首页页面（`homeTabs`）、播放失败通知（`playback.failed`）与 main 入口的文件目录（`api.storage.paths`）；1.7 加了 main 入口向本模组 client 推送消息（`api.rpc.send` / `folium.rpc.on`）、密钥类设置字段（`secret` 与 `folium.secrets` / `api.secrets`）、登录状态（`folium.account` 与 `account.changed`）、可以放进系统级全局快捷键的命令（`globalShortcut`）、整表替换播放队列（`folium.playback.replaceQueue`，权限 `playback.queue`），经 Omni 只读在线音源的 `folium.omni`（搜索、按 id 解析、歌词、专辑与歌手），以及宿主均衡器（`folium.equalizer` 与 `equalizer.changed`：读宿主的均衡器、切换用户的音效、施加模组自己的曲线；读不需要权限，写需 `equalizer.control`）。其他部分，尤其是 `omni.providers` 等 Omni provider 接口和平台后端直通 `platform.raw`，仍属实验接口，尚不具备应用内置 Omni provider 的对等能力。在 Folium v2 发布前，请绝对不要尝试制作超出当前实验接口能力的完整音源模组；接口缺口必然导致问题，浪费开发者和维护者的时间。
> - 任何尝试导出 provider 的原始音频流或解密之后的原始音频文件的模组，都有极高的平台法律风险。无论采用何种实现方式，此类模组都不会上架官方模组市场。

公开类型全部在 [`src/mods/folium/contract.ts`](../src/mods/folium/contract.ts)，这是契约的唯一来源；
[`folium.d.ts`](folium.d.ts) 是从它生成的一份给编辑器用的类型文件。第一次写模组，先照
[第一个模组：从零到跑起来](../docs/folium/quickstart.md)走一遍（一条命令生成起点，一条命令检查）。
仓库里的样例模组都是按本规范写的，可以直接照抄：

| 样例 | 演示 |
| --- | --- |
| `sample-aurora-visualizer` | 歌词动画模式（visualizers），纯 client |
| `visualizer52hz` | 「52Hz」PixiJS 歌词动画：逐字点亮，按节拍沿字形轮廓发出年轮，纯音乐时从随机髓心生长；visualizers + settings + `ctx.audio` + 思索教程（`ponder.targets`，通用骨架 + 双语字幕）+ 模组自带第三方库 |
| `k3panel` | 给内置模式「商籁」调参（tunings），纯 client |
| `sample-transparent-mov-export` | client 注册命令，经 rpc 交给 main 调导出服务 |
| `sample-progress-bar` | 改造进度条：按钮、样式、外部动态数据图层、设置分区、net.fetch、storage |
| `more-progress-buttons` | 进度条两侧加「打乱队列」「音量」「喜爱」按钮，可分别关闭；用 `--folium-player-bar-extra` 把胶囊加宽补回轨道长度 |
| `sample-rickroll` | 在播放页嵌入外部网页（stageLayers + ui.embed + embedOrigins） |
| `sample-beta-hello` | 先行测试渠道的最小示例：启用后在控制台打印 hello world，用先行测试密钥签名 |

`dev/folium/` 下还有几个示范模组：下表是 1.5 和 1.7 的，实验接口 `player.layout`、`remote.actions` 的示例见各自的小节。
它们**没有签名**，开发版也**不会自动扫描**这个目录，需要手动安装：
把模组目录打成 zip 拖到模组面板，或复制到用户模组目录（见[从 UI 安装与管理](#从-ui-安装与管理)），装好后显示为「未验证」。

| 样例 | 演示 |
| --- | --- |
| `dev/folium/sample-home-tab` | 首页页面（homeTabs + `ui.openHomeTab`）：双栏页面、输入不触发宿主快捷键、挂载与清理、注销入口后回到原生首页，纯 client、不需要权限 |
| `dev/folium/sample-playback-console` | 首页页面里的播放控制台：音量、静音与循环模式可调，`getQueue` 分页列出队列并用 `playQueueItem` 点播，订阅 `volumeChanged` / `loopModeChanged` / `queueChanged` / `failed`；main 入口把失败记录追加到 `api.storage.paths.data` 下的日志，在 `paths.cache` 放一个可重建的缓存；1.7：`replaceQueue` 把队列倒过来 |
| `dev/folium/sample-account-console` | Folium 1.7：设置区块里的 `secret` 字段（client 与 main 入口各读一次，只显示「已设置 / 未设置」）；main 入口定时和在 `rpc.handle` 里用 `api.rpc.send` 推消息，client 用 `folium.rpc.on` 收；`folium.account.getState()` 与 `account.changed`；实验接口 `platform.raw` 读 `user_record`（听歌排行），清单选用 `platform.raw`、声明 `platform.netease.read`；可以绑到系统级全局快捷键的命令（`globalShortcut`） |
| `dev/folium/sample-omni-console` | Folium 1.7：`folium.omni` 列出音源与 `supports`、搜歌并用 `nextCursor` 翻页、`describeSong` 与歌词前几行、专辑第一页曲目（`getAlbum` → `getTracks`）、把存进 `folium.storage` 的 `{ source, id }` 在重启后用 `resolveSongs` 解析回来；`playback.control` 只用于加入队列，`filesystem.data` 只用于存键 |
| `dev/folium/sample-equalizer-console` | Folium 1.7：设置分区里用 `folium.equalizer.getState()` 与 `equalizer.changed` 显示此刻听到的均衡器和最近一次变化的来源；`setMode` 切到内置音效、`applyCurve` 施加本模组的曲线、`releaseCurve` 撤下；「按歌自动施加」在换歌时施加曲线，来源是用户、命令面板或别的模组时停下（给用户让步），被拒 `panel-open` 时等 `writable` 变回 true 的那次 `equalizer.changed` 再补写；只有写需要 `equalizer.control`，纯 client |

## 安全声明（重要）

模组是**可信代码，不是沙箱**：`main` 入口运行在主进程，拥有完整 Node.js 权限；`client` 入口运行在
主界面所在的渲染进程，能读写界面里的一切。`mod.json` 的 `permissions` 是功能开关约定（未声明的 API
调用 fail closed），**不构成安全边界**。

- **两道开关**：「设置 → 模组」里的「模组系统」总开关决定加载器是否工作；总开关开启后，单个模组仍默认禁用，需逐个确认启用。
- **启用需二次确认**：主进程原生确认窗口列出模组 id、安装位置、声明的权限、界面代码入口、选用的实验接口、
  可嵌入的外部网页、需要的 Folia 版本与内容指纹，默认按钮为「取消」。窗口刻意不在渲染
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

扫描顺序见 `electron/modSystem/discovery.cjs` 的 `getModsDirectories`：开发版先扫仓库 `mods/`，
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
| `folium` | 必须是 `1` |
| `id` | `^[a-z0-9][a-z0-9-]*$`，全局唯一 |
| `version` | `MAJOR.MINOR.PATCH` |
| `main` / `client` | 都可选，至少一个。`main` 是模组目录下的单个 `.cjs/.js` 文件；`client` 是目录内的 `.mjs/.js` 相对路径。纯渲染端模组不写 `main`，Node 里就不执行它的任何代码 |
| `preview` | 可选。模组目录里的一张介绍图片（`.png` / `.jpg` / `.webp`），模组市场在卡片顶部以 16:9 展示；宿主只校验路径与扩展名。提交到 folium-compound 的模组必须提供，推荐 1280×720、不超过 1 MB |
| `depends` | 模组 id 或 `id@^1.2.3`（仅支持 `^` 与 `*`）。缺失、版本不符、成环或依赖未启用时，只有该依赖子图不加载 |
| `permissions` | 见下表。未知权限直接拒绝 |
| `embedOrigins` | `folium.ui.embed` 可以加载的 https origin（形如 `https://host[:port]`），需要 `net.embed` |
| `experimental` | 选用的实验接口：`omni.providers`、`omni.hooks`、`ponder.targets`、`player.layout`、`remote.actions`、`platform.raw`（1.7） |
| `folia` | 可选。宿主版本范围（空格分隔的比较式，支持 `>= > <= < = ^` 与 `*`）；宿主版本不在范围内时加载器拒绝加载（`host-version-mismatch`） |

| 权限 | 解锁 |
| --- | --- |
| `filesystem.data` | `api.storage.*`（main）与 `folium.storage.*`（client），两边共用一个数据文件；main 入口还有文件目录 `api.storage.paths`（`data` / `cache`） |
| `playback.read` | `api.runtime.getPlaybackSnapshot()`（main） |
| `render.export` | `api.render.exportVideo()`（main） |
| `playback.control` | `folium.playback` 的播放、暂停、跳转、切歌、入队、打乱队列、喜爱；1.5 起还有设置音量、静音、循环模式与点播队列里的歌 |
| `playback.queue` | 1.7：`folium.playback.replaceQueue`（整表替换播放队列，并结束私人 FM）。不需要同时声明 `playback.control` |
| `equalizer.control` | 1.7：`folium.equalizer` 的 `setMode`、`applyCurve`、`releaseCurve`（改写用户的音效设置） |
| `net.fetch` | `folium.net.fetch()`（经主进程代发，不受 CORS 限制） |
| `net.embed` | `folium.ui.embed()`，还需要 `embedOrigins` |
| `stageLayers` | `registries.stageLayers`（往播放页上画东西） |
| `platform.<平台>.read` | 1.7，实验：`experimental['platform.raw'].request` 以用户在 Folia 登录的账号调用这个平台的只读接口。目前只有 `platform.netease.read` |
| `platform.<平台>.write` | 1.7，实验：再加上会改动账号内容的接口（点赞、歌单、关注……）。目前只有 `platform.netease.write` |

两个 `platform.*` 权限都要在 `experimental` 里选用 `platform.raw`，声明 `write` 也必须同时声明 `read`，否则清单校验不通过、模组不加载。
启用确认窗口和模组面板的展开行会用一句话写明模组能以用户的账号读取（或改动）哪些平台的数据，见 [platform.raw](#platformraw实验17)。
启用确认窗口和模组面板的展开行也会为 `playback.queue` 写一句说明：模组可以一次换掉整个播放队列并结束私人 FM，替换后宿主会提示是哪个模组换的，在队列再被改动之前可以撤销。
密钥字段（`secret`）、`rpc.send` / `rpc.on`、`folium.account` 和 `folium.omni` 不需要权限。`folium.omni` 以你在 Folia 登录的平台账号向平台发请求，
启用确认窗口里不会为它多写一句，见 [folium.omni](#foliumomni17)。`folium.equalizer` 的读和 `equalizer.changed` 也不需要权限；
写需要 `equalizer.control`，启用确认窗口和模组面板会为它写一句「会改写你的音效设置」，见 [folium.equalizer](#foliumequalizer17)。

每个权限解锁的成员以 API 参考的[权限一览](../docs/folium/api.md#权限一览)为准，`npm run folium:check` 用同一张表查模组。
`platform.*` 例外：`folium:check` 只按代码里 `request('<平台>', …)` 写出的平台 id 查 `platform.<平台>.read`，平台 id 是变量时只提示一句，`.write` 查不到（要看调的接口）。
为 Folium 1.5 写的清单里的旧权限名和不认识的字段，在 1.x 里只提醒、不拒绝，见[仍可用的旧名字](../docs/folium/api.md#仍可用的旧名字)。

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
- **启动时限**：导入 `client` 加上 `activate`（返回 promise 的话，到它给出结果）一共 5 秒。超过了不算出错，算慢：宿主提示用户一次
  「过了 5 秒还没有启动完」，接着启动下一个模组；这次启动不会被取消，之后完成了，登记的条目照样生效，模组那一行写着启动用了多少秒并标「慢」。
  启动时抛错（不管是按时还是超时之后）才算出错；模组已经被禁用或被新代码换掉之后，旧的那次启动才抛的错不记在模组头上。
- **第一屏**：应用打开时第一屏最多等所有模组 1.5 秒，没启动完的在第一屏出来之后继续启动；存着的歌词样式或背景等它启动完自动换回来。
  晚启动的模组收不到第一首歌的 `lyrics.transform` 和 `playback.beforePlay`。导出窗口不设这 1.5 秒，等每个模组启动完（各自最多 5 秒）；
  要导出的歌词样式所属的模组那时还在启动，导出就一直等到它启动完（可以取消导出）；它启动时出了错、或者没有这个模组，导出报错停下。
- **错误隔离**：activate、每个事件处理器、每次 mount、经 `ctx` 和 `folium` 订的每个监听都在各自的错误边界里；出错只影响这个模组，
  错误列在模组面板里该模组的「界面代码出错」下：每个出错的地方一行，写着出错几次、最近一次的时间和原因。
- **出错提示**：模组的代码抛错（mount、绘制、监听、清理函数、activate）时，宿主提示用户一次，写明是哪个模组的哪一种条目；
  每次运行每个模组最多提示一次，用户可以对这个模组选不再提示（这一个选择同时管它出错和启动慢两种提示）。宿主不会因为出错停用、替换或取消选中任何东西。
  命令失败、音源方法失败、钩子超时或失败、模组自己调 `log.error` 是平常的结果：只记到那一行，不提示。
- **运行环境**：`folium.env.context` 是 `'main'`（主窗口）或 `'export'`（透明视频导出窗口）。导出窗口里
  只属于界面的注册表（[注册表一览](../docs/folium/api.md#注册表一览)里「导出窗口里」一列写着不生效的那些）
  是空实现——照常调用、不生效，所以同一份代码两边都能跑；服务（playback / ui / net / storage / secrets / account / omni / equalizer / rpc）
  在导出窗口里调用会抛 `*-unavailable-in-export-context`（返回 promise 的方法以这个错误拒绝）。例外：`ui.icon` 两边都能用；
  `rpc.on` 和 `secrets.subscribe` 照常收下监听、返回取消函数，但导出窗口里从不调用它们。
- `folium.host`：`{ folium: { major, minor }, folia: '<宿主版本>' }`，给显示和日志用。

### folium 对象一览

| 成员 | 说明 |
| --- | --- |
| `modId` / `host` / `env` / `log` | 基本信息与日志（`log.error` 会记到模组面板） |
| `registries.*` | 见[注册表](#注册表) |
| `events.on(type, handler, { priority })` | 见[事件](#事件)，返回取消函数 |
| `playback` / `ui` / `net` | 见[服务](#服务) |
| `storage.get/set/has/delete/keys` | 异步；需 `filesystem.data`；单模组数据上限 1 MB。更大的内容由 main 入口写成文件，放进 `api.storage.paths.data` |
| `secrets.get/has/set/subscribe` | 1.7。本模组 `secret` 设置字段的值，和 main 入口的 `api.secrets` 是同一份；不需要权限。见[密钥字段](#密钥字段secret17) |
| `rpc.call(name, ...args)` | 调用本模组 main 侧 `api.rpc.handle(name, fn)` 注册的函数；参数与返回值需可 JSON 序列化 |
| `rpc.on(name, listener)` | 1.7。收本模组 main 入口 `api.rpc.send(name, payload)` 发来的消息，返回取消函数。见 [main 入口向 client 推送消息](#main-入口向-client-推送消息17) |
| `account.getState(providerId?)` | 1.7。在线音源的登录状态，不需要权限。见 [folium.account](#foliumaccount17) |
| `omni.*` | 1.7。经 Omni 只读在线音源：搜索、按 `{ source, id }` 解析、歌词、专辑与歌手；不需要权限，以你在 Folia 登录的平台账号发请求。见 [folium.omni](#foliumomni17) |
| `equalizer.*` | 1.7。宿主的图形均衡器：`getState()` 读当前听到的均衡器（不需要权限）；`setMode` 切到宿主已有的音效、`applyCurve` 施加本模组的曲线、`releaseCurve` 撤下它（需 `equalizer.control`）。见 [folium.equalizer](#foliumequalizer17) |
| `every(ms, fn)` / `onDispose(fn)` | 定时调用、登记清理函数；模组停掉时宿主替它停掉定时、调用清理函数。见[现成的函数](../docs/folium/contributing.md#现成的函数) |
| `lyrics` / `theme` | 内置模式共用的函数，见[歌词与主题](#歌词与主题)；导出窗口里也能用。`lyrics.parse` 把歌词原文交给宿主解析；`lyrics.getLines()`、`lyrics.refresh()` 读正在显示的歌词（导出窗口里不能用） |
| `experimental[name]` | 选用了才能访问，否则抛 `experimental-not-declared:<name>` |

## 注册表

所有注册表同一种用法：`register(def)` 返回 `{ id, unregister() }`。`def.id` 是 `^[a-z0-9][a-z0-9-]*$`，
宿主加上命名空间成为 `<modid>:<id>`（类似 Forge 的 ResourceLocation）；同一模组内重复 id 被拒绝。

稳定的注册表有哪些，各自的用途、条目定义、需要的权限、在导出窗口里生不生效，都列在 API 参考的
[注册表一览](../docs/folium/api.md#注册表一览)里：那张表是从宿主的代码生成的，这里不再抄一份。下面各小节写每一种的规则。

实验性的两个不在那张表里：

| 注册表 | 用途 | 稳定性 |
| --- | --- | --- |
| `experimental['omni.providers']` | 在线音乐源 | 实验 |
| `experimental['ponder.targets']` | 思索（应用内教程）目标 | 实验 |
| `FoliumStageContext.getLayout()` | 播放页只读布局快照（需选用 `player.layout`） | 实验 |
| `experimental['remote.actions']` | 在独立遥控窗口末尾追加宿主绘制的按钮 | 实验 |

### 宿主托管容器

界面类条目都是 `mount(container, ctx) => dispose?`：宿主创建容器（面板、首页页面、图层、按钮放在 **ShadowRoot**
里，样式互不泄漏），通过继承的 CSS 变量传主题色：`--folium-bg`、`--folium-primary`、`--folium-secondary`、
`--folium-accent`、`--folium-font`；移除容器时调用 dispose。**模组不查询、不修改容器以外的宿主 DOM**，
也不需要轮询——生命周期全部由宿主管。

`mount` 可以是异步的（返回一个给出 dispose 的 promise）。每种 `ctx` 都有 `onChange`、`onFrame`、`onResize`、
`every`、`onDispose`；歌词动画和舞台图层的 `ctx` 还有 `onLyricTime`，进度条按钮和图层的有 `onPlaybackTime`。
用它们开的监听和定时器在挂载结束时由宿主停掉。每个函数的说明和例子见[现成的函数](../docs/folium/contributing.md#现成的函数)。

容器外层带三个属性，供思索的 `hoverSelector` 和 `dom` 锚点定位某一个条目：
`data-folium-owner`（模组 id）、`data-folium-kind`（这是哪一种条目的容器，如 `visualizer`、`panel-tab`；每种注册表的取值见
[注册表一览](../docs/folium/api.md#注册表一览)的最后一列）、`data-folium-entry`（带命名空间的条目 id，如 `visualizer52hz:rings`）。ShadowRoot 里面的元素
选择器够不到，只能指到这个外层容器。

### 设置 schema（FoliumSetting）

设置分区、visualizer / background 设置、tunings 的 `settings` 和命令的 `params` 共用一种字段声明：

```js
{ key: 'size', type: 'number', label: { 'zh-CN': '大小', en: 'Size' }, min: 0, max: 10, step: 0.5,
  defaultValue: 4, description: { en: 'tooltip' }, group: { en: 'Layout' } }
```

- `type`：`number`（滑块）/ `text` / `boolean` / `select`（需 `options: [{ value, label }]`）/ `color`（应用自己的取色器，值是小写的 `#rrggbb`）/
  `secret`（1.7，密钥，只能用在设置分区里，见[密钥字段](#密钥字段secret17)）。
- `group` 相同的字段放在同一个小标题下。没写 `step` 的数值：上下界都是整数按 1，否则按 0.01。
- schema 是值的唯一来源：读到的值**已合并默认值**，写入时按 schema 校验（未知键丢弃、数值夹到范围内、
  select 必须是声明过的选项）；非法字段声明（重复 key、未知类型、类型不对的默认值……）会被丢弃，「设置 → 模组」里这个模组那一行写明是哪个、为什么。
- 值持久化在宿主，并随「视觉配置」导入导出一起走，也会带进导出窗口。`secret` 字段的值除外：它不在这些值里。

### visualizers

```js
folium.registries.visualizers.register({
  id: 'aurora-text',
  label: { 'zh-CN': '虹光', en: 'Aurora' },
  order: 420,
  mount(container, ctx) { /* … */ return () => { /* dispose */ }; },
  settings: [/* FoliumSetting[]，可选 */],
  settingsPanel(container, panelCtx) { /* 可选：自绘设置面板，值仍按 settings 存 */ },
  hostLayers: { background: true, subtitles: true },   // 缺省都是 true
});
```

模式 id 是 `mod:<modid>:<id>`。`mount` 拿到的 `FoliumStageContext`：

| 成员 | 说明 |
| --- | --- |
| `lines` / `song` / `staticMode` / `staticLineIndex` | 本次挂载内不变的快照；`lines` 的结构见[歌词与主题](#歌词与主题) |
| `seed` | 内置模式用的几何种子（当前歌曲 id，没有时是按模式的回退值），预览、播放、导出一致；拿它做种子，随机结果与内置模式同步变化 |
| `isPreview` | 是否在设置预览里渲染 |
| `lyricTime.get()` / `onLyricTime(cb)` | 歌词时钟（秒）：歌词行的时间按它算。它可以和播放位置不同（用户调了歌词偏移、舞台源）；预览里是预览自己的时钟 |
| `getDuration()` | 歌曲长度（秒），还不知道时是 0，知道了 `onChange` 会通知 |
| `getLineIndex()` / `isPaused()` / `getTheme()` / `getSettings()` / `getSurface()` | 随时读取，每帧读也没问题 |
| `getSubtitleTheme()` / `getCoverUrl()` / `getDisplay()` | 字幕主题（没有单独的字幕主题时等于 `getTheme()`）、封面地址、显示设置。`getDisplay()` 的字段与内置模式收到的同名 prop 一致：`showText`、`lyricsFontScale`、`subtitleFontScale`、`subtitleOverlayOpacity`、`subtitleOverlayBackground`、`subtitleUpcomingLyricsBlur`、`showHarmonySubtitle`、`harmonySubtitleBackground`、`showSubtitleTranslation`、`hideTranslationSubtitle`、`subtitleContentMode`、`isPlayerChromeHidden`、`isPanelOpen`、`visualizerOpacity`；值不变时返回同一个对象 |
| `getLayout()`（实验） | 选用了 `player.layout` 时读取播放页布局与安全边距；未选用、预览、OBS 或导出中返回 `null`，见 [player.layout](#playerlayout实验只读) |
| `onChange(cb)` | 行号、暂停、主题、字幕主题、封面、显示设置、模组设置、表面、时长任一变化时回调；选用了 `player.layout` 时也通知布局变化（暂停时时钟不走，靠它得知变化） |
| `audio` | 音频分析：`getPower()`、`getBands()`（`bass` / `lowMid` / `mid` / `vocal` / `treble`）都是 0..1；`getSpectrum()` 是原始 FFT 幅值（0–255）或 `null`。每帧都在变且不通知，在自己的帧循环里读；`getBands()` 每次返回同一个对象、原地刷新，要保留读数就复制。预览里是宿主生成的模拟信号，静音或没有分析器时读到 0 |

- **只在歌词数据、歌曲、`staticMode` 或静态预览行变化时重挂载**；换行不会重挂载，行号从 `getLineIndex()` 读。
- `hostLayers.background`：宿主在你下面画用户选的背景；`getSurface().hostBackground` 为真时，画满整屏且不透明
  的模组应自己让位。`hostLayers.subtitles`：宿主在上面画底部字幕（翻译 / 下一句），走用户的字幕设置。
- `settingsPanel` 必须配合 `settings`：它只替换「画法」，键、默认值和校验仍由 schema 决定，面板通过
  `panelCtx.settings`（`get / set / reset / onChange`）读写。
- 用户的全局歌词字号是 `getDisplay().lyricsFontScale`，内置模式都乘上它；模组关掉 `hostLayers.subtitles`
  自己画字幕时，字幕相关设置也从 `getDisplay()` 读。
- 舞台图层（stageLayers）拿到同一种上下文：显示设置读自播放页正在用的设置，`seed` 是当前歌曲 id；
  `getSubtitleTheme()` 等于 `getTheme()`，`hideTranslationSubtitle` 恒为 `false`。

### 歌词与主题

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
| `backgroundVocals` | 和声，结构同一行（`text`、时间、`words`、`agentId`、翻译……） |
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
| `lyrics.parse(track)` | 异步。按本地歌词文件的流程解析[歌词原文](#歌词原文)，得到 `{ lines, isWordByWord }` |
| `theme.resolveFontStack(theme)` / `resolveTranslationFontStack(theme)` | 歌词 / 翻译字幕的 CSS `font-family` 值 |
| `theme.resolveFontWeight(theme, fallback)` | 规范化后的字重 |

`folium.lyrics` 另有两个读正在显示的歌词的成员，导出窗口里调用会抛 `lyrics-unavailable-in-export-context`：
`getLines()` 返回屏幕上现在的行（没有时是空数组），比 `lyrics.loaded` 晚启动的模组先读一次，再跟着 `lyrics.loaded` 走；
`refresh()` 用这首歌没改写过的歌词重跑一遍 `lyrics.transform` 并显示结果，不发 `lyrics.loaded`。

#### 歌词原文

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
folium.registries.tunings.register({ id: 'deep', target: 'sonnet', label: {…}, settings: [{ key: 'cameraScale', type: 'number', min: 0, max: 3 }] });
```

只接受目标声明过的数值键，范围取两者交集；**同一目标的同一个键只归一个模组**，后注册的冲突项被丢弃并报告。
卡片出现在目标模式的设置卡片下面，值持久化并进入导出。

### backgrounds

`mount(container, ctx: FoliumBackgroundContext)`，没有歌词和时钟：`staticMode`、`isPaused()`、`getTheme()`、
`getSettings()`、`getCoverUrl()`、`audio`（同上），`onChange()` 在暂停、主题、设置、封面变化时回调。可带 `settings` / `settingsPanel`。
透明表面（OBS、透明导出）下宿主不渲染背景。

### stageLayers（需 `stageLayers`）

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
section.settings.get();           // 当前值（已合并默认值）
section.settings.onChange(fn);    // 值变化时回调
```

显示在模组面板里：展开该模组即可看到，位于它的命令卡片上方。导出窗口里同样可用（只读值）。

#### 密钥字段（secret，1.7）

用户要填自己的 API 密钥、令牌这类东西时，用 `type: 'secret'`，不要用 `text`，也不要用 `settingsPanel` 自绘再存进 `folium.storage`：
`text` 的值和其它设置值存在同一张表里，随视觉配置导出、交给导出窗口，设置页也是明文显示。

```js
const section = folium.registries.settingsSections.register({
  id: 'service', label: { 'zh-CN': '服务', en: 'Service' },
  settings: [
    { key: 'apiKey', type: 'secret', label: { 'zh-CN': 'API 密钥', en: 'API key' }, placeholder: 'sk-…' },
    { key: 'model', type: 'text', label: { en: 'Model' }, defaultValue: 'default' },
  ],
});
section.settings.get();                    // { model: 'default' }：没有 apiKey
const key = await folium.secrets.get('apiKey');   // 字符串，没填时是 null
folium.secrets.subscribe((changedKey) => { /* 只给 key，不给值 */ });
```

- **只能用在设置分区里。** visualizer / background 的设置、tunings、命令参数里的 `secret` 字段按未知类型丢弃，「设置 → 模组」里这个模组那一行写明原因。
- **表单**：密码输入框，保存后不再显示值，只显示「已设置 / 未设置」和「清除」；宿主从不把存着的值取回窗口里画。
  「恢复默认」不动密钥，分区里只有 `secret` 字段（又没有 `settingsPanel`）时不显示这个按钮。`secret` 字段的 `defaultValue` 被忽略。
- **值不是分区设置值的一部分**：`settings.get()` 里没有它，`settings.set` 忽略它，它不进视觉配置的导入导出、导出窗口和日志。
  导入的视觉配置里带了同名字段时直接忽略。字段原来是 `text`、改成 `secret` 之后，表里存着的旧值被删掉，不会搬进密钥存储：它可能已经随配置导出过，让用户重新填一次。
- **读写**：client 用 `folium.secrets`，main 入口用 `api.secrets`，两边和设置表单是同一份，只能读写本模组自己的，不需要权限。
  - `get(key)` 给值或 `null`（没填，或系统的凭据存储暂时解不开）；`has(key)` 只说有没有；`set(key, value)` 存，`null` 或空串清除；
    值必须是字符串，最长 8 KB（UTF-8），超了拒绝为 `secret-too-large:8192`。
  - `subscribe(listener)` 在任何一方（设置表单、client、main 入口）存或清除之后调用，参数只有 key；模组停掉时宿主替你取消。
  - key 必须是本模组某个设置分区里声明为 `secret` 的，否则拒绝为 `secret-undeclared:<key>`。宿主是在 client 登记分区时才知道这些 key 的，
    而每次启动 Folia，main 入口都比 client 先启动：client 登记之前，存着值的 key 照常读写，没有值的 key `get` 给 `null`、`has` 给 `false`，
    `set` 它拒绝为 `secret-undeclared:<key>`（等 client 登记之后再写）。同一次运行里重载模组不受影响，宿主还记得这些 key。
  - 导出窗口里 `get` / `has` / `set` 拒绝为 `secrets-unavailable-in-export-context`，`subscribe` 从不调用。
- **存在哪**：主进程用系统的凭据存储加密（Windows 的 DPAPI、macOS 的钥匙串、Linux 的 libsecret 或 kwallet），只有密文写进
  `<userData>/mods-data/<id>/secrets.json`（在 `api.storage.paths.data` 之外，算进模组面板的「数据」占用）。
  系统没有可用的凭据存储（Linux 退回 `basic_text`）时只放内存，本次运行有效，表单会提示重启后要重新填；这时不会明文写盘。
- **兼容**：Folium 1.6 的宿主不认识 `secret`，会丢掉这个字段；分区丢完字段一个不剩时 `register` 抛错。声明之前先检查 `folium.host.folium.minor >= 7`。

### commands

```js
folium.registries.commands.register({ id: 'toggle', label: {…}, description: {…}, keywords: ['…'], params: [...], run: async ({ values }) => result });
```

出现在模组面板（带参数表单）与命令面板：无参数的命令直接执行；有参数的打开表单。`run` 在渲染端执行，
需要 Node 的工作请经 `folium.rpc` 交给 main。返回值会作为结果摘要显示（字符串、`{ outputPath }` 或 `{ message }`）。

#### 系统级全局快捷键（globalShortcut，1.7）

```js
folium.registries.commands.register({
  id: 'ping', label: { en: 'Ping main entry', 'zh-CN': '让 main 入口回一声' },
  globalShortcut: true,
  run: async () => { const reply = await folium.rpc.call('ping'); folium.ui.toast(String(reply)); },
});
```

标了 `globalShortcut: true` 的命令会出现在桌面版「设置 → 快捷操作 → 全局快捷键」每个槽位的命令下拉框里，排在宿主的播放命令后面，
名字前面带模组名。键由用户自己按出来：修饰键随意组合（Ctrl、Alt、Shift、Win/Command，至少一个），再加一个字母、数字、功能键、
空格、方向键，或者退格、删除这类单键，共 5 个槽位；没有修饰键的组合、重复组合、GNOME 占用的 Ctrl+Alt+Shift+R、被别的程序占用的组合都按宿主的规则在设置里显示。
模组看不到也选不了键，所以不需要权限，也不在确认窗口里申报：用户绑键这一步就是同意。

- 只对没有 `params` 的命令有效（按一下键填不了表单）；带参数的命令宿主忽略这个标记，在控制台提醒一次。
- 按下时执行 `run`，`values` 是空对象；结果不显示，需要反馈时自己用 `folium.ui.toast`。`run` 抛错或 reject 记进模组面板里这个模组的故障记录，不弹窗。
- Folia 在后台时也会触发，所以只放不看窗口也说得通的动作。
- 模组停用、卸载或还在启动时，绑定保留但键不注册，设置行显示「模组未启用」；命令重新登记后自动恢复，不用重绑。
  模组运行着却不再提供这条命令（改了 id、去掉标记、加了参数）时，设置行显示「模组现在没有提供这条命令」。
- 原生 Wayland 下暂不提供：那里由桌面环境的快捷键门户（portal）接管，宿主交过去的是固定的播放命令整表，设置页不列模组命令。
- 不要在 main 入口 `require('electron').globalShortcut` 自己注册热键：会绕开上面这些规则，在 Windows 上独占别的程序的组合键，
  还可能先占走宿主自己的键；`globalShortcut.unregisterAll()` 会把宿主的键一起清掉。媒体键归宿主的 Media Session，不要抢。

### playerPanelTabs

`mount(container, ctx: FoliumPanelContext)`；标签用拼图图标，标题取 `label`。`folium.ui.openPlayerPanel('<id>')`
可以直接打开它。模组停用时若正开着它，面板回到封面页。

### homeTabs

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

### progressButtons 与 progressLayers

两者共用 `FoliumProgressContext`：`playbackTime`（播放时钟，`seek` 收的就是这个时间）和 `onPlaybackTime(cb)`、`getDuration()`、
`timeToRatio(t)`、`seek(t)`、`getColors()`（宿主进度条的颜色）、`onChange()`（时长或颜色变化）。三处进度条（悬浮控件两处、Lattice）
都渲染同一个宿主组件，所以扩展会同时出现在三处。

- `progressButtons`：`slot` 为 `progress.leading` 或 `progress.trailing`，容器按内容大小排布。
  `hideWhenCollapsed: true` 让按钮不出现在收起状态的悬浮胶囊里，只在展开的胶囊和 Lattice 显示；
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

**公开变量**：`--folium-player-bar-extra`（长度，默认 `0px`）把悬浮胶囊加宽这么多，展开和收起两种状态都生效，
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
| `playback.likeChanged` | `{ liked }`，`getState().liked` 变了（喜爱、取消喜爱，或换到喜爱状态不同的歌） |
| `playback.volumeChanged` | `{ volume, muted }`，音量或静音开关变了，不论是谁改的；`volume` 在 0–1 |
| `playback.loopModeChanged` | `{ mode }`：`'off'`、`'all'`（列表循环）或 `'one'`（单曲循环） |
| `playback.queueChanged` | `{ length, currentIndex, version, byThisMod }`，队列变了或显示中的歌在队列里换了位置；只是轮廓，歌曲用 `playback.getQueue()` 读。同一个任务里的多次变化合成一次，不按载荷去重（打乱后长度和位置可能都没变）。1.7 起多出 `version`（队列版本，和 `getQueue()` 的一样）与 `byThisMod`（只在本模组 `replaceQueue` 排出的那一个事件里为 `true`，见 [replaceQueue](#服务)）；automix 过渡结束时也发一次 |
| `playback.failed` | `{ song, reason, phase, willAutoSkip }`，一首歌放不了，见下 |
| `account.changed` | 1.7。`FoliumAccountState`（`{ providerId, status, user, accountKey }`），某个在线音源有人登录、退出或换了号，见 [folium.account](#foliumaccount17) |
| `equalizer.changed` | 1.7。`{ state, origin }`：均衡器变了（开关、模式、增益、`hostPlaysAudio`、`writable`），`origin` 说是谁改的（`user` / `command` / `mod` / `host`），同一任务合成一次。见 [folium.equalizer](#foliumequalizer17) |

**`playback.failed`**只在用户看得见「这首歌放不了」时报一次：

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

- `enqueue(song)` 和宿主自己的「加入队列」一样，按用户的「加入队列方式」设置加（下一首或最后）：已经在队列里的歌挪过去、不加第二遍，
  正在放的歌和平台标了不可用的歌不加，提示由宿主给出。`ref` 不认识时返回 `false`，其余返回 `true`（队列没变也是）。
- `shuffleQueue()` 打乱播放队列，当前歌曲留在最前；私人 FM、队列只有一首、外部 Stage 播放时不动，返回 `false`。
- `toggleLike()` 喜爱或取消喜爱正在显示的歌，和宿主的喜爱按钮相同，结果提示也由宿主给出；`canLike` 为 `false` 时
  （没有歌、来源不支持、Stage 播放、播放控制被禁用）不动，返回 `false`。`liked` 的变化见 `playback.likeChanged` 事件。

- `seek(seconds)` 跳到**播放时间**；`seekToLyricTime(seconds)` 跳到**歌词时间**，也就是内置模式点击歌词行的行为：
  传 `line.startTime` 即可，宿主负责换算歌词偏移、处理只有歌词的舞台源，播放控制被禁用时忽略。歌词有偏移时
  `seek(line.startTime)` 会跳偏，所以点歌词跳转一律用 `seekToLyricTime`。visualizer 容器本身接收指针事件，
  在自己的元素上监听点击即可；在预览里（`ctx.isPreview`）不要触发跳转。

1.5 补全了音量、循环模式和播放队列。读取不需要权限（和 `getState` 一样只要求在主窗口），写入需要 `playback.control`；1.7 的 `replaceQueue` 需要 `playback.queue`：

- `getVolume()` 返回 `{ volume, muted }`，`volume` 在 0–1，静音开关独立于音量。`setVolume(volume)` 夹到 0–1，和宿主的音量滑块一样，
  不动静音开关；每次调用都会保存，所以只设最终值，不要拿它做渐变。`setMuted(muted)` 是设值而不是切换，两边同时操作不会互相抵消。
  参数不是有限数 / 布尔值时抛错。
- `getLoopMode()` / `setLoopMode(mode)`：`'off' | 'all' | 'one'`。设成新值时宿主像点自己的循环按钮一样弹提示；设成当前值什么都不做；
  未知值抛错。外部 Stage 播放时也能设，循环模式是持久的偏好。
- `getQueue({ offset, limit })` 返回队列的一页 `{ items, length, currentIndex, kind, version }`：
  - `items` 是 `{ song, index }[]`，`index` 是在整个队列里的位置，`version` 一变就过期（见 `playback.queueChanged`）。
  - `length` 是整个队列的长度；`currentIndex` 是显示中的歌在队列里第一次出现的位置，不在队列里时为 -1。
  - `kind`：`queue`；`fm`（私人 FM，队列是当前这一批）；`stage`（外部 Stage 播放，队列与正在播放的内容无关）。
  - `limit` 缺省 500，也最多 500，最少 1；不传 `offset` 时这一页以显示中的歌为中心（不在队列里时从头取），传了就夹到 `[0, length]`。
    给了却不是有限数的 `offset` / `limit` 抛错，小数向下取整。
  - 歌曲的 `ref` 和其它歌曲 DTO 共用一个 5,000 条的池，最久没被交出去的先失效：刚读到的这一页里每个 `ref` 都有效。
    所以只读要显示的那几页，不要一次读完整个队列。
  - 1.7：`version` 是队列的版本。字符串相同，就是同样的歌、同样的顺序、同样的 `kind`；只是显示中的歌换了位置时不变。它不透明、只在本次
    会话有效：交给 `replaceQueue`，不要存起来。真要读完一个长队列，就在 `version` 不变的前提下翻页；某一页的 `version` 变了，说明队列变了，从头再读。
- `playQueueItem(index, expectedRef?)` 播放队列里的第 `index` 项，播放和跳转与在宿主队列面板里点它相同；没播成时，失败提示里的
  “重试”和“跳过”按按下那一刻的队列走。私人 FM 下宿主面板不列队列，用它点播不退出 FM。
  给了 `expectedRef` 时，那个位置已经不是这首歌（两次调用之间队列变了）就不动、返回 `false`；比较的是同一首歌，宿主开播时把队列项
  换成等值副本，之前拿到的 `ref` 照样认得。越界、外部 Stage 播放、`ref` 已失效时也返回 `false`。`index` 不是整数、没有 `playback.control`
  时返回的 Promise 被拒绝。

**`replaceQueue(songs, { expectedVersion })`**（1.7，需要 `playback.queue`，不需要 `playback.control`）一次换掉整个播放队列，给一起听、
跨设备恢复这类要让本机队列「等于一份给定列表」的模组用：

- **条件提交**：`expectedVersion` 必填，是你最后读到的 `getQueue()` 那一页或 `playback.queueChanged` 事件里的 `version`。队列已经不是那个版本就
  什么都不动，答 `stale-version`。想盲写也得先读一次 `getQueue().version`，默认的路径是安全的。
- **全有或全无**：校验和写入在宿主的同一个同步块里，要么整个换掉，要么一点不变，中间不会插进别的写入。返回的 Promise 目前立即兑现。
- **不切歌**：正在放的歌接着放，播放 / 暂停不变。它不在新队列里时 `currentIndex` 是 -1，下一首（包括播完自动下一首）从新队列第一首开始，
  和用户在面板里删掉正在放的那首一样；这时从这首到第一首是普通切歌，没有 automix 过渡，也没有预取。这首歌之后被重试（失败提示里的「重试」）
  或被宿主重载（本地歌换了歌词）时，宿主可能把它放回队首，这会以 `byThisMod: false` 的 `queueChanged` 到达。
- **原样放进去**：顺序照给的；同一首给两次就是两次（宿主按第一次出现的位置找当前歌）；平台标了不可用的歌也留着，轮到它时宿主照常处理；
  不受用户「加入队列方式」影响。
- **结束私人 FM**：和「播放一个列表」一样，替换后 `kind` 是 `queue`。不在 FM 里、和现在的队列同歌同序时什么都不做，答 `replaced` 和原来的版本。
  空数组清空队列。
- **上限 5,000 首**，等于 ref 池的大小（见 `getQueue`）：每个 `ref` 都得还认得，所以替换之前现取。`getQueue` 一页最多 500，读完 5,000 首的队列
  要在同一个 `version` 下翻 10 页，而队列、别的模组和 `folium.omni` 都在用这个池，`ref` 会被挤掉；镜像当前歌附近的一个窗口，比镜像一整张很长的
  队列稳。
- **拒绝靠返回值**：`{ status: 'refused', reason, version, index, retryAfterMs }`，`version` 是此刻的版本，`index` 只有歌曲那两种原因有，
  `retryAfterMs` 只有 `rate-limited` 有，其余为 `null`。按下表从上到下检查，第一条成立的就是原因；歌曲从 `songs[0]` 往后查，第一首不行的
  那首说了算（下标优先：`songs[0]` 是 Stage 的歌、`songs[3]` 的 `ref` 过期，答 `not-queueable`、`index: 0`）。以后的 minor 可能新增原因，
  不认识的按 `transition` 处理。

| 原因 | 什么时候 | 模组该怎么办 |
| --- | --- | --- |
| `stage` | 外部 Stage 播放占着播放器 | 等一个 `queueChanged`，`getQueue().kind` 不再是 `stage` 时再试 |
| `transition` | automix 过渡中（几秒，很少超过半分钟） | 等 `queueChanged` 再试：过渡结束时宿主一定发一个；过渡中途也可能来一个（下一首落进队列），那时再试可能又答 `transition`，接着等 |
| `stale-version` | 队列已经不是 `expectedVersion` 那一个（用户、宿主或别的模组改了它） | 重读、重新决定；不要拿新版本直接盲写 |
| `stale-ref` | `songs[index]` 的 `ref` 已经认不出 | 重新取那首歌的 DTO |
| `not-queueable` | `songs[index]` 不能进播放队列（外部 Stage 的歌） | 去掉它 |
| `rate-limited` | 本模组上一次替换不到 1 秒 | `retryAfterMs` 之后用最新的列表再提交 |

- **调用写错才拒绝 Promise**：`songs` 不是数组或超过 5,000 首、某一项不是宿主给的歌曲 DTO（没有 `ref`，或者是 `folium.omni` 的专辑 / 歌手 DTO、
  自己拼的对象）、没给 `expectedVersion` 字符串，都拒绝 `TypeError('invalid-arguments: …')`，不带 `code`；传错了种类重读也修不好，所以不算 `stale-ref`。
  没声明 `playback.queue` 拒绝 `permission-denied:playback.queue`（声明了 `playback.control` 也一样），导出窗口里拒绝
  `playback-unavailable-in-export-context`。
- **提示与撤销**：替换后宿主的提示条写明是哪个模组换的，带「撤销」按钮；提示条一次只有一条、会被别的提示顶掉，所以命令面板里另有「撤销模组替换的
  队列」。在队列再被改动之前都能撤销；同一个模组连续替换，撤销回到它第一次替换之前用户的队列，私人 FM 也一起还回去（显示的歌还是当时那首的话）。
  撤销以 `byThisMod: false` 的 `queueChanged` 到达。替换和宿主自己的编辑一样，存进上次播放的记录。
- **防回声**：`queueChanged` 的 `byThisMod` 只在本模组这次 `replaceQueue` 排出的那一个事件里为 `true`，而且要你在替换的那一刻就在听；别的模组、
  用户的改动（包括撤销）、只是显示的歌换了位置，都是 `false`。同步模组靠它不把自己的替换当成用户的改动再广播出去。
- **能力探测与 1.6**：`folium.host.folium.minor >= 7 && typeof folium.playback.replaceQueue === 'function'`。1.6 的宿主没有这个方法，而且声明了
  `playback.queue` 的清单在 1.6 上整份被拒、模组根本不加载：要兼容 1.6 的模组不能声明它。main 入口没有 `replaceQueue`，用 `api.rpc.send` 让
  client 去调，再 `folium.rpc.call` 把结果交回（结果是纯数据）。

一个同步模组的骨架（读 → 计算 → 提交 → 按原因重试），`resolve`、`broadcast` 和收到别的设备队列的 `onRemoteQueue` 是模组自己的。
`version` 在做决定的那一刻读（收到远端队列时、或者重试时的那个 `queueChanged`），**在 `await resolve` 之前**：之后谁改了队列，
提交都答 `stale-version`，不会被悄悄盖掉。先 `await` 再读版本，读到的永远是此刻的版本，条件提交就成了盲写。

```js
let waiting = null;
// `version`：决定这次替换时读到的队列版本，重试同一个决定时沿用它
const sync = async (wanted, version) => {
  const songs = await resolve(wanted);            // 例如 folium.omni.resolveSongs，换成宿主的歌曲 DTO（要等网络）
  const result = await folium.playback.replaceQueue(songs, { expectedVersion: version });
  if (result.status === 'replaced') return;
  if (result.reason === 'rate-limited') setTimeout(() => sync(wanted, version), result.retryAfterMs);
  else if (result.reason === 'stale-ref') void sync(wanted, version);  // 重新取歌，还是同一个决定
  else if (result.reason === 'not-queueable') { /* songs[result.index] 放不进队列：去掉它再提交 */ }
  else if (result.reason === 'stale-version') { /* 决定之后有人改了队列（也可能在 resolve 期间）：重新决定要不要覆盖它 */ }
  else waiting = wanted;                           // stage、transition 和以后的新原因：等 queueChanged，每次被拒都接着等
};
onRemoteQueue((wanted) => sync(wanted, folium.playback.getQueue({ limit: 1 }).version));
folium.events.on('playback.queueChanged', (event) => {
  if (event.byThisMod) return;                     // 自己的替换，不再广播
  if (waiting) {
    if (folium.playback.getQueue({ limit: 1 }).kind === 'stage') return;  // 还是 Stage 的队列：接着等
    const wanted = waiting;
    waiting = null;
    void sync(wanted, event.version);              // 在这个事件上重新决定
    return;
  }
  broadcast(event.version);                        // 把本机的改动告诉别的设备
});
```

**`folium.ui`**：

| 方法 | 说明 |
| --- | --- |
| `toast(message, { type, durationMs })` | 提示条 |
| `openPlayerPanel(tabId?)` | 打开播放器面板，可指定本模组注册的标签 |
| `openHomeTab(tabId)` | 切到首页并打开本模组注册的首页页面；没注册的 id 抛 `home-tab-not-registered:<id>`。见 [homeTabs](#hometabs) |
| `navigate('home' \| 'player')` | 页面导航 |
| `openVolume()` | 打开宿主的音量面板（命令面板里的音量命令） |
| `pickFile({ accept: 'video' \| 'audio' \| 'image' \| 'any', persist })` | 原生选择框；返回 `{ url, name, size }` 或 `null`。`url` 是本次会话有效的 `folia-mod://_files/...`，支持 Range，可直接做 `<video>` 的 src。`persist: true` 时宿主记住这次选择，返回值多一个不透明的 `grantId` |
| `restoreFile(grantId)` | 把之前 `persist` 选中的文件换成本次会话的新句柄（含同一个 `grantId`）；授权不属于本模组或文件已不存在时返回 `null`，后者的授权随即作废。模组始终拿不到文件路径 |
| `releaseFile(grantId)` | 放弃授权；已经发出的 URL 本次会话内仍然有效 |
| `embed(container, url, { title, allow })` | 在容器里建一个沙箱 iframe；origin 必须在 `embedOrigins` 里，需 `net.embed`。返回移除函数 |
| `icon(name, { size, strokeWidth, color })` | 宿主的 lucide 图标，名字与 lucide.dev 一致（如 `play`、`skip-forward`）；异步，得到一个新建的 `<svg>` 元素，归模组所有，未知名字得到 `null`。默认 24px、描边 2、颜色 `currentColor`（跟随周围文字）。导出窗口里也能用。宿主只承诺图标名，图形随宿主的 lucide 版本更新 |

> 持久授权按模组 id 保存（每个模组最多 32 条，超出时丢弃最旧的），要跨重启使用就把 `grantId` 存进 `folium.storage`（需 `filesystem.data`）。

> 打包版从 `file://` 加载页面，部分站点（例如 YouTube）会因为缺少 Referer 拒绝播放（YouTube 报错 153），
> 页面本身能加载。补 Referer 是后续改进。

**`folium.net.fetch(url, { method, headers, body, timeoutMs })`**：需 `net.fetch`；在主进程发出，只允许 http(s)，
超时默认 15s（最长 60s），响应体上限 5 MB；返回 `{ ok, status, statusText, headers, text(), json() }`。

### folium.account（1.7）

在线音源的登录状态，不需要权限。`getState(providerId?)` 返回冻结的 `FoliumAccountState`：

| 字段 | 说明 |
| --- | --- |
| `providerId` | 音源，即 Omni provider id（和 `FoliumSong.source` 同一套名字） |
| `status` | `signed-in`：有账号登录；`signed-out`：没人登录，或这个音源本来就没有账号（模组自己的音源）；`unknown`：宿主还不知道，比如启动时还在问平台，或者问不到 |
| `user` | `{ nickname, avatarUrl? }`，只有宿主自己也显示的昵称和头像；没登录时是 `null` |
| `accountKey` | 登录账号的不透明键，没登录时是 `null`。同一个账号在这台安装上总是同一个键，重启也不变；换一个账号就是另一个键 |

- 不传 `providerId` 读宿主当前选中的音源；宿主不认识的 id 返回 `null`。状态和宿主界面上显示的一致：界面显示着用户的就是 `signed-in`。
- 不含用户 id、cookie、token 和会员等级。`accountKey` 推不回用户 id，用它给自己存的数据分账号，换号后丢掉旧键下的数据。
- `account.changed` 事件的载荷就是新的状态：登录、退出、换号时每个音源发一次，同一个任务里的多次变化合成一次；只改昵称或头像不发，
  同一个任务里退出又登回原账号也不发。状态从 `unknown` 定下来时也发（通常是启动后不久宿主问完了平台），这时可能还是原来那个账号，
  丢数据前先比较 `accountKey`。宿主换了选中的音源不发这个事件（每个音源各自的状态没变），要跟着选中的音源走就在用的时候读 `getState()`。
- 只在主窗口可用：导出窗口里 `getState` 抛 `account-unavailable-in-export-context`，`account.changed` 不发。Folium 1.6 的宿主没有 `folium.account`，先检查 `folium.host.folium.minor >= 7`。

### folium.omni（1.7）

经宿主的 Omni 只读在线音源的公开数据：搜歌、按存下的 id 找回歌、读歌词、从一首歌走到它的专辑和歌手。拿到的歌带宿主的 `ref`，
原样交给 `folium.playback.playSong` / `enqueue`（这两个要 `playback.control`）就能放、能入队。`folium.omni` 本身不需要权限，只在主窗口可用。

```js
export default function activate(folium) {
  // 1.6 的宿主没有 folium.omni；导出窗口里它的每个方法都报错。
  if (folium.host.folium.minor < 7 || folium.env.context !== 'main') return;
  const { omni } = folium;

  async function firstHit(query, signal) {
    const page = await omni.searchSongs(query, { limit: 20, signal });    // 当前选中的音源
    const song = page.items[0];
    if (!song) return null;
    const details = omni.describeSong(song);                              // 同步，不问平台
    const lyrics = await omni.getLyrics(song, { signal });                // lines 和 lyrics.parse 的一样
    const next = page.nextCursor && await omni.searchSongs(query, { cursor: page.nextCursor, signal });
    return { key: { source: song.source, id: song.id }, details, lyrics, next };   // 存 key，不存 ref
  }

  async function playSaved(key) {                                         // 下次启动时
    const [resolution] = await omni.resolveSongs([key]);
    if (resolution.status === 'found') await folium.playback.playSong(resolution.song);
  }
}
```

| 方法 | 做什么 | 问不问平台 |
| --- | --- | --- |
| `listProviders()` | 本机的在线音源：id、名字、来自宿主还是模组、是不是当前选中的、配好了没有、支持哪些方法（`supports`） | 同步，不问 |
| `searchSongs(query, { providerId, cursor, limit, signal })` | 在指定的音源、或宿主当前选中的音源搜歌，一页一页读 | 每页最多一次 |
| `resolveSongs(keys, { signal })` | 把存下的 `{ source, id }` 找回成宿主的歌，一次 1–50 个 | 按音源分组：能一次查多首的音源一批一次（网易云一批 50 个，QQ 音乐一批 25 个），不能的每个键一次；可能用宿主最近读到的回答，不问 |
| `describeSong(song)` | 时长、封面、可用性、平台上的网页地址 | 同步，不问 |
| `getLyrics(song, { signal })` | 平台给的歌词，宿主解析好的行 | 一次 |
| `getAlbum(song, { signal })` / `getArtists(song, { signal })` | 这首歌的专辑 / 歌手 | 最多一次（歌上带着的不问） |
| `resolveCollection({ source, kind, id }, { signal })` | 按存下的键取专辑或歌手，带平台给的详情 | 一次 |
| `getTracks(collection, { cursor, limit, signal })` | 专辑的曲目、歌手的歌，一页一页读 | 每页最多一次 |
| `getArtistAlbums(artist, { cursor, limit, signal })` | 歌手的专辑，一页一页读 | 每页最多一次 |

**命名**：说「歌或集合来自哪里」的字段叫 `source`（`FoliumSong.source`、`FoliumSongKey.source`、`FoliumCollection.source`、`FoliumCollectionKey.source`），
说「音源本身」的叫 `providerId`（`listProviders()` 每项的 `providerId`、`searchSongs` 的 `options.providerId`，和 `FoliumAccountState.providerId` 一样）。
两者是同一套 Omni provider id，值可以直接互用。音源信息的类型叫 `FoliumOmniProviderInfo`；实验接口里模组自己定义音源用的 `FoliumOmniProviderDef` 是另一回事。

**以登录的账号发请求**：请求以用户在 Folia 登录这个平台的账号发出，带着登录会话，和用户自己在界面上搜歌、打开专辑一样。读到的是公开的目录数据，
但平台的风控记在用户的账号上，请求太密还可能影响用户自己播放。所以宿主给每个模组限了次数（见[额度与时限](#额度与时限)），又给每个
Folia 自带的音源限了所有模组合计的次数：几个模组同时大批解析，也不会把对一个平台的请求翻成几倍。`folium.omni` 不需要权限，启用确认窗口和
模组面板里不会为它多写一句，所以模组会这样访问平台时，在模组说明（`description`）里写清楚。

#### 音源：listProviders

同步、不问平台，按宿主的顺序列出本机的在线音源，每项冻结：

| 字段 | 说明 |
| --- | --- |
| `providerId` | Omni provider id |
| `displayName` / `shortName` | 音源切换器上的全名 / 搜索浮层来源按钮上的短名 |
| `origin` | `host`：Folia 自带；`mod`：模组用 `omni.providers` 注册的，那个模组停用时就不在列表里 |
| `selected` | 是不是宿主现在选中的音源（`searchSongs` 不传 `providerId` 时搜它） |
| `configured` | 这个宿主里没配好时为 `false`；`true` 不保证请求一定成功 |
| `supports` | `{ search, resolve, lyrics, albums, artists }`：各方法能不能用在它上面，为 `false` 的那个方法以 `unsupported` 拒绝（不发请求） |

- 不含账号、用户和歌单：登录状态读 [folium.account](#foliumaccount17)。本地文件、Navidrome、外部 Stage 不是在线音源，不在列表里。
- 以后的 minor 可能给 `supports` 加标志，读不到的按 `false` 处理。
- 音源只在模组注册、注销自己的音源时增减，没有变化事件：用的时候再读一次。宿主换了选中的音源也不发事件，`selected` 同样随用随读。

#### 搜索与翻页

**`searchSongs(query, options)`**：

- `query` 去掉首尾空白后 1–200 个字符，否则以 `TypeError` 拒绝。
- `options.providerId` 指定音源；不传就搜宿主现在选中的音源（没有选中的在线音源时回 `unsupported`）。没有这个音源，或者它的 `supports.search`
  为 `false` 时回 `unsupported`，不回空页。
- 不传 `providerId` 搜的，翻页途中宿主换了选中的音源，下一页回 `account-changed`：这一串结果属于原来那个音源。要一直搜同一个音源就传 `providerId`。
- 不传 `cursor` 读第一页。`limit` 缺省 30、最多 50，小数向下取整，小于 1 按 1；给了却不是有限数时以 `TypeError` 拒绝。

`searchSongs`、`getTracks`、`getArtistAlbums` 都回一页 `{ items, nextCursor, total }`（冻结）：

- 把 `nextCursor` 原样作为 `options.cursor` 传回去读下一页；`null` 表示平台说没有了。游标是不透明的字符串，只在这次运行里有效。宿主只留最近用过的一批
  （所有模组共用），太久没用的会失效，再用就回 `stale-ref`：这时不带游标，从第一页重来。
- 翻页时其余参数照第一页传：同一个 `query` 和 `providerId`，同一个专辑或歌手。专辑和歌手按 `source` + `kind` + `id` 认，不认是哪个 DTO：
  `ref` 失效后用键重新取到的、或者别处又读到的同一张专辑，都能接着用这个游标。拿一个列表的游标去翻另一个列表，以
  `TypeError`（`invalid-arguments: cursor is for another list`）拒绝。
- **页长在第一页定下**：带 `cursor` 时 `limit` 被忽略，后面每页都按第一页的页长。`items` 不会多于这个数，但可能更少；平台说还有、这一页却回了
  0 项时，照样给一个空页和下一个游标，宿主不替你接着追。
- 各平台分页的方式不一样（例如网易云的专辑曲目不管要多少都一次回整张，酷狗的专辑把页长夹到 30，有的平台按页码翻），所以模组拿不到 offset，也不要自己算。
  平台一次多给的，宿主先留着，下一页从里面切，不再问平台，也不计次数。
- `total` 是平台说的整个列表的长度，没说时是 `null`。

#### 按键找回歌：resolveSongs

**`resolveSongs(keys, options)`** 把存下来的 `{ source, id }`（就是歌曲 DTO 的 `source` 和 `id`）找回成宿主的歌：

- 一次 1–50 个键，每个键的 `source`、`id` 都是非空字符串，否则以 `TypeError` 拒绝。按键的顺序给回同样多个结果；重复的键只问一次。
- 一个键查不到不会让整个调用失败：调用只在参数不对、导出窗口和 `aborted` 时拒绝。每个键一种结果：

  | `status` | 意思 | 怎么办 |
  | --- | --- | --- |
  | `found` | `song` 是宿主的歌，带新的 `ref`，可以交给 `playSong` / `enqueue` | |
  | `not-found` | 平台回答了：没有这首歌。平台拒绝了请求、或者宿主还不能按这个 id 查，都不是它，是 `failed` | 告诉用户；删不删由你定 |
  | `unsupported` | 这台宿主现在查不了：没有这个音源（它的模组没启用、别的 Folia 版本才有的音源）、不是在线音源（`local`、`navidrome`、`stage`），或者这个音源不能按 id 查歌（`supports.resolve` 为 `false`） | **键留着**：音源回来之后（模组重新启用、换到装了它的宿主）就又能查 |
  | `failed` | 没拿到回答，`code` 说为什么（见[错误码](#omni-的错误码)，永远不是 `unsupported`） | 以后再试可能就好了 |

  以后的 minor 可能加新的 `status`，不认识的按 `failed` 处理。
- 宿主事先就知道查不了的键（没有这个音源、不是在线音源、`supports.resolve` 为 `false`）直接回 `unsupported`，不发请求；平台被问到之后说查不了的，
  同样是 `unsupported`。能一次查多首的音源一批算一次（QQ 音乐 50 个键是两批）；不能一次查多首的音源逐个键问，每个键算一次（见[额度与时限](#额度与时限)）：只解析马上要显示的那一段，
  不要一次把收藏全解析。中途超了额度，这个音源剩下的键回 `failed`（`code` 为 `rate-limited`），已经拿到的照常给。
- 宿主可能直接用最近读到的回答（所有模组共用，「没有这首」也记下），这时不问平台、不计次数。某个音源换了登录的账号，宿主就丢掉那个音源的这些回答。
- 解析只读元数据：不播放，不取音频地址，不触发 `omni.audioSourceResolved`。解析出来的歌和搜索结果一样带着平台的不可用标记，播放时宿主照常处理。
- **哪些歌解析不回来**：键只有 `source + id`，平台挂在歌上的附加数据带不过去。
  - 只在另一台设备上有的：本地文件、Navidrome，或者这里没装的模组音源（`unsupported`）。
  - 云盘上传：网易云盘里和曲库匹配上的歌，id 就是曲库的 id，解析回来是公开的那一版；没匹配上的上传 id 不在曲库里，回 `not-found`。
  - 酷狗的歌 id 是音频的 hash：同一段音频收在几张专辑里时（平台靠 albumAudioId 区分），解析回来的是平台按 hash 给的那一条，专辑可能不是存键时那张。
  - QQ 音乐：歌的 `id` 是数字 songid，平台的播放键是 songmid（模组看不到）；宿主两种都能解析，解析回来的 `id` 仍是数字 songid。

#### 歌曲详情与歌词

**`describeSong(song)`** 同步、不问平台，只读宿主手里这首歌的数据，回冻结的 `{ durationMs, coverUrl, availability, pageUrl }`：

- 不是在线歌曲，或者它的 `ref` 已经失效时给 `null`；没有 `ref` 的 DTO 抛 `TypeError`。
- `durationMs` 是毫秒，平台没给时长时为 `null`（有些平台和模组音源在搜索结果里填 0，宿主当作不知道，不当成 0 秒）。`coverUrl` 是封面，
  `pageUrl` 是这首歌在平台上的公开网页，没有时都是 `null`。
- `availability`：
  - `playable`：平台没标什么。不保证放得了，例如网易云需要会员的歌也算 `playable`；
  - `taken-down`：平台下架了；
  - `restricted`：平台标了限制（会员、地区），放不放得了要放的时候才知道；
  - `unknown`：平台没说。

  它是平台对当前登录的账号说的，换个账号可能不同。以后的 minor 可能加新值，不认识的按 `unknown` 处理。

**`getLyrics(song, options)`** 读一首在线歌曲的歌词：平台给的原样，宿主解析、标好副歌之后，任何模组改写之前的那一份。

- 回冻结的 `{ lines, isWordByWord, isPureMusic }`：`lines`、`isWordByWord` 和 `folium.lyrics.parse` 给的一样（`FoliumLine[]`）；`isPureMusic`
  是平台标了纯音乐。平台没有这首的歌词时 `lines` 是空数组。
- **不跑 `omni.lyricsResolved` 钩子**：模组在自己的钩子里再读歌词就会调到自己，无限递归，还会把自己的请求位置永远占满。所以读到的不受任何模组影响；
  要用户屏幕上那一份（含模组的改写），用 `folium.lyrics.getLines()`。
- 副歌只在行的 `isChorus` 上（平台标的，或者宿主按重复的行认出来的），没有单独的副歌区间。
- 不是在线歌曲，或者它的音源没有歌词（`supports.lyrics` 为 `false`）时回 `unsupported`。

#### 专辑与歌手

`FoliumCollection` 是一张专辑或一位歌手（冻结）：`kind`（`album` / `artist`）、`source`、`id`、`name`、`artist`（专辑的歌手用 ` / ` 连起来；歌手本身、
或者不知道时是 `''`）、`coverUrl`、`description`、`trackCount`（专辑）、`albumCount`（歌手）、`publishedAt`（专辑的发行时间，毫秒时间戳）、`ref`。
后面这几个数和地址不知道时是 `null`。

- 自己存数据用 `source` + `kind` + `id`，`resolveCollection({ source, kind, id })` 能找回来。`ref` 只在这次运行里有效（专辑和歌手另有一个池），
  失效后用到它的方法回 `stale-ref`，用键再取一次。
- `getAlbum(song)` / `getArtists(song)`：从一首在线歌曲走到它的专辑 / 歌手。给的是摘要：名字（专辑还有封面）取自歌曲，`trackCount`、`description` 等是 `null`，
  要详情就拿它的键去 `resolveCollection`。没有专辑时 `getAlbum` 给 `null`；`getArtists` 只给平台能打开的歌手，没有时是空数组。
  不是在线歌曲，或者音源的 `supports.albums` / `supports.artists` 为 `false` 时回 `unsupported`，不发请求。
- `resolveCollection(key)`：平台没有这张专辑或这位歌手时给 `null`（平台回了一个没有名字的空壳也算没有）。有的平台对不认识的 id 直接报错，
  这时回 `unavailable` 或 `network`。平台拒绝了这次请求（风控、本地服务连不上平台、要登录）时同样以错误码拒绝，不给 `null`：`null` 才是「没有」。
- `getTracks(collection)`：专辑的曲目，或歌手的歌（多数平台按热度排）。`limit` 缺省 50、最多 100，分页同上。
- `getArtistAlbums(artist)`：歌手的专辑，分页同 `getTracks`，只收歌手。
- 这两个方法收到种类不对的 DTO（把专辑交给 `getArtistAlbums`，或者把歌曲交给它们）以 `TypeError` 拒绝；集合所在的音源不在了（它的模组停用了）时回 `unsupported`。
- 以后的 minor 可能加新的 `kind`，不认识的当作读不了。

#### 额度与时限

宿主每替你问一次平台，就算一次，记在这个模组的额度上：

- 和 `platform.raw` 共用一份额度，按模组 id 计、整个页面只有一份：重载或停用后再启用模组，不会重置这一分钟的计数。
- 目前每分钟 120 次：被接受时就算（排队中的也算），超了立即以 `rate-limited` 拒绝，不排到下一分钟。
- 同时最多 8 个：再多的按先来后到排队，前面的回来了再发。
- 宿主还给每个 Folia 自带的音源限了所有模组合计的次数和同时在途的个数：超了次数同样回 `rate-limited`，超了个数排队。宿主自己的请求不算在里面。
- 模组提供的音源（`origin` 为 `mod`）的请求只算每分钟的次数，不占同时的位置，也不算进合计：模组 A 的音源在自己的 `search` 里再调 `folium.omni` 时，
  外层占着位置，内层也不会永远等下去；每分钟的上限兜住了无限递归。
- 不算次数的：`listProviders`、`describeSong`，翻页时从宿主留着的项里切出来的页，以及 `resolveSongs` 用宿主最近读到的回答时。
- 一次请求从发起算（排队的时间也算）过了一段时间（目前 30 秒）还没有回答，调用以 `network` 拒绝。
- `aborted`（你的 `signal` 中止了，或模组停了）只是丢掉回答：平台那边的请求可能还在跑，跑完之前照样占着位置。所以「发 8 个、全中止、马上再发」，
  第 9 个要等前面的真正结束才发出；一个请求发出后一直不结束时，宿主过一阵（目前 2 分钟）强制让出它的位置。
- 开发者日志里每次失败有一行 `[Folium:<模组 id>] omni.<方法> <音源 id>: <code>`，带平台原本的错误；超额拒绝也各有一行。

#### ref 与键

- 歌曲 DTO 的 `ref` 和队列、事件里的共用一个 5,000 条的池（见 `playback.getQueue`），最久没被交出去的先失效：刚拿到的这一页里每个 `ref` 都有效。
  所以只读要显示的那几页。
- **`ref` 不是身份**：同一首歌从队列里读到一次、从 `resolveSongs` 又读到一次，`ref` 可能不同。判断是不是同一首歌比 `source` 和 `id`，不比 `ref`。
- 要存下来的，歌存 `{ source, id }`，专辑和歌手存 `{ source, kind, id }`，下次启动用 `resolveSongs` / `resolveCollection` 找回来。
- `ref` 失效后再用，异步方法回 `stale-ref`，`describeSong` 给 `null`：重新搜，或者用键再解析一次。

#### omni 的错误码

异步方法以带 `code` 的 Error 拒绝（`message` 就是 code）；`resolveSongs` 里单个键的失败放在那个结果的 `code` 上：

| code | 什么时候 |
| --- | --- |
| `unsupported` | 音源不回答这个（`supports` 里对应的标志为 `false`），没有这个音源，或者不是在线歌曲 |
| `unavailable` | 音源现在接不了请求：没配好、它的服务没在运行，或者它拒绝了 |
| `region-restricted` | 音源不回答这个地区的请求 |
| `not-signed-in` / `session-expired` | 平台要登录：没人登录 / 登录已过期 |
| `vip-required` | 只有会员能看 |
| `rate-limited` | 超了额度（见上），或者平台自己说太频繁 |
| `network` | 没按时回答，或者平台没说原因的失败（模组音源抛的错也算这一类） |
| `account-changed` | 请求途中宿主换了选中的音源，或者这个音源换了登录的账号，回答已丢弃 |
| `stale-ref` | DTO 的 `ref`，或者 `cursor`，已经失效：重新读一次 |
| `aborted` | 调用的 `signal` 中止了，或者模组停了 |

以后的 minor 可能加新的 code，不认识的按 `network` 处理。另外两种拒绝不带 `code`：参数不对时是 `TypeError`，message 以 `invalid-arguments:`
开头（没有 `ref` 的歌曲 DTO、把歌曲交给要专辑的方法也算）；导出窗口里的见[下面](#导出窗口main-入口与旧宿主)。

#### 不开放的，与已知做不到的

`folium.omni` 只读公开的目录数据。下面这些不开放：

- **音频地址与音质**：地址带签名、绑定账号的权益，配上 `net.fetch` 就能下载外传；取地址本身还有副作用（写宿主的响度缓存、跑别的模组的
  `omni.audioSourceResolved`）。要放就交给 `playback.playSong(song)`，地址由宿主在播放时取，放不了照常发 `playback.failed`。
- **账号自己的数据**：我的歌单、收藏、喜爱、云盘列表、每日推荐、听歌记录。这些是用户画像，1.7 不开放，以后要开会单独加权限。正在放的歌喜爱了没有，读
  `playback.getState().liked`。
- **歌单**：宿主分不出一个歌单是公开的还是私密的，读取又带着用户的会话，按 id 开放歌单就等于开放了私密歌单。`FoliumCollection.kind` 以后可能多出 `playlist`。
- **写操作**：喜爱、收藏、往歌单里加删歌、上报听歌。
- **登录、私人 FM、首页推荐与探索页**：会改登录状态，或者会消费、重置宿主界面正在用的推荐状态。
- 平台专有、上面都没有的能力，后备是实验接口 [platform.raw](#platformraw实验17)。

已知做不到的：

- **整表替换播放队列**不在 `folium.omni` 里：用 1.7 的 `folium.playback.replaceQueue`（权限 `playback.queue`，见[服务](#服务)）。不要拿 `enqueue`
  一首首重建队列，那会走样：它按用户的「加入队列方式」加，设为「下一首」时一首首加进去，顺序整个反过来；已经在队列里的歌被挪过去、不加第二遍；
  正在放的歌和平台标了不可用的歌不加；每加一首宿主都弹一次自己的提示；而且从不删歌。

#### 导出窗口、main 入口与旧宿主

- 导出窗口里 `folium.omni` 在，但同步方法（`listProviders`、`describeSong`）抛、异步方法拒绝 `Error('omni-unavailable-in-export-context')`，不带 `code`。
- main 入口没有 `omni`。要数据就让 client 去读：main 入口用 `api.rpc.send` 通知 client（或者由 client 自己发起），client 调 `folium.omni`，再用
  `folium.rpc.call` 把结果交给 main 入口。DTO 都是能 JSON 序列化的纯数据；`ref` 到了 main 入口只是一个字符串，交回 client 照样能用（只要它还没失效）。
- Folium 1.6 的宿主没有 `folium.omni`（读它得到 `undefined`，不会抛错）：先检查 `folium.host.folium.minor >= 7`。

完整的例子见 `dev/folium/sample-omni-console`。

### folium.equalizer（1.7）

宿主的图形均衡器（音频效果器里的十段频段）。读不需要权限，写（`setMode`、`applyCurve`、`releaseCurve`）需要 `equalizer.control`，只在主窗口可用。
模组拿到的是均衡器的**设置**，不是音频节点：写入落在用户自己在面板里操作落到的同一处，面板和声音都跟着变，重启后还在。

```js
export default function activate(folium) {
  // 1.6 的宿主没有 folium.equalizer；导出窗口里它的每个方法都抛错。
  if (folium.host.folium.minor < 7 || folium.env.context !== 'main') return;
  const { equalizer } = folium;
  let following = true;   // 按歌自动施加；用户一改就停

  folium.events.on('equalizer.changed', ({ origin }) => {
    // host（进出 Stage、开关面板、曲线暂停与恢复）不是谁改了音效，自己的写入也不算。
    if (origin.kind === 'host' || (origin.kind === 'mod' && origin.modId === folium.modId)) return;
    following = false;   // 用户、宿主命令或别的模组改了：让步，等用户在本模组的设置里重新打开
  });

  folium.events.on('playback.songChanged', () => {
    if (!following) return;
    const result = equalizer.applyCurve([4, 3, 1, 0, -1, -1, 0, 1, 3, 4]);
    if (!result.ok) folium.log.info('not now:', result.reason);   // panel-open、rate-limited……
  });
}
```

**快照**：`getState()` 同步返回冻结的 `FoliumEqualizerState`，报的是**此刻听到的**均衡器：

| 字段 | 说明 |
| --- | --- |
| `enabled` | 音频效果器的总开关。关着时增益保留但听不到，效果链也一起关着。开关是用户的，任何 `folium.equalizer` 写入都不会打开它 |
| `mode` | 现在放的是什么：`{ kind: 'preset', id }`（内置音效 `flat`、`lofi`、`radio`、`hall`、`vocal`、`bass`）、`{ kind: 'custom', id }`（用户的 `custom1` / `custom2`）、`{ kind: 'mod', modId }`（某个模组施加的曲线）。以后的 minor 可能多出别的 `kind`：不认识的当成用户选的，别去动它 |
| `gains` | 每段的增益（dB），按 `bands` 的顺序，在 `minGain`–`maxGain` 之间。`enabled` 为 `false` 时照样给，只是听不到 |
| `bands` | 每段的 `{ frequency, shape }`，从低到高。1.7 是 10 段（31 Hz 到 16 kHz）；首段 `lowshelf`、末段 `highshelf`、其余 `peaking`，不认识的 `shape` 当成 `peaking`。每次读都是同一个冻结数组 |
| `minGain` / `maxGain` | 一段增益的范围，1.7 是 -12 / 12 dB |
| `hostPlaysAudio` | 声音是否经过宿主自己的音频（均衡器就在那里）。外部 Stage 播放时（别的播放器的正在播放、只有歌词没有音频的 Stage 源）为 `false`，均衡器没有东西可作用；设置等宿主自己放歌时照样生效 |
| `writable` | 音频效果器开着时为 `false`：这时会改变东西的写入被拒 `panel-open`，窗口关上时发一次 `equalizer.changed`。权限和限频不算在里面 |

不交出来的：用户不在播放的那个自定义栏位的内容（用户数据；正在播放的那个，它的曲线就是 `gains`）；效果链的 9 项参数（预设的效果链只能随 `setMode` 整体切换）；
Q 值（实现细节，可能调整）；任何音频节点、`AudioContext`（宿主每次设置一变就整体重写节点，直接改节点必然被刷回；频谱读数是另一项能力 `ctx.audio`）；
曲线所属模组此刻是不是在跑（启动失败、重载中都难以如实回答，快照只报听到的声音）。

**两层写入**，都返回 `{ ok: true, state }`（`state` 是写入之后的均衡器）或 `{ ok: false, reason }`：

- `setMode({ kind: 'preset' | 'custom', id })`：切到宿主已有的一个音效，和命令面板的音效命令一样，曲线和效果链一起换，在位的模组曲线（不论是谁的）随之结束。
  **不写任何自定义栏位，不动总开关**。这一点和命令面板不同：命令面板是用户亲手选的，会打开总开关；模组按歌切换时打开总开关，会在用户关掉处理之后把预设的整套效果链（噪声、比特降质……）带出来。
  宿主没有的音效（较新的 minor 加的 id，或不认识的 `kind`）回 `unknown-mode`，不抛错，为较新宿主写的模组在旧宿主上能降级；`kind: 'mod'` 和形状不对的参数抛 `TypeError`。
- `applyCurve(gains)`：施加本模组自己的曲线，模式变成 `{ kind: 'mod', modId }`。1 到 `bands.length` 个有限数，从最低一段起；少给的段读 0，每个值夹到 `minGain`–`maxGain` 并取整到 0.1 dB，
  `state.gains` 就是规范化之后的结果。空数组、超过段数、`NaN`、字符串抛 `TypeError`。效果链和总开关保持用户原来的。
  曲线是独立于用户音效的一层：用户的预设、自定义栏位一个字节都不改，撤下就精确地回到施加前的音效。曲线一直在，重启、模组重载都在，直到用户或别的模组改了音效。
- `releaseCurve()`：撤下本模组的曲线、回到用户自己的音效。在位的是本模组的曲线时返回 `true`；不是本模组的或者没有曲线时返回 `false`，什么都不变。不看面板开没开，也不计入限频。

**用户优先，模组让步**：用户在音频效果器里的任何选择（点一个音效、把模组曲线存进自己的栏位、换回自己的音效）都结束模组曲线；
命令面板的音效命令和「音效：换回我的音效」也是。跟着 `equalizer.changed` 走：`origin` 是 `user`、`command` 或别的模组时（`origin.kind === 'mod'` 且 `origin.modId` 不是你的 `folium.modId`），
就停止自动施加，直到用户在你的模组里重新打开；在那之后再把曲线放回去，就是在覆盖用户的选择。`host` 不算用户的改动：进出 Stage、开关音频效果器、曲线暂停与恢复都报 `host`。
不认识的 `origin.kind` 按 `user` 处理。模组接手了声音（这一次的写之前，音效是用户、命令、宿主或别的模组定的）时，宿主弹一条提示写明是哪个模组；同一个模组接着写只提示第一次，`releaseCurve` 不提示。

**事件 `equalizer.changed`**：`{ state, origin }`，快照里任何一项变了就发（开关、模式、增益、`hostPlaysAudio`、`writable`）。`origin` 是 `{ kind, modId }`，`kind` 为 `user`（音频效果器）、
`command`（宿主命令）、`mod`（某个模组经 `folium.equalizer`，`modId` 是它的 id）或 `host`（宿主自己，没人在改音效），只有 `mod` 带 `modId`，其余为 `null`。
同一个任务里的多次变化合成一次，`origin` 取其中最后一个不是 `host` 的，全是 `host` 才报 `host`：用户改了音效、紧接着换歌，报的是 `user`。只换了歌（声音还是经过宿主）不发；
改了又改回去不发；开始监听之前的变化不补发。导出窗口不发。

**面板开着时**：用户正看着音频效果器，会改变东西的 `setMode` / `applyCurve` 被拒 `panel-open`，免得打乱用户手里的调整。等 `state.writable` 变回 `true` 的那次 `equalizer.changed` 再补写，不必轮询。
`releaseCurve` 例外，照常生效。

**「没有变化」**：写入算出的用户设置（开关、模式、增益、效果链、两个自定义栏位）与现在的完全相同，**并且**在位的曲线前后相同（同为没有，或同一个模组、增益逐段相等），就是没有变化。
这样的写入回 `{ ok: true, state }`，不存盘、不计数、不发事件、不提示，**面板开着、冷却期内也照收**，所以按歌重复写同一个结果是安全的。注意：用户的旧设置里中性效果链的「Lo-Fi」，
`setMode` 同一个 id 会换上它完整的效果链，这是一次变化。

**检查顺序**（前面的成立就不再看后面的）：

1. 没声明 `equalizer.control`：三个写方法都抛 `permission-denied:equalizer.control`。
2. 导出窗口：每个方法（包括 `getState`）都抛 `equalizer-unavailable-in-export-context`，不带 `code`。
3. 参数形状不对：`setMode` / `applyCurve` 抛 `TypeError`，message 以 `invalid-arguments:` 开头。
4. 这个模组已经停下（旧的 `folium` 对象）：`setMode` / `applyCurve` 回 `stopped`，`releaseCurve` 回 `false`。
5. 宿主没有这个音效：`setMode` 回 `unknown-mode`（面板开着也先报它，宿主本身没有这个音效和用户在不在面板前无关）。
6. 没有变化：回 `{ ok: true, state }`。
7. 音频效果器开着：回 `panel-open`。
8. 限频：回 `rate-limited`。

以后的 minor 可能加新的拒绝原因：不认识的按 `rate-limited` 处理，过一会儿再试，不要在循环里重试。

**限频**：目前每个模组离上一次被计数的写入不到 1 秒就拒，一分钟（滑动的 60 秒）里最多 20 次；按模组 id 计，重载模组不清零。只有真正改变了东西的写入才计数，被拒的、没有变化的都不算。
每次改变东西的写入都会存盘：写你定下来的结果，不要拿它逐帧做动画。数值以后可能调整。

**automix 过渡**：智能过渡里能听到两首歌叠在一起的那几秒，宿主把模组的变化推迟到过渡结束才放进声音里（`getState()` 立刻就报新的设置），增益是滑过去的，不是跳过去的。
推迟是因为效果链（饱和、比特降质）是瞬间切换的，均衡器又接在两首歌的混音点之后，过渡中途换会同时改变两首歌的音色。用户、命令面板、宿主的变化照旧立即生效。

**外部 Stage**：`hostPlaysAudio` 为 `false` 时照常写入、照常存盘，只是这时听不到；宿主自己放歌时就生效。总开关关着时也一样：写入照常，`state.enabled === false` 告诉你听不到。

**曲线所属的模组被停用或卸载**：曲线的记录保留；停用或卸载期间播的是用户自己的音效，`getState()` 报的、面板显示的也都是用户自己的模式和增益；模组重新启用后曲线自动回来，不需要模组再施加一次。
看的是模组面板里的启用状态，不是 client 此刻有没有在跑：重载（没改文件，或者改的是开发版里仓库 `mods/` 下的模组）、`activate` 抛错、应用打开时没赶上第一屏，都不改变声音，也不发事件。暂停和恢复各发一次 `host` 来源的 `equalizer.changed`。
装在用户模组目录里的模组改了文件再重载，授权随即撤销、模组保持禁用直到重新确认（见[安全声明](#安全声明重要)的「信任绑定到内容」）：确认之前它的曲线和停用时一样暂停，确认之后回来。
暂停期间用户（或别的模组）改了音效，记录就清掉了，模组重新启用后不再恢复：用户已经做了新的选择。

**音频效果器里**：模组曲线生效时，面板上方写明这条曲线来自哪个模组（用施加时的模组名，卸载之后也能显示），没有哪个预设亮着，频段和效果区只读：
要在这条曲线上调整，先把它存进一个自定义栏位，免得一拖推子就把模组曲线写进用户自己的栏位。按钮有「换回我的音效」和「存进自定义 1」「存进自定义 2」（替换那个栏位原有的内容，切到它，总开关不动）。
总开关在模组曲线下照常能拨，曲线保留。曲线暂停时面板写明它暂未生效，给一个「丢弃这条曲线」，这时频段和效果就是用户自己的，照常可编辑（在这里改音效也会丢弃那条暂停的曲线）。
命令面板的「音效：换回我的音效」在两种状态下都能撤下或丢弃它。

**权限与旧宿主**：启用确认窗口和模组面板会为 `equalizer.control` 写一句「会改写你的音效设置」。声明了 `equalizer.control` 的清单在 Folium 1.6 的宿主上**整份被拒**（未知权限一律拒绝）；
要兼容 1.6 的模组只能只读：不声明权限，用 `folium.host.folium.minor >= 7` 判断有没有 `folium.equalizer`（1.6 上读它得到 `undefined`，不会抛错）。

**导出窗口与 main 入口**：导出窗口里 `folium.equalizer` 在，但每个方法都抛 `equalizer-unavailable-in-export-context`（写方法先查权限）。main 入口没有 `equalizer`：
要改就用 `api.rpc.send` 通知本模组的 client，由 client 调 `folium.equalizer`。

完整的例子见 `dev/folium/sample-equalizer-console`。

## main 入口（Node）

```js
// index.cjs
module.exports = function activate(api) {
  api.rpc.handle('export', async (values) => api.render.exportVideo({ codec: 'vp9', width: 1920, height: 1080, fps: 30, background: 'transparent' }));
  api.onDispose(() => { /* 释放定时器、子进程… */ });
};
```

| API | 说明 | 稳定性 |
| --- | --- | --- |
| `api.manifest` / `api.host` / `api.log.*` | 冻结的清单、宿主版本、日志 | 稳定 |
| `api.onDispose(fn)` | 禁用 / 重载 / 退出时执行，后登记的先执行；activate 直接 return 一个函数也算登记 | 稳定 |
| `api.rpc.handle(name, fn)` | 供 client 的 `folium.rpc.call` 调用 | 稳定 |
| `api.rpc.send(name, payload)` | 1.7。推一条消息给本模组在主窗口里的 client（`folium.rpc.on`），见[下面](#main-入口向-client-推送消息17) | 稳定 |
| `api.storage.get/set/has/delete/keys` | 异步，需 `filesystem.data`，与 client 的 `folium.storage` 共用数据，上限 1 MB | 稳定 |
| `api.secrets.get/has/set/subscribe` | 1.7。本模组 `secret` 设置字段的值，与 client 的 `folium.secrets` 是同一份，不需要权限；每次启动时 client 登记分区之前，没有值的 key 读出来是 `null`、不能写，见[密钥字段](#密钥字段secret17) | 稳定 |
| `api.paths` | 可以写文件的用户目录：`documents`、`downloads`、`music`、`videos`；模组自己的文件放 `api.storage.paths` | 稳定 |
| `api.storage.paths.data` / `.cache` | 模组自己写文件的目录，见下 | 稳定 |
| `api.runtime.getPlaybackSnapshot()` | 需 `playback.read`；返回 `FoliumPlaybackSnapshot` DTO，`position` 在播放中按推送时间外推；还带音量 `volume`（0–1）、`muted` 与循环模式 `loopMode` | 稳定 |
| `api.render.exportVideo(spec)` | 需 `render.export`；spec 只有输出参数 `{ codec: 'vp9' \| 'prores', width, height, fps, startSec, endSec, background: 'transparent' \| 'theme' }`，模式、调参、歌词、主题与 Folium 设置值由宿主按当前状态取 | 稳定 |

导出上限（3840×2160、60fps、15 分钟、全局互斥）与 ffmpeg 查找顺序属于宿主行为，不属于契约，可能调整。

### main 入口向 client 推送消息（1.7）

`rpc.call` / `handle` 是 client 问、main 入口答；反方向用 `api.rpc.send`：本模组的 main 入口只能发给本模组的 client，不需要权限。

```js
// index.cjs
module.exports = function activate(api) {
  const timer = setInterval(() => api.rpc.send('tick', { at: Date.now() }), 15_000);
  api.onDispose(() => clearInterval(timer));
  api.rpc.handle('state', () => ({ ready: true }));
};

// client.mjs
export default function activate(folium) {
  folium.rpc.on('tick', (payload) => { /* payload 是 main 入口发的那份 JSON */ });
  folium.rpc.call('state').then((state) => { /* 先监听，再取一次当前状态 */ });
}
```

- **不排队、不重放。** 只发给主窗口里正在运行的 client；client 还没激活、窗口重建中、没有主窗口时发的消息直接丢掉，不报错。
  需要状态的一方在 client 激活后先 `rpc.on`，再用 `rpc.call` 主动取一次。导出窗口永远收不到。
- **`name`** 和 `handle` 同一条规则：`/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`。**`payload`** 必须能 JSON 序列化，序列化后最多 64 KB（UTF-8）；
  不传时 client 收到 `null`。名字不合规则、payload 不能序列化（函数、`BigInt`、循环引用）时 `send` 在调用处同步抛错，
  超过上限抛 `rpc-payload-too-large:65536`；这些检查不管有没有窗口在收都会做。
- **`folium.rpc.on(name, listener)`** 返回取消函数。同一个名字可以有几个监听，每个拿到各自解析的一份 payload，互相改不到；
  一个监听抛错记到模组那一行，不影响其它监听。只收本模组自己 main 入口发的消息。`name` 不合规则或 `listener` 不是函数时抛错。
  模组停掉（停用、重载、client 卸载）时宿主替你取消；导出窗口里照常收下监听、从不调用。
- 不放进 `folium.events`：那是宿主发出的、有类型的通知，模组自己的消息名混进去会和以后宿主新增的事件撞名。
- Folium 1.6 的宿主没有 `send` 和 `on`，先检查 `api.host.folium.minor >= 7` / `folium.host.folium.minor >= 7`。

### 文件目录 api.storage.paths

`api.storage` 适合设置大小的状态（上限 1 MB）；更大的内容、日志、下载的文件由 main 入口自己写成文件，放在宿主给的两个目录里：

| 路径 | 位置 | 用途 |
| --- | --- | --- |
| `api.storage.paths.data` | `<userData>/mods-data/<id>/files` | 要保留的文件。与 `api.storage` 的数据文件同在 `mods-data/<id>` 下，但不包含它 |
| `api.storage.paths.cache` | `<userData>/mods-cache/<id>` | 可以重建的文件。用户随时可以在模组面板里清空它，模组运行时也一样，所以要预期文件会消失；宿主不限大小，上限自己控制 |

- 两个都是 getter，每次读取都先检查 `filesystem.data`，没有就**同步**抛 `permission-denied:filesystem.data`；然后在目录不存在时创建它，
  返回绝对路径。所以每次用的时候读一次，不要在 activate 里存下字符串就一直用。
- 目录建不出来时 getter 抛文件系统的错误（如 `EEXIST`、`ENOENT`）：比如 `mods-cache/<id>` 的位置上是一个文件，或是目标已经不在的
  链接 / junction。模组面板会把这样的缓存目录标成已损坏，「清空缓存」删掉这个条目后，下次读取就能重新建出目录。
- 两个 getter 不可枚举：`JSON.stringify(api)`、`{ ...api.storage.paths }` 之类遍历属性的写法读不到它们，也就不会抛错或建目录。
- 模组面板的「清空缓存」删除 `cache` 目录里的全部内容（包括子目录），保留目录本身；模组自己在里面建的子目录，用之前要自己再建一次。
- `paths` 对象本身总是在（有没有权限都在），可以用 `'paths' in api.storage` 判断宿主有没有它。
- 路径只用通过校验的清单 `id` 拼出来。client 拿不到路径：它没有文件系统。
- 模组面板显示的「数据」统计整个 `mods-data/<id>`（含 `api.storage` 的数据文件），「缓存」统计 `mods-cache/<id>`，见[从 UI 安装与管理](#从-ui-安装与管理)。

```js
// index.cjs（需要 storage）
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

`getLyrics` 返回的 `FoliumLyricsResult` 是稳定形状，`omni.providers` 本身仍是实验接口：

- 两条轨道都是[歌词原文](#歌词原文)。
  - 有 `wordByWord` 时显示它；它解析失败或解析不出任何一行时，退回 `main`。
  - `wordByWord` 没带翻译、罗马音时，沿用 `main` 的。
- `isPureMusic: true` 时显示纯音乐视图，忽略两条轨道。
- `chorusRanges: [{ startTime, endTime }]` 是歌词时间（秒），落在区间里的行显示副歌效果，最多 64 段。
  - 没给时，宿主按重复的行自动识别。
  - TTML 的 `songPart` 标记优先于这两者。

注册的音源在界面上可以选为当前音源：

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
  字幕的 `textKey`）不填翻译 key，直接写文字，或者按语言写 `{ 'zh-CN': '…', en: '…' }`，跟随界面语言切换，
  缺的语言按其它模组标签的规则回退。文字里的 `{{mod}}` 会换成当前平台的修饰键（Ctrl / ⌘）。
- **悬停提示**：`hoverSelector` 用上面的容器属性，例如 `[data-folium-entry="mymod:notes"]`。
- **面板骨架**：`role: 'surface'` 的框不写 `surfaceKind` 时画成只有外框的 `plain`。也可以借用宿主的
  界面骨架（`player-page`、`side-panel`、`settings-page`……），但它们画的是宿主界面，不是你的。

**限制**：模组画不出自己界面的骨架。`surfaceKind` 只有宿主预置的那些；模组的面板、按钮在 ShadowRoot 里，
`dom` 锚点量不到里面的元素，只能量外层容器，或者用 `synthetic` / `relative` / `derived` 手写位置。

**建议**：别追求把界面画得像。用通用骨架勾出结构——一个 `surface` 面板、几个 `control` 按钮、几条 `rail`
滑轨——再让字幕把意思讲清楚：每一步只讲一件事，用 `pointTo` 把字幕连到它讲的那个框，用 `highlight` 和
`reveal` 标出「现在看这里」。这正是宿主思索的做法：骨架负责「在哪」，文字负责「是什么、为什么」。

### player.layout（实验，只读）

清单声明 `"experimental": ["player.layout"]` 后，通过已有 `mount(container, ctx)` 的
`ctx.getLayout(): FoliumPlayerLayout | null` 读取快照，布局变化并入已有 `ctx.onChange(listener)` 通知。
此成员仍是 **EXPERIMENTAL (`player.layout`)**；
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
- 只有选用了 `player.layout` 的模组通过 `ctx.onChange` 订阅时才测量；单独调用 `getLayout()` 不启动测量。
  动画、滚动、resize 共用 80ms 合并测量，不逐帧更新 React；`ctx.onChange` 还会通知其他上下文变化，
  可以比较快照引用来跳过无关更新。停用模组自动移除订阅；最后一个布局订阅取消或离开播放页后停止监听/测量。

返回按钮保留完整 **120×120** 的鼠标唤出区域，而不只是按钮点击区域。鼠标在 `app.overlay` 的模组内容
上移动不会穿透并唤出背后的返回按钮，模组应避开这块区域。标题栏预留为**整条宽、56px 高**，
仅在自定义窗口标题栏启用时出现；使用原生窗口边框或浏览器时不预留这一条。

此接口不能修改原生控件、重排、隐藏或替换原生条目，也不提供原生 DOM。
模组自己的完整组件仍挂在已有 `stageLayers` 的 `app.overlay` 槽位（需 `stageLayers`）；
样式与交互由模组负责，通过现有 ShadowRoot 隔离，不增加另一套浮层渲染接口。

```js
export default function activate(folium) {
  if (folium.env.context !== 'main') return;
  folium.registries.stageLayers.register({
    id: 'conversation', slot: 'app.overlay',
    mount(container, ctx) {
      // Mount your component and position only your own nodes from ctx.getLayout().
      const render = () => positionOwnOverlay(container, ctx.getLayout());
      const off = ctx.onChange(render);
      render();
      return off;
    },
  });
}
```

`dev/folium/player-layout-demo` 提供无账号、无网络、可停用恢复的完整示例。

### remote.actions：独立遥控窗口追加按钮

清单声明 `"experimental": ["remote.actions"]`，在主窗口的 `client` 默认入口注册。
这是 **EXPERIMENTAL (`remote.actions`)**。
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
- 宿主在遥控窗口「更多」里多出的「模组」页绘制这些按钮，原生按键的位置不变；空间不足时内部滚动；没有模组加按钮时这一页不出现。
  颜色、尺寸、图标和焦点样式由宿主统一，计数在悬停或键盘聚焦时显示为圆角标记。
  每模组的最终按钮配额尚未冻结，宿主可限制过大的动作列表，模组应只提供少量必要动作。
- 只在独立 Electron 遥控窗口里显示，主窗口里没有。
  不提供自由组件、输入框或原生按钮的替换、重排、隐藏、禁用接口，也不授予额外播放权限。

公开类型见 `src/mods/folium/contract.ts` 的 Experimental 段。
离线示例：`dev/folium/sample-remote-actions`，可检查连续点击、键盘操作、状态刷新和停用恢复。

### platform.raw（实验，1.7）

**后备方案。** 以用户在 Folia 登录的账号调用平台后端自己的接口，只用于 Omni 还没有提供的平台专有能力（例如听歌记录）。
Omni 已经有的能力（搜索、歌词、歌单、喜爱……）用 Omni；其中有类型化接口的（搜索、按 id 读歌曲、歌词、专辑与歌手）用稳定的
[folium.omni](#foliumomni17)，不要用 `platform.raw` 读。

清单选用 `"experimental": ["platform.raw"]`，再声明 `platform.<平台>.read`；要调改动账号内容的接口还要 `platform.<平台>.write`（见[权限表](#清单modjson)）。
平台 id 就是 Omni provider id，目前只有 `netease` 能直通。

```js
const platform = folium.experimental['platform.raw'];
platform.describe('netease');   // { supported: true, backend: { name, version } }：宿主钉住的后端库
const { body, accountKey } = await platform.request('netease', 'user_record', { type: 1 }, { signal });
```

- **为什么不是裸转发**：后端带着用户的会话，任意转发等于把 cookie 交出去，模组就能删歌单、改资料。所以请求仍然经过 Omni，
  由平台的 provider 补上会话后发出，模组碰不到凭据。
- **`describe(providerId)`** 不需要权限，说这个平台能不能直通，以及后端库的名字和版本（取自包本身，随宿主更新）。
- **`endpoint`** 是钉住的后端库自己的模块名（网易云：`@neteasecloudmusicapienhanced/api` 的 `module/` 下的文件名，如 `user_record`、`listen_data_total`）。
  哪些能调由平台自己的分类表决定（网易云的在 `src/services/onlineMusic/netease/neteaseRaw.ts`）：
  - 读接口要 `read`：听歌记录与听歌足迹、用户资料与关注、歌曲、歌单、专辑、歌手、排行榜、搜索、推荐等；
  - 写接口另要 `write`：点赞、歌单增删歌和改名、收藏、关注、听歌上报、签到等；
  - 永远拒绝：登录、注册、验证码、会话刷新、账号与绑定、设备、改资料，以及能把任意请求转发出去或解密流量的模块；
  - 表外的模块一律拒绝。这三种拒绝都是 `endpoint-denied`。需要表里没有的模块，提 issue。
- **`params`** 是纯对象，值是 JSON 值，参数名以字母开头、只含字母数字和 `_`，序列化后不超过 16 KB。后端当作请求选项读的字段
  （`cookie`、`proxy`、`realIP`、`domain`、`headers`、`timeout` 等）只能由宿主设。后端会原样拼进上游请求路径的参数
  （网易云如 `album` / `artist_album` / `comment_music` 的 `id`、`user_detail` 的 `uid`、`summary_annual` 的 `year`）只收非负整数
  或纯数字字符串，免得 `../` 之类的值把带着会话的请求引到表外的接口。不合这些规则的以 `TypeError`（message 以 `invalid-params:` 开头）拒绝。
  指明「当前用户」的参数（如 `user_record` 的 `uid`）不传时宿主填上当前账号的 id，所以模组永远不需要知道用户 id。
- **返回** `{ body, accountKey }`。`body` 是平台原始 JSON，cookie、token、密码等凭据字段在任意深度都已剥掉；它跟着钉住的后端库变，
  不承诺稳定，按字段防御着读。平台用别的码拒绝（登录失效和限流之外）不算失败，原样在 `body` 里。`accountKey` 与
  `folium.account.getState(providerId).accountKey` 一致，用它丢掉换号前的数据。
- **失败**时以 Error 拒绝，`code`（也是 message）是下面之一：

  | code | 什么时候 |
  | --- | --- |
  | `permission-denied:<权限>` | 缺 `platform.<平台>.read`，或写接口缺 `.write` |
  | `endpoint-denied` | 分类表不开放这个接口 |
  | `unsupported` | 这个平台在这个宿主里不能直通 |
  | `not-signed-in` / `session-expired` | 接口要登录而没人登录 / 登录已过期 |
  | `vip-required` | 平台说只有会员能看 |
  | `rate-limited` | 太频繁：这个模组一分钟内的请求超过 120 次（和 `folium.omni` 合计），或平台自己说太频繁 |
  | `network` | 连不上平台或没有按时回答 |
  | `account-changed` | 请求途中退出、换号或换了平台，回答已丢弃 |
  | `aborted` | `options.signal` 中止（底层请求随之中止），或模组已经停掉（停掉时还在途中和排队中的请求由宿主中止） |
- 每个模组同时最多 8 个请求在途，再多的按先来后到排队，等前面的回来再发，不会失败；排队中的请求同样算进每分钟的 120 次，
  也能用 `signal` 中止。这两项额度按模组 id 计、在整个页面里只有一份：重载或停用后再启用模组，不会重置这一分钟的计数。
  这份额度和 `folium.omni` 共用（见[额度与时限](#额度与时限)）；`platform.raw` 不算进按音源的所有模组合计，宿主也不另加回答时限（由平台的请求自己的时限管）。
- 调用的接口 Omni 已经有对应能力时，开发者日志里提示改用 Omni（每个接口第一次调用时一条）；`folium.omni` 有对应方法的直接点出它
  （例如 `song_detail` 提示 `folium.omni.resolveSongs`），没有的写明「还没有类型化接口」。宿主的日志只记平台、接口名和结论，不记参数。
- 只在主窗口可用，导出窗口里访问会抛错。启用确认窗口和模组面板的展开行用一句话写明模组能以用户的账号读取（或改动）哪个平台的数据。

完整示例：`dev/folium/sample-account-console` 用 `user_record` 读听歌排行，排行记在 `accountKey` 下，换号时丢掉。

## internals（自由度出口）

`folium.internals` 直接给出宿主内部对象：`React`、`ReactDOMClient`、各 zustand store（`stores.playback` 等）、
`omni` 本体、原始 visualizer 注册表。**没有任何兼容承诺**，任何一个 Folia 版本都可能改。

前提是清单写了 `folia` 版本范围（就像 Forge 模组要钉死 MC 版本），否则访问即抛
`internals-require-folia-range`；确认窗口与模组面板都会标出「使用内部接口」。只在主窗口可用。

如果一个 internals 用法在多个模组里反复出现，说明它该变成稳定的注册表、事件或服务——请提 issue。

拿 `internals.omni` 读在线音源（搜索、按 id 读歌曲、歌词、专辑与歌手）的，1.7 起改用稳定的 [folium.omni](#foliumomni17)：它有额度、不交出音频地址，
在 Folium 1.x 里只增不改。`internals.omni` 照旧在，Folium 2 和整个 `internals` 一起去掉。

## 缺失条目

用户选中了某个模组的歌词动画或背景后，那个模组被停用或卸载时：**已保存的选择不会被改写**，界面先显示默认项，
并提示「来自未运行的模组 X」；模组重新启用后自动恢复。队列里来自模组 provider 的歌同理，只是暂时不能播放。
应用打开时没赶上第一屏的模组也是这样：第一屏先显示默认项，它启动完就换回来。
模组施加的均衡器曲线同理：模组停用或卸载期间播你自己的音效，曲线保留，音频效果器里标出它来自哪个模组，重新启用后自动恢复；
模组重载（没改文件，或开发目录里改了文件）、应用打开时没赶上第一屏都不影响声音；用户模组目录里的模组改了文件要重新确认，确认之前它的曲线和停用时一样暂停
（见 [folium.equalizer](#foliumequalizer17)）。

## 版本与演进

- 清单里的 `folium: 1` 是 major；宿主通过 `folium.host.folium.minor` / `api.host.folium.minor` 暴露 minor。当前是 Folium 1.7，契约里的每个成员 1.7 的宿主上都有；
  用到 1.7 新加的成员时先检查 `minor >= 7`，旧宿主上没有它们。
- 1.x 内只做新增：可选的清单字段、新注册表、新事件、新服务方法、新权限、新设置字段类型、新公开 part。
- DTO（`contract.ts`）字段只增不减；宿主内部类型不出现在任何稳定契约里。
- 删除或改变语义必须升 major；之前至少有一个 minor 在日志里标记废弃。
- 实验接口可以在任何 minor 变动；稳定下来后原名字保留，`experimental` 里的选用变成空操作。
- Folium 2 要去掉的名字在 1.x 里照旧能用：为 Folium 1.5 写的模组不用改，用到一个旧名字，「设置 → 模组」里这个模组那一行提醒一次。
  旧名字和现在的写法见 API 参考的[仍可用的旧名字](../docs/folium/api.md#仍可用的旧名字)，`npm run folium:check` 也会列出来。
- 模组停掉之后，它原来那个 `folium` 对象的 `register` 和 `events.on` 不再生效；挂载结束之后经 `ctx` 订的监听同样不再生效。
- 监听属于订阅它的那一次挂载：同一个函数在两处挂载里各订一次，每次变化各调用一次。

**Folium 1.7 的变化**（都是新增，为 1.6 写的模组不用改）：

- main 入口向本模组 client 推送消息：`api.rpc.send(name, payload)` 与 `folium.rpc.on(name, listener)`。稳定，不需要权限。见 [main 入口向 client 推送消息](#main-入口向-client-推送消息17)。
- 密钥类设置字段：`FoliumSettingType` 加 `secret`（只用于设置分区），值由主进程加密保管，经 `folium.secrets` / `api.secrets` 读写，
  不进设置值、视觉配置导入导出和导出窗口。稳定，不需要权限。见[密钥字段](#密钥字段secret17)。
- 登录状态：`folium.account.getState(providerId?)` 与通知事件 `account.changed`，只给状态、昵称、头像和不透明的 `accountKey`。稳定，不需要权限。见 [folium.account](#foliumaccount17)。
- 实验接口 `platform.raw`：经 Omni 以用户的账号调用平台后端的原始接口，新权限 `platform.netease.read` / `platform.netease.write`。
  清单校验多两条：声明 `platform.*` 权限必须同时选用 `platform.raw`，声明 `write` 必须同时声明 `read`。见 [platform.raw](#platformraw实验17)。
- 命令可以放进系统级全局快捷键：`FoliumCommandDef.globalShortcut`，只对没有参数的命令有效，键由用户在设置里按下组合键选定（至少一个修饰键），原生 Wayland 下暂不提供。
  稳定，不需要权限。见[系统级全局快捷键](#系统级全局快捷键globalshortcut17)。
- 经 Omni 只读在线音源：`folium.omni`（`listProviders`、`searchSongs`、`resolveSongs`、`describeSong`、`getLyrics`、`getAlbum`、`getArtists`、
  `resolveCollection`、`getTracks`、`getArtistAlbums`），以用户在 Folia 登录的平台账号发请求，按模组限额。稳定，不需要权限。见 [folium.omni](#foliumomni17)。
  随之：歌曲 `ref` 的池从 2,000 条扩到 5,000 条；`platform.raw` 的额度和 `folium.omni` 共用，改为按模组 id 计，重载模组不再重置这一分钟的计数。
- 整表替换播放队列：`folium.playback.replaceQueue(songs, { expectedVersion })`，按队列版本条件提交，全有或全无，结束私人 FM。稳定，新权限
  `playback.queue`。随之：`FoliumQueueSnapshot.version`；`playback.queueChanged` 多出 `version` 与 `byThisMod`，automix 过渡结束时也发一次；
  替换后宿主提示是哪个模组换的，并可以撤销。见[服务](#服务)。
- 宿主的图形均衡器：`folium.equalizer`（`getState`、`setMode`、`applyCurve`、`releaseCurve`）与通知事件 `equalizer.changed`；新权限 `equalizer.control`（写需要，读不需要）。
  模组的曲线是独立于用户音效的一层，不写用户的自定义栏位，不打开总开关。稳定。见 [folium.equalizer](#foliumequalizer17)。
- 示范模组：`dev/folium/sample-account-console` 演示推送消息、密钥字段、登录状态、`platform.raw` 和全局快捷键；`dev/folium/sample-omni-console` 演示 `folium.omni`；
  `dev/folium/sample-playback-console` 演示 `replaceQueue`（把队列倒过来）；`dev/folium/sample-equalizer-console` 演示 `folium.equalizer`。

## 从 UI 安装与管理

- **打开模组目录**：模组面板右上角按钮，打开用户模组目录 `userData/mods`（打包版为 `%APPDATA%\Folia\mods`）。
- **拖放 zip 安装**：把 `.zip` 拖到模组面板；`mod.json` 可以在根目录或唯一顶层文件夹里。
  - 安全校验：拒绝路径穿越与绝对路径；压缩包 ≤ 64 MB，解压后 ≤ 64 MB，单文件 ≤ 32 MB，条目 ≤ 2000。
  - **原子安装**：先解压到 `userData/mods/.staging/` 校验（清单、声明的 `main` / `client` 文件必须存在），通过后才换入；
    失败则回滚，旧版本原样保留。
  - 同 id 覆盖即升级；内容指纹改变后模组保持禁用，直到重新确认。
- **占用与清空缓存**：声明了 `filesystem.data` 的模组，展开它的行时会显示「数据 X」「缓存 Y」两行和「清空缓存」按钮。
  - 只在展开时统计，停用的模组也能查、能清。统计只算普通文件，不跟随符号链接或 junction。
  - 「数据」是整个 `mods-data/<id>`（含 `api.storage` 的数据文件和 1.7 起的密钥文件 `secrets.json`），「缓存」是 `mods-cache/<id>`。
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
- **开销看得见**：模组面板里每个运行中的模组展开后写着启动用了多久、运行时每秒约用多少毫秒、出错几次在几个地方，
  以及 Node 入口在主进程里用掉的时间；慢的标「慢」（启动满 1.5 秒或过了 5 秒还没启动完、运行时每秒满 240 毫秒、主进程里一次调用满 100 毫秒）。
  这些数是宿主调用模组时顺手记的，面板关着的时候不读也不画。宿主不会因为慢关掉任何东西。
- **安全启动**：应用打开、有模组要启动时，主进程在用户数据目录写一个启动记号（`mod-start-note.json`）；
  每个模组的界面代码都启动完（或过了 5 秒时限）、第一屏也挂载完之后撤掉。下次打开时记号还在，说明上次没有启动完：
  宿主在运行任何模组代码之前问一次「这次要不要不带模组启动」（一个模组都没启用时不问，直接撤掉记号）；回答之前，谁来要求加载都不运行模组。
  选「不带」只管这一次运行，不改任何设置，这期间模组面板里启用着的模组显示为「这次没有启动」。
  启动还没完就正常退出（用户退出、系统关机、更新重启）也撤掉记号，只有被杀掉、崩溃、卡住才留着：启动期间页面每秒告诉主进程一次「我在响应」，
  退出时最近 3 秒听到过就撤，页面已经不出声（可能卡在某个模组上）就留着。记号删不掉时另写一个文件把它作废，不会每次启动都问。
- **窗口没有反应**：有模组在运行时窗口卡住，宿主弹一个系统对话框，可以继续等，也可以不带模组重新打开窗口（同样只管这一次运行）。
  卡在启动阶段又选了「不带模组重新打开」的，启动记号留着，下次打开会问。
- 每次加载周期先停用当前模组再重新激活，不会叠加多代定时器与监听器。
- 导出会话全局互斥（`export-already-running`）；取消 / 失败时清理 ffmpeg 进程、离屏窗口与半成品文件。
