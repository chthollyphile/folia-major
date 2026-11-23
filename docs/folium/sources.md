# 写一个音源模组（Folium 2）

Folia 的在线平台（网易云、QQ 音乐、酷狗……）在 Folium 2 里都是**音源模组**：仓库 `sources/<id>/` 下的十个随安装包分发（九家在线平台和默认停用的洛雪），
第三方的音源模组用同一套接口。本文讲一个音源模组由哪几块组成、宿主替它做了什么、它要守哪些约定。
每个类型和成员的签名以生成的 [API 参考](api.md) 为准（「音源（Folium 2）」与「音源类模组的 main 入口」两节），这里不重复。
普通模组的写法（清单、权限、client 与 main 入口、注册表）见 [Folium 规范](../../mods/README.md) 和
[模组开发与贡献指南](contributing.md)。

## 1. 什么算音源模组

`mod.json` 写 `"folium": 2`、并且声明了 `sources` 的模组就是音源类模组。它和普通模组分开对待：

- **不受普通模组的网络和存储限额约束**：不用声明 `net.fetch`、`filesystem.data`；main 入口的 `api.net` 走 Electron 的 `net`
  （二进制、流式、不设回答上限、时限自己定、可用自己的命名分区）；`api.storage` 上限 16 MB；清单 `secrets` 声明的密钥槽每个 64 KB。
  音源自己发的请求不算进别的模组经 `folium.omni` 调它时的次数额度。
- **比普通模组先起来、后离开**：音源一组排在所有普通模组之前启动，第一屏单独等这一组（最多 3 秒），晚到的回来后选中的平台、
  队列里的歌和保留的账号自动恢复。卸载排在普通模组之后，卸载前宿主先停掉它正在放的歌，再等它的 `api.onBeforeUnload`（最多 3 秒）。
  别的模组启用、停用、安装都不会让它的 main 入口重启，只有它自己变了才重载。
- **热路径不计时**：宿主在渲染时同步读的成员（`getAvailability`、`routeOf`、能力的 getter 等）只包一层 try/catch，抛错时回这个成员的
  保守答复、记一行日志；音源方法失败是平常结果，只记一行、不弹提示，失败的含义由 `describeFailure` 说。
- **导出窗口里不启动**：`folium.sources` 只在主窗口里能用。

信任上的几件事不在豁免之列：第三方音源模组照样受模组系统总开关管；没有官方签名的要先打开「社区模组」才能安装和加载；启用要确认（确认窗口多写一段：它提供哪些音源、会保管你在这些平台的登录、
不受网络和存储限额约束、随应用一起启动，以及下面清单里声明的证书例外与歌词中继域名）、「这次不带模组启动」时不加载。
第三方音源模组不要求签名；带了签名照旧验过贴标签。

只想读在线平台的数据（搜歌、按 id 找回歌、歌词）的模组不用写音源，用 [`folium.omni`](api.md#foliumomniservice) 即可。

## 2. 清单

```json
{
  "folium": 2,
  "id": "my-source",
  "name": "我的音源",
  "version": "1.0.0",
  "client": "client.mjs",
  "main": "index.cjs",
  "locales": "locales",
  "assets": "assets",
  "sources": [
    {
      "id": "main",
      "name": { "zh-CN": "我的音源", "en": "My source" },
      "requires": ["search@1", "songs@1", "playback.audio@1"]
    }
  ]
}
```

`sources` 里每一项是一个音源，不运行模组也能知道它提供什么（「设置 → 音源」、开箱引导、启用确认都读它）：

| 字段 | 说明 |
| --- | --- |
| `id` | 模组里的音源 id。宿主认它的名字是 `folium.<模组 id>.<音源 id>`（内置音源是短 id，如 `qq`），歌曲的 `source` 就是这个名字 |
| `name` | 名字，字符串或按语言的对象，最多 64 个字 |
| `requires` | 它要用的标准能力（`search@1` 这样带版本）；这台宿主没实现其中一个时清单校验就拒绝。自定义能力不写在这里 |
| `keepForMatching` | 开箱引导里用户没勾它时落到「只用于匹配」而不是停用（见第 6 节）。只对内置副本生效 |
| `offByDefault` | 没有记录时读作停用：新装、升级上来的用户都要自己去启用，开箱引导里也不预先勾选。只对内置副本生效 |
| `enableNotice` | 启用这家前要让人看到的一句话，字符串或按语言的对象，最多 300 个字；显示在「设置 → 音源」那一行和开箱引导里它的那一项下面。只对内置副本生效 |
| `claims` | 接管一个安装包不带的内置音源时要接的短 id 和旧数据：`storeKeys`、`partitions`、`userDataDirs`、`legacyCacheDirs`（媒体缓存目录下的旧缓存目录），都不能超出受信表那一行（见第 6 节）。`claims` 里宿主不认识的字段会被忽略，不认领任何东西，这样给新宿主打的包在旧宿主上也装得上 |
| `certificateExceptions` | 要放宽证书检查的域名，启用确认窗口里列出 |
| `lyricRelayHosts` | 要经宿主歌词中继的域名，启用确认窗口里列出 |
| `selfSignedUserServers` | `true`：连用户自己填写的服务器（如家里的 NAS）时接受它的自签证书。只是如实声明，请求由 main 入口自己发、宿主拦不住；第三方与覆盖副本的启用确认窗口里列出，内置副本不经确认，在「设置 → 音源」那一行写明 |

只有 `folium: 2` 才有的其他字段：`locales`（语言表目录，每种语言一个 `<语言>.json`）、`assets`（静态资源目录）、`secrets`（密钥槽，最多 64 个）、
`contexts`（client 在哪些窗口运行）、`native`（内置音源随应用带的原生件；接管副本用自己包里 `native/` 下的那份，见第 6 节；第三方用不了）。声明了 `sources` 就必须有 `client`：音源在那里注册。
空的 `sources` 不算数：清单校验拒绝，不能拿它换豁免。

`npm run folium:check <目录>` 会核对清单里每个音源都在 client 里注册了、用到的能力宿主都认得。

## 3. client：注册音源

```js
export function activate(folium) {
  const handle = folium.sources.register({
    id: 'main',
    displayName: folium.i18n.key('name.full'),
    shortName: folium.i18n.key('name.short'),
    capabilities: {
      'search@1': { /* … */ },
      'songs@1': { /* … */ },
      'playback.audio@1': { /* … */ },
    },
  });
  // 之后才 await
}
```

- **在 `activate` 的第一个 `await` 之前注册**，第一屏才找得到它。清单没声明的 id、同一个 id 注册两次、没有能力的定义都会抛错。
  用户停用的音源根本不注册（`handle.unregister` 那时什么也不做）。
- 定义的成员见 [FoliumSourceDef](api.md#foliumsourcedef)：名字、记号（`mark`，一个字加一个颜色，不用平台的商标图）、
  `getAvailability`、`describeFailure`、`capabilities`、`itemKinds`、`routeOf`。
- 界面上的文字用模组自己的语言表：交 `folium.i18n.key(...)`，宿主按当时的界面语言取，换语言时跟着变；只能交字符串的地方
  （歌单名之类）用 `folium.i18n.text(...)`。见 [FoliumI18nService](api.md#foliumi18nservice)。
- 失败抛 `folium.sources.error(code, message, details)` 造的错，宿主按 `code` 认（要登录、没会员、地区限制、网络……），
  见 [FoliumSourceErrorCode](api.md#foliumsourceerrorcode)。
- 渲染时要同步读的小东西（会话 token、设备 id）放 `folium.sources.pageStore(id)`，同步读写。
- 能力或成员的答案随账号、系统变了（getter 的值变了），调 `handle.changed()`，宿主重新读。
- 不请自来的提示（自己的本地服务停了）用 `handle.notify(...)`。
- client 和 main 之间用 `folium.rpc` / `api.rpc`，和普通模组一样。

### 能力

能力按标准 id 加版本声明，一个音源只实现它有的那些：

| 能力 | 做什么 |
| --- | --- |
| `search@1` | 搜歌（以及专辑、歌手、歌单） |
| `songs@1` | 按 id 取歌、一首歌的已知信息与可用性；可选的「对应歌曲」（见下面） |
| `playback.audio@1` | 给地址，宿主自己放 |
| `playback.external@1` | 应用外面的播放器，宿主驱动并跟着它 |
| `playback.surface@1` | 播放页上模组自己的画面（`<video>`、嵌入页），声音也是它自己的（见第 4 节） |
| `reports@1` | 听歌上报 |
| `lyrics@1` | 自己歌的歌词；带 `crossSource` 时也给别的歌、本地歌配歌词 |
| `auth@1` | 登录与退出（扫码、浏览器、表单） |
| `library@1` | 登录账号自己的歌单、收藏 |
| `catalog@1` | 专辑、歌手、歌单与其中的歌 |
| `recommendations@1` | 每日推荐、私人 FM 等 |
| `explore@1` | 平台自己的推荐页 |
| `mutations@1` | 红心、歌单增删、收藏 |
| `covers@1` | 封面按尺寸取图的规则 |
| `raw@1` | 平台后端的原始接口，给 `platform.raw` |

成员签名见 API 参考里各能力的类型（[FoliumSourceCapabilities](api.md#foliumsourcecapabilities) 列出全部）。几条约定：

- 宿主不认识的标准能力在模组那一行警告一次、略过；`folium.sources.supports(id, version)` 问这台宿主实现了什么。
- 自定义能力写成 `x.<模组 id>.<名字>@<版本>`，宿主不读，别的模组经 `folium.omni.capability(sourceId, id)` 取。
- 每个能力可以声明 `access: 'account'`（只有登录了才能用）；默认是匿名可用。「只用于匹配」只给匿名就能配歌词或信息的音源（第 6 节）。
- 同时有几种播放方式的音源要写 `routeOf(song)`：同步、不发请求，答这首歌走 `audio`、`external` 还是 `surface`。没写、答了没实现的方式、
  或者抛错时，按 `capabilities` 里写的先后取第一种。
- 歌以外的条目（视频之类）在 `itemKinds` 里声明种类和特性（有没有歌词、能不能红心、上不上报），歌用 `kind` 指明。没声明的种类按歌对待：
  会去取歌词、跨源匹配、上报、红心可点。

### 对应歌曲（`songs@1.counterpartSources` / `getCounterparts`）

有的音源能只凭 id 说出「别家的这首歌，在我这里是哪一首」（同一个平台上的同一条录音，只是经不同的音源去播）。用户把一张平台歌单
转存成 Folia 歌单并选了「改由某个音源播放」时，宿主拿歌单里的歌来问那个音源；答得出的歌换成它的，答不出的照原样留着。

- `counterpartSources`：能替哪些音源的歌回答，写它们的音源 id（内置的是短 id，如 `netease`、`qq`、`kugou`）。可以是 getter，
  变了调 `handle.changed()`。不写或是空的，`getCounterparts` 不会被调。
- `getCounterparts(songs)`：按顺序答每一首在自己这边的那首（`FoliumSourceSong`），没有就是 `null`。
- 只做精确对应：要按歌名歌手去找的，答 `null`。宿主不做、也不要音源做模糊匹配。
- 只读、没有副作用，最好不发请求。宿主一次问一整张歌单：每次调用最多 200 首、最多等 10 秒，一整张最多等 60 秒；超时、抛错、
  答的不是数组的那一批全部算「没有」，
  有一批超时了就不再往下问。云盘歌和歌以外的条目（视频之类）不拿来问。
- 拿到的每首歌（[FoliumSourceForeignSong](api.md#foliumsourceforeignsong)）只有公开的东西：来源音源的 id、歌在那边的 `id` 和
  `publicId`、歌名、歌手名、专辑名、时长、封面。来源音源的 `data`、账号、凭据都不给。
- 答出来的歌之后就当作这个音源的歌存进歌单、拿去播，所以要带上列表里要显示的字段（歌名、歌手、专辑、封面、时长），
  直接用传进来的那些就行，不必为此联网。答了别的音源的歌、不成样子的东西，宿主当成 `null`。
- 宿主什么时候不问：音源没注册（模组没装、没启用、还没加载完）、在「设置 → 音源」里被停用或只用于匹配（它的歌现在播不了，
  换过去没有意义）、`getAvailability()` 说没配好、没有声明任何来源。没配好的音源最好照样声明来源：界面才能把它列出来并提示去配。这几种情况歌全部照原样留着，界面会说明原因。

内置音源的歌在别的音源眼里的 id：网易云的 `id` 是数字歌曲 id；QQ 音乐的 `id` 是 songmid（上游没给 songmid 的歌是数字 songid），
`publicId` 是数字 songid；酷狗的 `id` 是歌曲的 hash。

## 4. `playback.surface@1`：播放页上的画面

`playback.surface@1` 是 `playback.external@1` 的成员再加一个 `mount`：宿主像驱动外部播放器一样驱动它（每半秒问一次 `getStatus`），
画面由模组自己画。声音不进宿主的音频图：均衡器、频谱、automix、音频缓存、视频导出都不作用于它。

- **盒子**：宿主在播放页下面给一块容器，歌词和字幕画在它上面，播放页自己的背景在它显示时让开。`mount(container, { song })`
  在宿主接手这首歌时、`play` 之前调，把画面放进 `container`（ShadowRoot 里一块铺满的新元素，不接指针），返回拿掉它的函数。
  换歌、换播放方式、停播、窗口没了时宿主调这个函数。同一个 `<video>` 在两个容器之间挪动会接着放。`mount` 不要抛错：抛了盒子是空的，声音照旧。
- **可见性**：离开播放页时盒子隐藏，声音继续。只有主窗口有盒子：OBS 来源、遥控窗口、导出窗口里没有画面。
- **窗口重建**：播放器在窗口的页面里，主窗口重建（比如切换透明模式）时它跟着没了。宿主交接时先把它暂停；交接前在放的，
  新窗口按离开时的位置再调一次 `play(song, startSec)`，交接前是暂停的就停在原位。所以 `play` 要能在一个新页面里从任意位置开始。
- **没加载时**：`getStatus` 什么都没加载时回空的 `mediaId`，不要抛错（否则每次窗口重建都多一条警告）；`isStatusForSong` 要能分清是不是这首。
- **DRM**：嵌入页在这里放不了网站的 DRM 媒体；隐藏时嵌入页可能自己暂停。盒子不接指针，要点击的页面（登录、验证）不能放进去，放在模组自己的界面里（比如面板里经 `folium.ui.embed` 嵌入）。
- 视频类条目记得在 `itemKinds` 里声明，并写 `routeOf`。

示范：[`dev/folium/sample-video-source`](../../dev/folium/sample-video-source/README.md)（三段测试视频走 surface，一首歌走宿主音频）。

## 5. main 入口与 `api` 的新成员

音源模组的 main 入口拿到的 `api` 是 [FoliumSourceMainApi](api.md#foliumsourcemainapi)：普通模组的全部成员，再加下面这些（普通模组没有）。
成员的签名和细节以 API 参考为准：

| 成员 | 做什么 |
| --- | --- |
| `api.net` | Electron `net` 的 `fetch` / `request`、自己的命名分区 `session(name)`、`resolveProxy` |
| `api.net.session(name)` | 分区里的 `fetch`、代理、清存储，以及给沙箱页用的 `intercept`（本分区的 http(s) 请求都由处理函数应答）和 `refusePermissions`（拒绝一切权限）。**这两个每个分区只调一次**：撤销不计数，`intercept` 每种 scheme 只有一个处理函数，`refusePermissions` 撤销时把分区的权限处理函数一起拿掉 |
| `api.media` | `allow(rule)`：给平台的媒体地址加跨域头（可带有效期、跟随重定向）；`serve(name, handler)`：`folia-mod://<模组 id>/_media/<name>/…` 的流，支持 Range；`url`、`parseRange` |
| `api.cache` | 并入宿主媒体缓存预算的目录 `dir()`、请宿主修剪 `requestPrune()`、把自己的缓存条目交给宿主的缓存视图 `provideEntries()` |
| `api.seal` | 用系统凭据库（safeStorage）加密 |
| `api.secrets` | 清单 `secrets` 声明的密钥槽（第三方音源保管会话用） |
| `api.windows` | 隐藏的沙箱窗口 `hidden()`、主窗口在不在 |
| `api.shell.openExternal`、`api.dialog.pickFile`、`api.host.locale` | 浏览器登录、选文件、界面语言 |
| `api.onBeforeUnload`、`api.onBeforeQuit` | 卸载前、退出前收尾（各最多等 3 秒）。`onBeforeQuit` 只要登记着，每次退出都会等它：只在真有收尾要做时登记，做完就撤 |
| `api.onPlayersOrphaned` | 主窗口没了、也没有窗口接手播放时，暂停应用外面的播放器 |
| `api.diagnostics` | 登录诊断报告与自检里这个音源的那一段 |
| `api.reportError` | 自己处理不了的错交进宿主的崩溃报告，不打扰用户 |
| `api.legacy.store`、`api.paths.legacy`、`api.cache.legacyDir`、`api.native` | 只给内置音源（和接管它们的副本）：受信表或 `claims` 里认领的旧 electron-store 键、userData 目录、旧缓存目录，以及原生件（内置与覆盖副本拿随应用带的，接管副本拿自己包里的） |

worker、子进程、本机 HTTP 服务用 Node 自带的。凭据（cookie、token、密码）的值不写进日志。

## 6. 用户怎么管它

- **三种状态**：「设置 → 音源」里每个音源一行，启用 / 只用于匹配 / 停用，命令面板里有同样的切换命令，切换不用重启。
  停用的音源什么都不运行（main 入口不 `require`、client 不导入、语言表和媒体规则都不登记），它在队列、历史、歌单里的歌留着、标「音源未启用」。
  「只用于匹配」只给声明了 `lyrics@1.crossSource` 或 `songs@1.metadataMatch`、并且对应能力匿名可用的音源：它不出现在切换器、登录、搜索里，
  一律按没登录对待，main 入口推迟到它的 client 第一次调 `folium.rpc` 时才启动。
- **清除数据**：登出并删掉它的会话（受信表或 `claims` 里的旧键和分区、`secrets`、`pageStore`）、`online_provider_<id>_*` 缓存、
  `api.cache.dir()` 和模组数据目录。和停用、卸载分开。
- **覆盖**：`userData/mods` 里同 id 的副本要官方签名校验通过、版本更高、`folia` 范围满足、用户确认过一次，才替代内置副本。
- **接管**：安装包没带某个内置音源时（安装包自己声明带了哪些），外部模组可以在 `sources[].claims` 里写明要接的短 id 和旧数据，
  经用户确认后以那个短 id 出现，旧登录、队列里的歌接着用。`claims` 不能超出受信表那一行；签名不匹配的不让接管；一个 id 只给先确认的那个模组。
  内置音源自己的旧媒体协议（如 `folia-fnmusic://`）只交给内置副本：接管的模组拿到短 id 后，存下来的这类旧地址回 404。
  安装包不带的音源也不带它的原生件：接管副本的 `api.native` 解析到自己目录里的 `native/<名字>/<platform>-<arch>/<入口>`（入口由宿主按名字定），
  名字要清单 `native` 与那一行 `native` 都写了；路上有符号链接或出了模组目录答 `native-unsafe-path`，没带本系统那份答
  `native-not-in-mod:<名字>:<系统>`。确认窗口会说它带着自己的原生程序。
- **打包**：仓库里的内置音源用 `npm run sources:pack -- <id>` 打成能「从 zip 安装」的包：清单补上受信表那一行的 `claims`，给了私钥就带
  `folium.sig.json`，声明了原生件的按系统带上那一份（`--system`；Apple Music 伴侣程序只有 Windows 的）。未签名的包只能接管，官方签名、
  版本更高的才能覆盖。各家装上后能跑到哪一步见 [`dev/sources/README.md`](../../dev/sources/README.md) 的「打成 zip」。

### 分发

第三方音源模组不收进 folium-compound 仓库，也不经它签名：放在你自己的仓库里发布 zip，再到 folium-compound 开
[「Awesome-Folia 登记」issue](https://github.com/chthollyphile/folium-compound/issues/new?template=awesome-entry.yml)，以外部链接登记。
它会出现在应用里模组市场的「Awesome-Folia · 外部作品」一段，用户点「前往仓库」下载，拖进「设置 → 模组」安装（要先打开「社区模组」），
有问题也去你的仓库反馈。清单里写上 `repository` 和 `bugs`，模组详情里就有这两个链接。

## 7. 从实验接口 `omni.providers` 迁过来

Folium 1 的实验接口 `omni.providers`（[FoliumOmniProviderDef](api.md#foliumomniproviderdef)）还能用，它现在是新注册表上的一层薄壳。
要更多能力（登录、曲库、歌单改动、外部播放、自己的网络与存储）就改写成音源模组：

1. 清单改 `"folium": 2`，加 `sources`，去掉 `experimental` 里的 `omni.providers` 和为它声明的 `net.fetch`。
2. `search` → `search@1`，`getSong` → `songs@1`，`getAudioUrl` → `playback.audio@1`，`getLyrics` → `lyrics@1`；歌曲从
   `FoliumProviderSong` 换成 [FoliumSourceSong](api.md#foliumsourcesong)。
3. 要在主进程里请求的（凭据加密、跨域、本地服务）挪进 main 入口，用 `api.net`、`api.seal`、`api.media`。

## 8. 示范与仓库里的音源

- [`dev/folium/sample-source-full`](../../dev/folium/sample-source-full/README.md)：实现每个标准能力族的契约测试音源，外加一个外部播放器音源和一个自定义能力。
- [`dev/folium/sample-video-source`](../../dev/folium/sample-video-source/README.md)：`playback.surface@1`。
- 仓库里的十个内置音源在 [`sources/`](../../sources/README.md)，每家的 `README.md` 写它靠哪个上游、版本钉在哪。它们怎么构建、依赖怎么打包、
  安装包带哪几家见 [`dev/sources/README.md`](../../dev/sources/README.md)。往 Folia 仓库里加一个平台的步骤见
  [`src/services/onlineMusic/README.md`](../../src/services/onlineMusic/README.md) 的「接入一个新平台」。
