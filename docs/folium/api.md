<!-- 本文件由 `npm run folium:api` 从 src/mods/folium/contract.ts、sources/contract.ts 和 mainContract.ts 生成，请勿手动修改。 -->

# Folium API 参考

当前契约版本：**Folium 2.0**。

> **预览**：Folium 2 的音源接口（`folium.sources` 与音源类模组 main 入口的 `api`）还是预览版，九个内置音源全部迁过去之前可能变动；用它写的模组可能要随新版本更新。`folium: 1` 冻结在 Folium 1.9 的接口不受影响。

本文列出模组能用到的全部公开类型，内容直接来自契约文件 [`src/mods/folium/contract.ts`](../../src/mods/folium/contract.ts)
（client 入口）、[`src/mods/folium/sources/contract.ts`](../../src/mods/folium/sources/contract.ts)（音源）与 [`src/mods/folium/mainContract.ts`](../../src/mods/folium/mainContract.ts)（main 入口），
`mod.json` 写 `"folium": 1` 的模组看到的接口冻结在 Folium 1.9（`folium.host.folium` 读到 1.9，没有标着 Folium 2 的成员）。
成员说明保留契约里的原文注释。平台规则（清单、权限、生命周期、安全模型）见 [Folium 规范](../../mods/README.md)，
从零开始写模组、调试与发布到模组市场见 [模组开发与贡献指南](contributing.md)。

## 目录

- **客户端入口**：[权限一览](#权限一览) · [FoliumContextKind](#foliumcontextkind) · [FoliumHostInfo](#foliumhostinfo) · [FoliumStorage](#foliumstorage) · [FoliumSecretAccess](#foliumsecretaccess) · [FoliumRpc](#foliumrpc) · [FoliumLogger](#foliumlogger) · [FoliumClientApi](#foliumclientapi) · [FoliumClientModule](#foliumclientmodule)
- **注册表与条目**：[注册表一览](#注册表一览) · [FoliumVisualizerDef](#foliumvisualizerdef) · [FoliumTuningDef](#foliumtuningdef) · [FoliumCommandContext](#foliumcommandcontext) · [FoliumCommandDef](#foliumcommanddef) · [FoliumBackgroundContext](#foliumbackgroundcontext) · [FoliumBackgroundDef](#foliumbackgrounddef) · [FoliumStageSlot](#foliumstageslot) · [FoliumStageLayerDef](#foliumstagelayerdef) · [FoliumSettingsSectionDef](#foliumsettingssectiondef) · [FoliumPlayerPanelTabDef](#foliumplayerpaneltabdef) · [FoliumHomeTabDef](#foliumhometabdef) · [FoliumProgressContext](#foliumprogresscontext) · [FoliumProgressButtonSlot](#foliumprogressbuttonslot) · [FoliumProgressButtonDef](#foliumprogressbuttondef) · [FoliumProgressLayerDef](#foliumprogresslayerdef) · [FoliumStyleDef](#foliumstyledef) · [FoliumRegistryHandle](#foliumregistryhandle) · [FoliumSettingsSectionHandle](#foliumsettingssectionhandle) · [FoliumRegistry](#foliumregistry) · [FoliumRegistries](#foliumregistries)
- **宿主容器与上下文**：[FoliumMount](#foliummount) · [FoliumSize](#foliumsize) · [FoliumMountHelpers](#foliummounthelpers) · [FoliumPanelContext](#foliumpanelcontext) · [FoliumSettingsPanelContext](#foliumsettingspanelcontext) · [FoliumClock](#foliumclock) · [FoliumSurface](#foliumsurface) · [FoliumAudioBands](#foliumaudiobands) · [FoliumAudio](#foliumaudio) · [FoliumDisplay](#foliumdisplay) · [FoliumStageContext](#foliumstagecontext)
- **事件**：[事件一览](#事件一览) · [FoliumEventPriority](#foliumeventpriority) · [FoliumPlaybackFailureReason](#foliumplaybackfailurereason) · [FoliumNotificationEvents](#foliumnotificationevents) · [FoliumLyricsTransformEvent](#foliumlyricstransformevent) · [FoliumBeforePlayEvent](#foliumbeforeplayevent) · [FoliumOmniLyricsEvent](#foliumomnilyricsevent) · [FoliumOmniAudioEvent](#foliumomniaudioevent) · [FoliumHookEvents](#foliumhookevents) · [FoliumEventMap](#foliumeventmap) · [FoliumEvents](#foliumevents)
- **服务**：[FoliumPlaybackService](#foliumplaybackservice) · [FoliumFileHandle](#foliumfilehandle) · [FoliumIconOptions](#foliumiconoptions) · [FoliumUiService](#foliumuiservice) · [FoliumFetchInit](#foliumfetchinit) · [FoliumFetchResponse](#foliumfetchresponse) · [FoliumLyricsService](#foliumlyricsservice) · [FoliumNetService](#foliumnetservice) · [FoliumAccountState](#foliumaccountstate) · [FoliumAccountService](#foliumaccountservice) · [FoliumSongKey](#foliumsongkey) · [FoliumOmniProviderInfo](#foliumomniproviderinfo) · [FoliumOmniPage](#foliumomnipage) · [FoliumSongResolution](#foliumsongresolution) · [FoliumSongDetails](#foliumsongdetails) · [FoliumOmniLyrics](#foliumomnilyrics) · [FoliumCollectionKey](#foliumcollectionkey) · [FoliumCollection](#foliumcollection) · [FoliumOmniErrorCode](#foliumomnierrorcode) · [FoliumOmniService](#foliumomniservice) · [FoliumEqualizerBand](#foliumequalizerband) · [FoliumEqualizerPresetId](#foliumequalizerpresetid) · [FoliumEqualizerCustomId](#foliumequalizercustomid) · [FoliumEqualizerUserMode](#foliumequalizerusermode) · [FoliumEqualizerMode](#foliumequalizermode) · [FoliumEqualizerState](#foliumequalizerstate) · [FoliumEqualizerChangeOrigin](#foliumequalizerchangeorigin) · [FoliumEqualizerRefusal](#foliumequalizerrefusal) · [FoliumEqualizerWriteResult](#foliumequalizerwriteresult) · [FoliumEqualizerService](#foliumequalizerservice) · [FoliumLyricRenderScale](#foliumlyricrenderscale) · [FoliumLyricAntialias](#foliumlyricantialias) · [FoliumLyricRenderQuality](#foliumlyricrenderquality) · [FoliumRenderQualityChangeOrigin](#foliumrenderqualitychangeorigin) · [FoliumRenderQualityRefusal](#foliumrenderqualityrefusal) · [FoliumRenderQualityWriteResult](#foliumrenderqualitywriteresult) · [FoliumVisualizerChangeOrigin](#foliumvisualizerchangeorigin) · [FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal) · [FoliumTuningKeyInfo](#foliumtuningkeyinfo) · [FoliumTuningValue](#foliumtuningvalue) · [FoliumVisualizerTuning](#foliumvisualizertuning) · [FoliumBeatEffectSource](#foliumbeateffectsource) · [FoliumBeatEffectPartInfo](#foliumbeateffectpartinfo) · [FoliumBeatEffectInfo](#foliumbeateffectinfo) · [FoliumVisualizerModeInfo](#foliumvisualizermodeinfo) · [FoliumBeatEffectState](#foliumbeateffectstate) · [FoliumSmartBeatMode](#foliumsmartbeatmode) · [FoliumBeatEffectsState](#foliumbeateffectsstate) · [FoliumBeatEffectPatch](#foliumbeateffectpatch) · [FoliumModeWriteResult](#foliummodewriteresult) · [FoliumTuningWriteResult](#foliumtuningwriteresult) · [FoliumBeatEffectsWriteResult](#foliumbeateffectswriteresult) · [FoliumBackgroundInfo](#foliumbackgroundinfo) · [FoliumAnimationIntensity](#foliumanimationintensity) · [FoliumBackgroundWriteResult](#foliumbackgroundwriteresult) · [FoliumAnimationIntensityWriteResult](#foliumanimationintensitywriteresult) · [FoliumVisualizerService](#foliumvisualizerservice)
- **共享工具**：[FoliumWordSegment](#foliumwordsegment) · [FoliumWordColorRange](#foliumwordcolorrange) · [FoliumLyricsHelpers](#foliumlyricshelpers) · [FoliumThemeHelpers](#foliumthemehelpers)
- **设置 schema**：[FoliumSettingType](#foliumsettingtype) · [FoliumSettingOption](#foliumsettingoption) · [FoliumSetting](#foliumsetting) · [FoliumSettingValues](#foliumsettingvalues) · [FoliumSettingAccess](#foliumsettingaccess)
- **数据结构**：[FoliumLyricRuby](#foliumlyricruby) · [FoliumLyricSyllable](#foliumlyricsyllable) · [FoliumLyricAlternateText](#foliumlyricalternatetext) · [FoliumWord](#foliumword) · [FoliumBackgroundVocal](#foliumbackgroundvocal) · [FoliumLineTimingClass](#foliumlinetimingclass) · [FoliumLineTransitionMode](#foliumlinetransitionmode) · [FoliumWordRevealMode](#foliumwordrevealmode) · [FoliumLineRenderHints](#foliumlinerenderhints) · [FoliumLine](#foliumline) · [FoliumTheme](#foliumtheme) · [FoliumSong](#foliumsong) · [FoliumPlaybackState](#foliumplaybackstate) · [FoliumLoopMode](#foliumloopmode) · [FoliumQueueItem](#foliumqueueitem) · [FoliumQueueSnapshot](#foliumqueuesnapshot) · [FoliumQueueChange](#foliumqueuechange) · [FoliumQueueReplaceRefusal](#foliumqueuereplacerefusal) · [FoliumQueueReplaced](#foliumqueuereplaced) · [FoliumQueueReplaceRefused](#foliumqueuereplacerefused) · [FoliumQueueReplaceResult](#foliumqueuereplaceresult) · [FoliumPlaybackSnapshot](#foliumplaybacksnapshot) · [FoliumLyricFormat](#foliumlyricformat) · [FoliumLyricsTrack](#foliumlyricstrack) · [FoliumLyricsResult](#foliumlyricsresult) · [FoliumLegacyLyricsResult](#foliumlegacylyricsresult) · [FoliumParsedLyrics](#foliumparsedlyrics)
- **音源（Folium 2）**：[FoliumText](#foliumtext) · [FoliumTextKey](#foliumtextkey) · [FoliumI18nService](#foliumi18nservice) · [FoliumSourceCapabilityId](#foliumsourcecapabilityid) · [FoliumSourceCapabilities](#foliumsourcecapabilities) · [FoliumSourceMark](#foliumsourcemark) · [FoliumSourceAvailability](#foliumsourceavailability) · [FoliumSourceDef](#foliumsourcedef) · [FoliumSourceItemKind](#foliumsourceitemkind) · [FoliumSourceHandle](#foliumsourcehandle) · [FoliumSourceNotice](#foliumsourcenotice) · [FoliumSourceErrorCode](#foliumsourceerrorcode) · [FoliumSourceErrorDetails](#foliumsourceerrordetails) · [FoliumSourceError](#foliumsourceerror) · [FoliumSourcePageStore](#foliumsourcepagestore) · [FoliumSourcesService](#foliumsourcesservice) · [FoliumSourcePage](#foliumsourcepage) · [FoliumSourceNamedRef](#foliumsourcenamedref) · [FoliumSourceAlbumRef](#foliumsourcealbumref) · [FoliumSourceReplayGain](#foliumsourcereplaygain) · [FoliumSourceSong](#foliumsourcesong) · [FoliumSourceUser](#foliumsourceuser) · [FoliumSourceFmLaunch](#foliumsourcefmlaunch) · [FoliumSourceCollection](#foliumsourcecollection) · [FoliumSourceSearchContext](#foliumsourcesearchcontext) · [FoliumSourceAccess](#foliumsourceaccess) · [FoliumSourceSearch](#foliumsourcesearch) · [FoliumSourceSongAvailability](#foliumsourcesongavailability) · [FoliumSourceSongs](#foliumsourcesongs) · [FoliumSourceAudioQuality](#foliumsourceaudioquality) · [FoliumSourceAudio](#foliumsourceaudio) · [FoliumSourceAudioPlayback](#foliumsourceaudioplayback) · [FoliumSourceExternalStatus](#foliumsourceexternalstatus) · [FoliumSourceExternalPlayback](#foliumsourceexternalplayback) · [FoliumSourceSurfacePlayback](#foliumsourcesurfaceplayback) · [FoliumSourcePlaybackReport](#foliumsourceplaybackreport) · [FoliumSourceReports](#foliumsourcereports) · [FoliumSourceLyricFormat](#foliumsourcelyricformat) · [FoliumSourceLyricsTrack](#foliumsourcelyricstrack) · [FoliumSourceLyricsResult](#foliumsourcelyricsresult) · [FoliumSourceLyricAlias](#foliumsourcelyricalias) · [FoliumSourceLyrics](#foliumsourcelyrics) · [FoliumSourceLoginCase](#foliumsourcelogincase) · [FoliumSourceLoginFailure](#foliumsourceloginfailure) · [FoliumSourceFailureCase](#foliumsourcefailurecase) · [FoliumSourceFailureDetail](#foliumsourcefailuredetail) · [FoliumSourceLoginState](#foliumsourceloginstate) · [FoliumSourceLoginStep](#foliumsourceloginstep) · [FoliumSourceLoginMethod](#foliumsourceloginmethod) · [FoliumSourceLoginTexts](#foliumsourcelogintexts) · [FoliumSourceLoginForm](#foliumsourceloginform) · [FoliumSourceLocalService](#foliumsourcelocalservice) · [FoliumSourceSetupStep](#foliumsourcesetupstep) · [FoliumSourceSetupView](#foliumsourcesetupview) · [FoliumSourceDiagnosticLine](#foliumsourcediagnosticline) · [FoliumSourceSelfCheck](#foliumsourceselfcheck) · [FoliumSourceKeptAccount](#foliumsourcekeptaccount) · [FoliumSourceAuth](#foliumsourceauth) · [FoliumSourceLibrary](#foliumsourcelibrary) · [FoliumSourceCatalog](#foliumsourcecatalog) · [FoliumSourceFmCatalog](#foliumsourcefmcatalog) · [FoliumSourcePreference](#foliumsourcepreference) · [FoliumSourcePreferences](#foliumsourcepreferences) · [FoliumSourceRecommendations](#foliumsourcerecommendations) · [FoliumSourceExploreItem](#foliumsourceexploreitem) · [FoliumSourceExploreSection](#foliumsourceexploresection) · [FoliumSourceExplorePage](#foliumsourceexplorepage) · [FoliumSourceExplore](#foliumsourceexplore) · [FoliumSourceMutations](#foliumsourcemutations) · [FoliumSourceCovers](#foliumsourcecovers) · [FoliumSourceRawEndpoint](#foliumsourcerawendpoint) · [FoliumSourceRaw](#foliumsourceraw)
- **实验接口**：[FoliumLayoutRect](#foliumlayoutrect) · [FoliumPlayerObstacle](#foliumplayerobstacle) · [FoliumPlayerLayout](#foliumplayerlayout) · [FoliumRemoteActionDef](#foliumremoteactiondef) · [FoliumRemoteActionsContext](#foliumremoteactionscontext) · [FoliumRemoteActionsDef](#foliumremoteactionsdef) · [FoliumRemoteActionsHandle](#foliumremoteactionshandle) · [FoliumProviderSong](#foliumprovidersong) · [FoliumAudioQuality](#foliumaudioquality) · [FoliumOmniProviderDef](#foliumomniproviderdef) · [FoliumJsonValue](#foliumjsonvalue) · [FoliumPlatformBackend](#foliumplatformbackend) · [FoliumPlatformDescription](#foliumplatformdescription) · [FoliumPlatformResponse](#foliumplatformresponse) · [FoliumPlatformErrorCode](#foliumplatformerrorcode) · [FoliumPlatformService](#foliumplatformservice)
- **main 入口（Node）**：[FoliumMainModule](#foliummainmodule) · [FoliumMainApi](#foliummainapi) · [FoliumManifest](#foliummanifest) · [FoliumMainStorage](#foliummainstorage) · [FoliumModPaths](#foliummodpaths) · [FoliumMainPaths](#foliummainpaths) · [FoliumMainRuntime](#foliummainruntime) · [FoliumMainRpc](#foliummainrpc) · [FoliumMainRender](#foliummainrender) · [FoliumExportSpec](#foliumexportspec) · [FoliumExportResult](#foliumexportresult)
- **音源类模组的 main 入口**：[FoliumSourceMainApi](#foliumsourcemainapi) · [FoliumSourceHostInfo](#foliumsourcehostinfo) · [FoliumSourceMainPaths](#foliumsourcemainpaths) · [FoliumSourceDiagnostics](#foliumsourcediagnostics) · [FoliumSourceNative](#foliumsourcenative) · [FoliumSourceNet](#foliumsourcenet) · [FoliumSourceNetSession](#foliumsourcenetsession) · [FoliumSourceRequestOptions](#foliumsourcerequestoptions) · [FoliumSourceIncomingMessage](#foliumsourceincomingmessage) · [FoliumSourceClientRequest](#foliumsourceclientrequest) · [FoliumSourceMediaRequest](#foliumsourcemediarequest) · [FoliumSourceLegacyStore](#foliumsourcelegacystore) · [FoliumSourceSeal](#foliumsourceseal) · [FoliumSourceCache](#foliumsourcecache) · [FoliumSourceCacheEntries](#foliumsourcecacheentries) · [FoliumSourceMediaRule](#foliumsourcemediarule) · [FoliumSourceMediaAllowed](#foliumsourcemediaallowed) · [FoliumSourceMedia](#foliumsourcemedia) · [FoliumSourceWindows](#foliumsourcewindows)
- **基础类型**：[FOLIUM_VERSION](#folium_version) · [FoliumId](#foliumid) · [FoliumLabel](#foliumlabel) · [FoliumDisposer](#foliumdisposer)
- **[仍可用的旧名字](#仍可用的旧名字)**

## 客户端入口

模组的 `client` 入口默认导出 `activate(folium)`，参数就是 [FoliumClientApi](#foliumclientapi)，所有能力都从这里取。数据文件 `folium.storage`、密钥字段的值 `folium.secrets`（Folium 1.7）和通往 main 入口的 `folium.rpc` 也在这一节。

### 权限一览

本表由 `electron/modSystem/foliumShared.json` 里每个权限的 `guards` 生成，`npm run folium:check` 用同一张表查模组用到的成员。`platform.*` 两行例外：模组只能写成 `folium.experimental['platform.raw']`，表里的成员名只是说明；`folium:check` 改为按代码里 `request('<平台>', …)` 写出的平台 id 查 `platform.<平台>.read`，`.write` 要看调的是哪个接口，查不到。

| 权限 | 解锁的成员 |
| --- | --- |
| `filesystem.data` | `folium.storage`、`api.storage` |
| `playback.read` | `api.runtime.getPlaybackSnapshot` |
| `playback.control` | `folium.playback.play`、`folium.playback.pause`、`folium.playback.toggle`、`folium.playback.seek`、`folium.playback.seekToLyricTime`、`folium.playback.next`、`folium.playback.previous`、`folium.playback.playSong`、`folium.playback.enqueue`、`folium.playback.shuffleQueue`、`folium.playback.toggleLike`、`folium.playback.setVolume`、`folium.playback.setMuted`、`folium.playback.setLoopMode`、`folium.playback.playQueueItem` |
| `playback.queue` | `folium.playback.replaceQueue` |
| `equalizer.control` | `folium.equalizer.setMode`、`folium.equalizer.applyCurve`、`folium.equalizer.releaseCurve` |
| `visualizer.renderQuality` | `folium.visualizer.setRenderQuality` |
| `visualizer.mode` | `folium.visualizer.setMode` |
| `visualizer.tuning` | `folium.visualizer.setTuning` |
| `visualizer.beatEffects` | `folium.visualizer.setBeatEffects` |
| `visualizer.background` | `folium.visualizer.setBackground` |
| `visualizer.animationIntensity` | `folium.visualizer.setAnimationIntensity` |
| `render.export` | `api.render.exportVideo` |
| `net.fetch` | `folium.net.fetch` |
| `net.embed` | `folium.ui.embed` |
| `stageLayers` | `folium.registries.stageLayers` |
| `platform.netease.read` | `folium.experimental.platform.raw.request` |
| `platform.netease.write` | `folium.experimental.platform.raw.request.write` |

`folium.*` 是 client 入口的成员，`api.*` 是 main 入口的成员；写到哪一级就管到哪一级，`folium.storage` 管它下面的全部方法。
模组没有在 `mod.json` 的 `permissions` 里声明这个权限就调用时，同步的成员抛 `permission-denied:<权限>`，异步的成员返回的 promise 以同一个错误拒绝。
`platform.<平台>.read` / `.write` 管的是实验接口 `platform.raw` 的 `request` 能调这个平台的哪一类接口：读接口要 read，改动账号的接口还要 write（表里的 `request.write` 指这一类接口，不是一个成员）；两者都要在 `experimental` 里选用 `platform.raw`，声明 write 也要同时声明 read。

### FoliumContextKind

Where a client runs: the main window, or the transparent video export window.

```ts
type FoliumContextKind = 'main' | 'export'
```

### FoliumHostInfo

The host's versions (`folium.host`), for display and logs. Every member of this contract is there from
Folium 1.7 on; an older 1.x host lacks some of them. Folium 2.0: a mod whose mod.json says `folium: 1`
reads 1.9 here, the version its interface stays at; a `folium: 2` mod reads the host's own. A host that
runs a `folium: 2` mod has every member a "check `folium.host.folium.minor >= …`" below speaks of: such a
check is for `folium: 1` mods (in a `folium: 2` mod, check `major >= 2` or nothing).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `folium` | `{ major: number; minor: number }` | The Folium version (`major`, `minor`). |
| `folia` | `string \| null` | Folia app version, or null when the host cannot tell. |

### FoliumStorage

`folium.storage`: this mod's data file (shared with its main entry, 1 MB). Needs the `filesystem.data`
permission; values must be JSON-serializable.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `get()` | `<T = unknown>(key: string): Promise<T \| undefined>` | The stored value, or undefined. |
| `set()` | `(key: string, value: unknown): Promise<void>` | Stores a JSON-serializable value. |
| `has()` | `(key: string): Promise<boolean>` | Whether the key exists. |
| `delete()` | `(key: string): Promise<void>` | Removes the key. |
| `keys()` | `(): Promise<string[]>` | All keys. |

### FoliumSecretAccess

Folium 1.7: `folium.secrets` (client) and `api.secrets` (main entry), the values of this mod's `secret`
settings fields. One store per mod, shared by both entries and the settings form, keyed by the field's
`key`; a mod reaches only its own. A key that no settings section of this mod declares as `secret` is
refused with `secret-undeclared:<key>`. The host learns the keys when the client registers the section,
and on every start of Folia the main entry runs before that: until the client has registered, `get` and
`has` of a key with no value give null and false (a key that holds a value works as usual), and `set` of
a key with no value is refused with `secret-undeclared:<key>`. Reloading the mod keeps what the host
learned in this run. A value is a string of at most 8 KB (UTF-8); a longer one is refused with
`secret-too-large:8192`.

The host keeps the values in the main process, encrypted with the system's credential store (DPAPI on
Windows, Keychain on macOS, libsecret or kwallet on Linux), in a file of its own beside the mod's data
file, and never logs them. Where the system has no such store (Linux falling back to `basic_text`), it
keeps them in memory only, for this run, and the settings form says so. No permission is needed.

In the export window `get`, `has` and `set` reject with `secrets-unavailable-in-export-context`, and
`subscribe` never fires.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `get()` | `(key: string): Promise<string \| null>` | The stored value, or null when none is set (or the credential store cannot decrypt it right now). |
| `has()` | `(key: string): Promise<boolean>` | Whether a value is stored, without handing it over. |
| `set()` | `(key: string, value: string \| null): Promise<void>` | Stores `value`; null or an empty string clears it. |
| `subscribe()` | `(listener: (key: string) => void): FoliumDisposer` | Calls `listener` with the key, never the value, after a value is saved or cleared, whoever did it (the settings form, the client or the main entry). The host stops it when the mod stops. |

相关：[FoliumDisposer](#foliumdisposer)

### FoliumRpc

`folium.rpc`: calls into this mod's main entry, and (Folium 1.7) hears the messages it sends.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `call()` | `<T = unknown>(name: string, ...args: unknown[]): Promise<T>` | Calls the function the main entry registered with `api.rpc.handle(name, fn)`; arguments and result must be JSON-serializable. |
| `on()` | `(name: string, listener: (payload: unknown) => void): FoliumDisposer` | Folium 1.7: receives the main entry's `api.rpc.send(name, payload)`. Several listeners per name are fine; each gets its own copy of the payload (`null` when the main entry sent none), and one that throws is logged under the mod without stopping the others. Only messages from this mod's own main entry arrive, and nothing sent before the listener was added is replayed: fetch the current state once with `rpc.call` after adding it. `name` must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, and `listener` must be a function, or this throws. The listener is removed when the mod stops. In the export window nothing is ever sent: the listener is accepted and never called. Older 1.x hosts lack it: check `folium.host.folium.minor >= 7`. |

相关：[FoliumDisposer](#foliumdisposer)

### FoliumLogger

`folium.log`. `error` entries show in the mods panel under the mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `info()` | `(message: string, details?: unknown): void` | Informational log. |
| `warn()` | `(message: string, details?: unknown): void` | Warning. |
| `error()` | `(message: string, details?: unknown): void` | Error; shown in the mods panel. |

### FoliumClientApi

The object a client entry's `activate(folium)` receives.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly modId` | `string` | This mod's id. |
| `readonly host` | `FoliumHostInfo` | Host versions, for display and logs. |
| `readonly env` | `{ readonly context: FoliumContextKind }` | Where this client runs. |
| `readonly log` | `FoliumLogger` | Logging. |
| `readonly registries` | `FoliumRegistries` | Everything a mod can add to the host. |
| `readonly events` | `FoliumEvents` | The event bus. |
| `readonly playback` | `FoliumPlaybackService` | Playback state and control. |
| `readonly ui` | `FoliumUiService` | Toasts, panels, files, embeds, icons. |
| `readonly net` | `FoliumNetService` | Network access through the host. |
| `readonly storage` | `FoliumStorage` | This mod's data file. |
| `readonly secrets` | `FoliumSecretAccess` | Folium 1.7: the values of this mod's `secret` settings fields. |
| `readonly rpc` | `FoliumRpc` | Calls into this mod's main entry. |
| `readonly lyrics` | `FoliumLyricsService` | The lyric helpers builtin modes use, and the displayed song's lyrics. |
| `readonly theme` | `FoliumThemeHelpers` | The theme helpers builtin modes use. |
| `readonly account` | `FoliumAccountService` | Folium 1.7: who is signed in to the online sources. |
| `readonly omni` | `FoliumOmniService` | Folium 1.7: the host's online music sources, read only: search, songs by id, lyrics, albums, artists. |
| `readonly equalizer` | `FoliumEqualizerService` | Folium 1.7: the host's graphic equalizer: read it, switch the user's sound, put a curve of your own in place. |
| `readonly visualizer` | `FoliumVisualizerService` | Folium 1.8: the host's settings of the lyric display: the global lyric render quality. |
| `readonly sources` | `FoliumSourcesService` | Folium 2 (a `folium: 1` mod has none): a source mod's sources (`sources` in mod.json). Any `folium: 2` mod may ask `supports`; only a source mod registers. |
| `readonly i18n` | `FoliumI18nService` | Folium 2 (a `folium: 1` mod has none): texts from the mod's own locale files (`locales` in mod.json). |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | Calls `listener` every `ms` milliseconds (at least 16) until the mod stops; the host stops it then. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | Runs `disposer` when the mod stops, after the disposer `activate` returned; at once when the mod has already stopped. |
| `readonly experimental` | `Readonly<Record<string, unknown>>` | Unfrozen surfaces; each requires the matching manifest `experimental` opt-in. |

相关：[FoliumHostInfo](#foliumhostinfo) · [FoliumContextKind](#foliumcontextkind) · [FoliumLogger](#foliumlogger) · [FoliumRegistries](#foliumregistries) · [FoliumEvents](#foliumevents) · [FoliumPlaybackService](#foliumplaybackservice) · [FoliumUiService](#foliumuiservice) · [FoliumNetService](#foliumnetservice) · [FoliumStorage](#foliumstorage) · [FoliumSecretAccess](#foliumsecretaccess) · [FoliumRpc](#foliumrpc) · [FoliumLyricsService](#foliumlyricsservice) · [FoliumThemeHelpers](#foliumthemehelpers) · [FoliumAccountService](#foliumaccountservice) · [FoliumOmniService](#foliumomniservice) · [FoliumEqualizerService](#foliumequalizerservice) · [FoliumVisualizerService](#foliumvisualizerservice) · [FoliumSourcesService](#foliumsourcesservice) · [FoliumI18nService](#foliumi18nservice) · [FoliumDisposer](#foliumdisposer)

### FoliumClientModule

The shape of a client entry module.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `default` | `(folium: FoliumClientApi) => void \| FoliumDisposer \| Promise<void \| FoliumDisposer>` | `activate(folium)`; may return a disposer, which runs before the host removes the mod's registrations. |

相关：[FoliumClientApi](#foliumclientapi) · [FoliumDisposer](#foliumdisposer)

## 注册表与条目

`folium.registries.<名称>.register(def)` 返回 [FoliumRegistryHandle](#foliumregistryhandle)。条目 id 由宿主加上命名空间成为 `<modid>:<id>`；模组停用时宿主自动撤下它注册的一切。

### 注册表一览

本表由宿主里那张条目种类表（`src/mods/folium/kinds.ts`）生成。

| 注册表 | 用途 | 条目定义 | 需要的权限 | 导出窗口里 | 容器的 `data-folium-kind` |
| --- | --- | --- | --- | --- | --- |
| `visualizers` | 歌词动画模式 | [FoliumVisualizerDef](#foliumvisualizerdef) | — | 生效 | `visualizer`、`visualizer-settings` |
| `tunings` | 给声明了 Folium 可调键的内置模式调参 | [FoliumTuningDef](#foliumtuningdef) | — | 生效 | `tuning` |
| `commands` | 命令：出现在模组面板与命令面板 | [FoliumCommandDef](#foliumcommanddef) | — | 不生效 | — |
| `backgrounds` | 背景类型（出现在背景选择器，预览与导出同样生效） | [FoliumBackgroundDef](#foliumbackgrounddef) | — | 生效 | `background`、`background-settings` |
| `stageLayers` | 播放页图层 | [FoliumStageLayerDef](#foliumstagelayerdef) | `stageLayers` | 不生效 | `stage-layer` |
| `settingsSections` | 模组自己的设置，显示在模组面板里该模组展开后的区域 | [FoliumSettingsSectionDef](#foliumsettingssectiondef) | — | 生效 | `settings-section` |
| `playerPanelTabs` | 播放器面板的标签页 | [FoliumPlayerPanelTabDef](#foliumplayerpaneltabdef) | — | 不生效 | `panel-tab` |
| `homeTabs` | 首页导航末尾的整页（网格与 Bravais 首页都有），用 `folium.ui.openHomeTab` 打开 | [FoliumHomeTabDef](#foliumhometabdef) | — | 不生效 | `home-tab` |
| `progressButtons` | 进度条左右的按钮（`progress.leading` / `progress.trailing`） | [FoliumProgressButtonDef](#foliumprogressbuttondef) | — | 不生效 | `progress-button` |
| `progressLayers` | 叠在进度条轨道上的图层 | [FoliumProgressLayerDef](#foliumprogresslayerdef) | — | 不生效 | `progress-layer` |
| `styles` | 模组 CSS，只针对公开 part | [FoliumStyleDef](#foliumstyledef) | — | 不生效 | — |

「导出窗口里不生效」的注册表在导出窗口里照常调用、照常返回句柄，但什么都不登记，所以同一份代码两边都能跑。
需要权限的注册表，模组没有在 `mod.json` 里声明这个权限时，`register` 抛 `permission-denied:<权限>`。
最后一列是这种条目的容器外层 `data-folium-kind` 属性的取值（没有容器的写 —）。

### FoliumVisualizerDef

A lyric animation mode. Its mode id is `mod:<modid>:<id>`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id; the mode id becomes `mod:<modid>:<id>`. |
| `label` | `FoliumLabel` | Name in the mode picker. |
| `order?` | `number` | Position in the mode picker; default 500 (after builtin modes). |
| `mount` | `FoliumMount<FoliumStageContext>` | Draws the visualizer into its container. |
| `settings?` | `FoliumSetting[]` | Settings schema; the host renders the form under the mode picker, persists the values and includes them in visual config import/export. |
| `settingsPanel?` | `FoliumMount<FoliumSettingsPanelContext>` | Replaces the host-rendered form; values still follow `settings`. |
| `hostLayers?` | `{ background?: boolean; subtitles?: boolean }` | Host-rendered layers around the visualizer. Both default to true. |

相关：[FoliumLabel](#foliumlabel) · [FoliumMount](#foliummount) · [FoliumStageContext](#foliumstagecontext) · [FoliumSetting](#foliumsetting) · [FoliumSettingsPanelContext](#foliumsettingspanelcontext)

### FoliumTuningDef

Extra tuning knobs for a builtin visualizer mode that declares Folium tunables.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `target` | `string` | A builtin visualizer mode that declares `foliumTunables`, e.g. "sonnet". |
| `label` | `FoliumLabel` | Card title. |
| `settings` | `FoliumSetting[]` | Number fields only; keys and ranges are checked against the target's whitelist. |

相关：[FoliumLabel](#foliumlabel) · [FoliumSetting](#foliumsetting)

### FoliumCommandContext

What a command receives when it runs.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly values` | `FoliumSettingValues` | Validated parameter values (defaults merged). |

相关：[FoliumSettingValues](#foliumsettingvalues)

### FoliumCommandDef

A command in the mods panel and the command palette. `run` executes in the renderer; hand Node work to the
main entry through `folium.rpc`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `label` | `FoliumLabel` | Command name. |
| `description?` | `FoliumLabel` | Shown under the name. |
| `keywords?` | `string[]` | Extra search terms for the command palette (label texts are always included). |
| `params?` | `FoliumSetting[]` | The command's parameters, asked for in a form before it runs (the mods panel's card, or the command palette, which opens the form for a command that has any). |
| `globalShortcut?` | `boolean` | Folium 1.7: offer this command in Settings → Global shortcuts (desktop app), listed after the host's playback commands under the mod's name. The user presses the combination there (modifiers of their choice, within the host's rules against combinations other programs surely use, plus a letter, a digit, F1–F24, Space, Tab, Enter, Backspace, Delete or one of the navigation keys); the mod never sees or chooses one. Only for commands without `params`, since a key press cannot fill a form: the host ignores the flag on a command that has any. A press runs `run` with an empty `values` object and shows no result, so use `folium.ui.toast` when the press needs feedback; a throw is recorded against the mod like any failed command. While the mod is stopped or disabled the binding is kept but its combination is not registered, and it comes back when the command is registered again. Not offered on native Wayland, where the desktop's shortcut portal takes a fixed list of the host's playback commands. Needs no permission: binding a combination in Settings is the user's consent. |
| `run()` | `(ctx: FoliumCommandContext): unknown \| Promise<unknown>` | Runs the command; the result is shown as a summary (a string, `{ outputPath }` or `{ message }`). |

相关：[FoliumLabel](#foliumlabel) · [FoliumSetting](#foliumsetting) · [FoliumCommandContext](#foliumcommandcontext)

### FoliumBackgroundContext

Lyric-free context for background types: they paint behind every mode, previews included. `onChange` fires
when pause, theme, settings or cover change.

```ts
interface FoliumBackgroundContext extends FoliumMountHelpers
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly staticMode` | `boolean` | A still preview: draw one frame, do not animate. |
| `isPaused()` | `(): boolean` | Playback is paused, or the host holds the picture still while it plays (the background throttling setting, while the window is minimised or hidden). Either way, settle and stop animating. |
| `getTheme()` | `(): FoliumTheme` | The current theme. |
| `getSettings()` | `(): FoliumSettingValues` | This background's settings values (defaults merged). |
| `getCoverUrl()` | `(): string \| null` | Cover image URL of the displayed song. |
| `readonly audio` | `FoliumAudio` | The host's audio analyser. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumMountHelpers](#foliummounthelpers) · [FoliumTheme](#foliumtheme) · [FoliumSettingValues](#foliumsettingvalues) · [FoliumAudio](#foliumaudio)

### FoliumBackgroundDef

A background type in the background picker; it paints behind every mode, previews and export included.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `label` | `FoliumLabel` | Name in the background picker. |
| `order?` | `number` | Position in the picker; default 500. |
| `mount` | `FoliumMount<FoliumBackgroundContext>` | Draws the background into its container. |
| `settings?` | `FoliumSetting[]` | Settings schema, as for visualizers. |
| `settingsPanel?` | `FoliumMount<FoliumSettingsPanelContext>` | Replaces the host-rendered form; values still follow `settings`. |

相关：[FoliumLabel](#foliumlabel) · [FoliumMount](#foliummount) · [FoliumBackgroundContext](#foliumbackgroundcontext) · [FoliumSetting](#foliumsetting) · [FoliumSettingsPanelContext](#foliumsettingspanelcontext)

### FoliumStageSlot

Where a stage layer sits on the player page:
  - `player.stage.back`: above the background, under the lyrics;
  - `player.stage.front`: above the lyrics, under the player chrome;
  - `app.overlay`: above the whole app.

```ts
type FoliumStageSlot = 'player.stage.back' | 'player.stage.front' | 'app.overlay'
```

### FoliumStageLayerDef

A layer on the live player page (never in previews, OBS sources or the export window). Needs the `stageLayers`
permission.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `slot` | `FoliumStageSlot` | Where the layer sits. |
| `order?` | `number` | Stacking order within the slot; default 500. |
| `interactive?` | `boolean` | When false (default) the layer is click-through, so it cannot block the player; elements that should still take clicks set `pointer-events: auto`. When true the whole layer captures the pointer. |
| `mount` | `FoliumMount<FoliumStageContext>` | Draws the layer into its container. |

相关：[FoliumStageSlot](#foliumstageslot) · [FoliumMount](#foliummount) · [FoliumStageContext](#foliumstagecontext)

### FoliumSettingsSectionDef

The mod's own settings, shown in the mods panel when the mod's row is expanded. Values are readable in
every context.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `label` | `FoliumLabel` | Section title. |
| `description?` | `FoliumLabel` | Shown under the title. |
| `settings` | `FoliumSetting[]` | The fields. Folium 1.7: only here may a field be a `secret`. |
| `settingsPanel?` | `FoliumMount<FoliumSettingsPanelContext>` | Replaces the host-rendered form; values still follow `settings`. |

相关：[FoliumLabel](#foliumlabel) · [FoliumSetting](#foliumsetting) · [FoliumMount](#foliummount) · [FoliumSettingsPanelContext](#foliumsettingspanelcontext)

### FoliumPlayerPanelTabDef

A tab in the player panel. `folium.ui.openPlayerPanel(id)` opens it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id; pass it to `folium.ui.openPlayerPanel`. |
| `label` | `FoliumLabel` | Tab title. |
| `order?` | `number` | Tab order; default 500. |
| `icon?` | `string` | Folium 1.9: the tab's icon, a lucide icon name as `folium.ui.icon` takes it (e.g. "message-circle"). The panel draws it when the tab row is too narrow for every label: the tabs that are not open show their icon alone. Left out, or a name the host's lucide version does not have, the tab keeps the puzzle icon. An older host ignores it. |
| `mount` | `FoliumMount<FoliumPanelContext>` | Draws the tab into its container. |

相关：[FoliumLabel](#foliumlabel) · [FoliumMount](#foliummount) · [FoliumPanelContext](#foliumpanelcontext)

### FoliumHomeTabDef

An owned full-page tab appended to Grid and Bravais home navigation.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id; pass it to `folium.ui.openHomeTab`. |
| `label` | `FoliumLabel` | Localized navigation label. |
| `order?` | `number` | Order among contributed home tabs; default 500. Native tabs retain their order. |
| `mount` | `FoliumMount<FoliumPanelContext>` | Mounts in an isolated, bounded full-page container. Returns cleanup on leaving the page. |

相关：[FoliumLabel](#foliumlabel) · [FoliumMount](#foliummount) · [FoliumPanelContext](#foliumpanelcontext)

### FoliumProgressContext

Progress-bar context shared by progress buttons and progress layers. `onChange` fires when the duration or
the colors change (a new track, a theme switch).

```ts
interface FoliumProgressContext extends FoliumMountHelpers
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly playbackTime` | `FoliumClock` | The playback clock: the position in the track's audio, seconds (what `seek` takes). |
| `onPlaybackTime()` | `(listener: (seconds: number) => void): FoliumDisposer` | Calls `listener` with the playback clock's time (`playbackTime`) on every change. The host stops it when the mount ends. |
| `getDuration()` | `(): number` | Track duration, seconds; 0 when unknown. |
| `timeToRatio()` | `(seconds: number): number` | 0..1 position of a time on the track (0 when the duration is unknown). |
| `seek()` | `(seconds: number): void` | Seeks the host player; ignored while the host bar is disabled. |
| `getColors()` | `(): { fill: string; track: string; text: string }` | The host bar's colors, so mod UI can match it. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumMountHelpers](#foliummounthelpers) · [FoliumClock](#foliumclock) · [FoliumDisposer](#foliumdisposer)

### FoliumProgressButtonSlot

The side of the progress bar a progress button sits on.

```ts
type FoliumProgressButtonSlot = 'progress.leading' | 'progress.trailing'
```

### FoliumProgressButtonDef

A button next to the progress bar. All three host progress bars (floating controls x2, Lattice) show it.
A click inside the button stays in it: the host stops it from reaching the bar's surroundings (the
floating capsule opens the player on a click), so the button need not stop propagation itself.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `slot` | `FoliumProgressButtonSlot` | Left or right of the bar. |
| `order?` | `number` | Order within the slot; default 500. |
| `hideWhenCollapsed?` | `boolean` | Leave the collapsed floating capsule alone. The button is not mounted there, only on the expanded capsule and Lattice. Default false. |
| `mount` | `FoliumMount<FoliumProgressContext>` | Draws the button into its container. |

相关：[FoliumProgressButtonSlot](#foliumprogressbuttonslot) · [FoliumMount](#foliummount) · [FoliumProgressContext](#foliumprogresscontext)

### FoliumProgressLayerDef

A layer over the progress track. Its container is click-through so seeking
keeps working; elements that should take clicks set `pointer-events: auto`.
As for progress buttons, the host keeps such a click inside the layer.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `order?` | `number` | Stacking order; default 500. |
| `mount` | `FoliumMount<FoliumProgressContext>` | Draws the layer into its container, which spans the track. |

相关：[FoliumMount](#foliummount) · [FoliumProgressContext](#foliumprogresscontext)

### FoliumStyleDef

Mod CSS, injected inside `@layer folium-mods` and removed with the mod. The
stable targets are the host's public parts: `[data-folium-part="progress.track"]` etc.
(see mods/README.md for the list). Anything else in the host DOM is not API.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local id. |
| `css` | `string` | The stylesheet. |

### FoliumRegistryHandle

What `register` returns.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `FoliumId` | Full namespaced id (`modid:name`). |
| `unregister()` | `(): void` | Removes the entry now (the host also removes it when the mod stops). |

相关：[FoliumId](#foliumid)

### FoliumSettingsSectionHandle

What `settingsSections.register` returns: the handle plus the section's values.

```ts
interface FoliumSettingsSectionHandle extends FoliumRegistryHandle
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly settings` | `FoliumSettingAccess` | The section's values (defaults merged) and write access. |
| `readonly id` | `FoliumId` | 继承自 [FoliumRegistryHandle](#foliumregistryhandle)。Full namespaced id (`modid:name`). |
| `unregister()` | `(): void` | 继承自 [FoliumRegistryHandle](#foliumregistryhandle)。Removes the entry now (the host also removes it when the mod stops). |

相关：[FoliumRegistryHandle](#foliumregistryhandle) · [FoliumSettingAccess](#foliumsettingaccess)

### FoliumRegistry

Every registry has this one method.

```ts
interface FoliumRegistry<Def, Handle extends FoliumRegistryHandle = FoliumRegistryHandle>
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `register()` | `(def: Def): Handle` | Adds an entry; throws on an invalid definition or a duplicate id. |

相关：[FoliumRegistryHandle](#foliumregistryhandle)

### FoliumRegistries

All registries, as `folium.registries`. Some only make sense where there is app UI: they accept
registrations and do nothing in the export window. The table of registries in docs/folium/api.md
says which, and which need a permission.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `visualizers` | `FoliumRegistry<FoliumVisualizerDef>` | Lyric animation modes. |
| `tunings` | `FoliumRegistry<FoliumTuningDef>` | Tuning knobs for builtin modes. |
| `commands` | `FoliumRegistry<FoliumCommandDef>` | Commands. |
| `backgrounds` | `FoliumRegistry<FoliumBackgroundDef>` | Background types. |
| `stageLayers` | `FoliumRegistry<FoliumStageLayerDef>` | Player page layers (`stageLayers`). |
| `settingsSections` | `FoliumRegistry<FoliumSettingsSectionDef, FoliumSettingsSectionHandle>` | The mod's own settings. |
| `playerPanelTabs` | `FoliumRegistry<FoliumPlayerPanelTabDef>` | Player panel tabs. |
| `homeTabs` | `FoliumRegistry<FoliumHomeTabDef>` | Full pages in home navigation. |
| `progressButtons` | `FoliumRegistry<FoliumProgressButtonDef>` | Buttons beside the progress bar. |
| `progressLayers` | `FoliumRegistry<FoliumProgressLayerDef>` | Layers over the progress track. |
| `styles` | `FoliumRegistry<FoliumStyleDef>` | Mod CSS for public parts. |

相关：[FoliumRegistry](#foliumregistry) · [FoliumVisualizerDef](#foliumvisualizerdef) · [FoliumTuningDef](#foliumtuningdef) · [FoliumCommandDef](#foliumcommanddef) · [FoliumBackgroundDef](#foliumbackgrounddef) · [FoliumStageLayerDef](#foliumstagelayerdef) · [FoliumSettingsSectionDef](#foliumsettingssectiondef) · [FoliumSettingsSectionHandle](#foliumsettingssectionhandle) · [FoliumPlayerPanelTabDef](#foliumplayerpaneltabdef) · [FoliumHomeTabDef](#foliumhometabdef) · [FoliumProgressButtonDef](#foliumprogressbuttondef) · [FoliumProgressLayerDef](#foliumprogresslayerdef) · [FoliumStyleDef](#foliumstyledef)

## 宿主容器与上下文

界面类条目都是 `mount(container, ctx) => dispose?`：宿主创建并回收容器，通过 `ctx` 提供时钟、主题、设置、音频等只读信息与订阅。

### FoliumMount

Everything UI-shaped is mounted into a container the host owns. The host
creates it (inside a ShadowRoot for panels), passes theme colors as
`--folium-*` CSS custom properties, and calls the disposer when it removes the
container. Mods never query or mutate host DOM outside their container.

`mount` may be `async` and return a promise of its disposer. A disposer that arrives after the host
removed the container runs at once.

```ts
type FoliumMount<Ctx> = (container: HTMLElement, ctx: Ctx) => void | FoliumDisposer | Promise<void | FoliumDisposer>
```

相关：[FoliumDisposer](#foliumdisposer)

### FoliumSize

The size of a mount's container, as `onResize` reports it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly width` | `number` | Width, CSS pixels. |
| `readonly height` | `number` | Height, CSS pixels. |

### FoliumMountHelpers

Helpers every mount context carries. Each one keeps calling the function it is given until the mount
ends, and the host stops it then, whether or not the mod kept the disposer it returned. A mount that
throws, or whose promise rejects, has ended.

A listener belongs to the mount that subscribed it: the same function given by two mounts runs once for
each of them.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `onChange()` | `(listener: () => void): FoliumDisposer` | Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumDisposer](#foliumdisposer) · [FoliumSize](#foliumsize)

### FoliumPanelContext

Context for panel-like containers (player panel tabs, settings panels). `onChange` fires when the theme
changes (a theme switch, day and night).

```ts
interface FoliumPanelContext extends FoliumMountHelpers
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly locale` | `string` | The UI locale, e.g. `zh-CN`. |
| `getTheme()` | `(): FoliumTheme` | The current theme. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumMountHelpers](#foliummounthelpers) · [FoliumTheme](#foliumtheme)

### FoliumSettingsPanelContext

Context for a custom settings panel (`settingsPanel`): the panel draws the form, the schema still owns the
values. `onChange` fires when the theme changes; `settings.onChange` when a value does.

```ts
interface FoliumSettingsPanelContext extends FoliumPanelContext
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly settings` | `FoliumSettingAccess` | Read and write the values the schema describes. |
| `readonly locale` | `string` | 继承自 [FoliumPanelContext](#foliumpanelcontext)。The UI locale, e.g. `zh-CN`. |
| `getTheme()` | `(): FoliumTheme` | 继承自 [FoliumPanelContext](#foliumpanelcontext)。The current theme. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumPanelContext](#foliumpanelcontext) · [FoliumSettingAccess](#foliumsettingaccess)

### FoliumClock

A clock in seconds. Read it with `get` when you need the time now; to be called on every change, use the
context's `onLyricTime` or `onPlaybackTime`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `get()` | `(): number` | Current time, seconds. |

### FoliumSurface

What the host draws around the content.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `transparent` | `boolean` | The host renders onto a transparent surface (OBS source, alpha export). |
| `hostBackground` | `boolean` | The host is painting its configured background under this content. |

### FoliumAudioBands

Analyser band energies, each 0..1.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly bass` | `number` | 20–150 Hz |
| `readonly lowMid` | `number` | 150–400 Hz |
| `readonly mid` | `number` | 400–1200 Hz |
| `readonly vocal` | `number` | 1000–3500 Hz |
| `readonly treble` | `number` | 3500 Hz and up |

### FoliumAudio

The host's audio analyser, for audio-reactive content. Values
change every frame and nothing is announced: read them inside your own frame
loop. Previews feed a synthetic signal; silence (or no analyser) reads as 0.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getPower()` | `(): number` | Overall energy (bass + low mid, shaped), 0..1. |
| `getBands()` | `(): FoliumAudioBands` | The same object on every call, refreshed in place; copy it to keep a reading. |
| `getSpectrum()` | `(): Uint8Array \| null` | Raw analyser FFT magnitudes (0–255), or null when there are none. The host reuses the array. |

相关：[FoliumAudioBands](#foliumaudiobands)

### FoliumDisplay

The host's display settings for lyric content, named and valued
as builtin modes receive them. A mod that turns off `hostLayers.subtitles`
and draws its own reads the subtitle settings here.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `showText` | `boolean` | False while lyrics should not be drawn (e.g. the settings modal covers the player, or the player page is not shown): a mod draws no lyric text then, as builtin modes do. Everything else may keep drawing. |
| `lyricsFontScale` | `number` | The user's lyric size multiplier; builtin modes scale lyric text by it. |
| `subtitleFontScale` | `number` | Subtitle size multiplier. |
| `subtitleOverlayOpacity` | `number` | Subtitle opacity, 0..1. |
| `subtitleOverlayBackground` | `boolean` | Subtitles get a backing plate. |
| `subtitleUpcomingLyricsBlur` | `boolean` | Upcoming-line subtitles are blurred. |
| `showHarmonySubtitle` | `boolean` | Background vocals are shown as subtitles. |
| `harmonySubtitleBackground` | `boolean` | Harmony subtitles get a backing plate. |
| `showSubtitleTranslation` | `boolean` | Subtitles show a translation or romanization. |
| `hideTranslationSubtitle` | `boolean` | The host hides translation subtitles here (e.g. the lyrics already carry them). |
| `subtitleContentMode` | `'translation' \| 'romanization' \| 'none'` | What subtitles show. |
| `isPlayerChromeHidden` | `boolean` | The player controls are hidden. |
| `isPanelOpen` | `boolean` | The player panel is open. |
| `visualizerOpacity` | `number` | Lyric layer opacity, 0..1. The host already applies it to the layer a visualizer and the `player.stage.*` layers draw in: do not apply it again, or the content fades twice. |

### FoliumStageContext

Context for lyric-synced content (visualizers, stage layers). Snapshot fields are fixed for one mount; the
host remounts only when the lyric data, the song or `staticMode` changes (or the preview line in static
mode). Everything else is read through getters, and `onChange` fires when the line index, pause, theme,
subtitle theme, cover, display, settings, surface or duration change, including while paused, when the
lyric clock stands still. The time itself comes through `onLyricTime`.

```ts
interface FoliumStageContext extends FoliumMountHelpers
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly lines` | `readonly FoliumLine[]` | Lyrics of this song (fixed for the mount). |
| `readonly song` | `FoliumSong \| null` | This song (fixed for the mount). |
| `readonly staticMode` | `boolean` | A still preview: draw one frame of `staticLineIndex`, do not animate. |
| `readonly staticLineIndex` | `number \| null` | Only meaningful in static mode: the line the preview shows. |
| `readonly seed` | `string \| null` | The geometry seed builtin modes get (the displayed song's id, or a per-mode fallback). Stable per song, identical in previews, playback and export, so seeded randomness matches everywhere. |
| `readonly isPreview` | `boolean` | Rendering inside a settings preview rather than the player page. |
| `readonly lyricTime` | `FoliumClock` | The lyric clock: the time lyric lines are timed in (`line.startTime`), seconds. It can differ from the playback position (the user's lyric offset, Stage sources); in previews it is the preview's own clock. |
| `getDuration()` | `(): number` | The song's length, seconds; 0 while unknown (`onChange` fires when it becomes known). In a settings preview it is the preview's length, in the export window the exported song's. Progress through the song is `lyricTime.get() / getDuration()` when the duration is above 0; it can be off by the user's lyric offset, since the lyric clock is not the playback position. |
| `getLineIndex()` | `(): number` | Index into `lines` of the active line; -1 between lines. |
| `isPaused()` | `(): boolean` | Playback is paused, or the host holds the picture still while it plays (the background throttling setting, while the window is minimised or hidden; the lyric clock and the line stand still too). Either way, settle and stop animating. |
| `getTheme()` | `(): FoliumTheme` | The current theme. |
| `getSubtitleTheme()` | `(): FoliumTheme` | The theme the host's subtitles use; equals getTheme() where there is none. |
| `getCoverUrl()` | `(): string \| null` | Cover image URL of the displayed song, or null. |
| `getDisplay()` | `(): FoliumDisplay` | The host's display settings. The same object until a value changes; `onChange` announces changes. |
| `getSettings()` | `(): FoliumSettingValues` | This entry's settings values (defaults merged); empty without a schema. |
| `getSurface()` | `(): FoliumSurface` | What the host draws around this content. |
| `getLayout()` | `(): FoliumPlayerLayout \| null` | EXPERIMENTAL (`player.layout`): frozen live-player geometry in viewport CSS pixels. Null without the manifest opt-in, outside the live player (including previews, OBS and export), or before a subscriber's first measurement. Reading never starts measurement; `onChange` also fires when the opted-in layout changes. |
| `readonly audio` | `FoliumAudio` | The host's audio analyser. |
| `onLyricTime()` | `(listener: (seconds: number) => void): FoliumDisposer` | Calls `listener` with the lyric clock's time (`lyricTime`) on every change. The host stops it when the mount ends. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` when a value this context reads through a getter changes; each context says which. Read the new values through the getters inside the listener. |
| `onFrame()` | `(listener: (timestamp: number) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener runs at most once a frame: one subscribed while a frame runs starts with the next frame. |
| `onResize()` | `(listener: (size: FoliumSize) => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` with the container's size once it is laid out, and again whenever the size changes. |
| `every()` | `(ms: number, listener: () => void): FoliumDisposer` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a browser timer can wait); for work on every frame use `onFrame`. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMountHelpers](#foliummounthelpers)。Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has already ended. Returns nothing. |

相关：[FoliumMountHelpers](#foliummounthelpers) · [FoliumLine](#foliumline) · [FoliumSong](#foliumsong) · [FoliumClock](#foliumclock) · [FoliumTheme](#foliumtheme) · [FoliumDisplay](#foliumdisplay) · [FoliumSettingValues](#foliumsettingvalues) · [FoliumSurface](#foliumsurface) · [FoliumPlayerLayout](#foliumplayerlayout) · [FoliumAudio](#foliumaudio) · [FoliumDisposer](#foliumdisposer)

## 事件

`folium.events.on(type, handler, { priority })`。通知只读、事后发出；钩子让处理器依次修改同一个事件对象。

### 事件一览

本表由宿主里那张事件类型表（`src/mods/folium/eventTypes.ts`）生成。

| 事件 | 方式 | 需要选用的实验接口 |
| --- | --- | --- |
| `playback.songChanged` | 通知 | — |
| `playback.stateChanged` | 通知 | — |
| `playback.seeked` | 通知 | — |
| `lyrics.loaded` | 通知 | — |
| `app.viewChanged` | 通知 | — |
| `visualizer.modeChanged` | 通知 | — |
| `theme.changed` | 通知 | — |
| `playback.likeChanged` | 通知 | — |
| `playback.volumeChanged` | 通知 | — |
| `playback.loopModeChanged` | 通知 | — |
| `playback.queueChanged` | 通知 | — |
| `playback.failed` | 通知 | — |
| `account.changed` | 通知 | — |
| `equalizer.changed` | 通知 | — |
| `visualizer.renderQualityChanged` | 通知 | — |
| `visualizer.tuningChanged` | 通知 | — |
| `visualizer.beatEffectsChanged` | 通知 | — |
| `visualizer.backgroundChanged` | 通知 | — |
| `visualizer.animationIntensityChanged` | 通知 | — |
| `lyrics.transform` | 钩子 | — |
| `playback.beforePlay` | 钩子 | — |
| `omni.lyricsResolved` | 钩子 | `omni.hooks` |
| `omni.audioSourceResolved` | 钩子 | `omni.hooks` |

每个事件带的内容见 [FoliumNotificationEvents](#foliumnotificationevents) 与 [FoliumHookEvents](#foliumhookevents)。
不在表里的名字，`folium.events.on` 抛 `unknown-event:<名字>`；需要选用实验接口的事件，没有在 `mod.json` 的 `experimental` 里选用就监听时抛 `experimental-not-declared:<接口>`。

### FoliumEventPriority

Handler order for one event type; handlers of the same priority run in registration order.

```ts
type FoliumEventPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest'
```

### FoliumPlaybackFailureReason

Why a song failed to play, coarsely. `auth`: sign-in needed or expired. `restricted`:
membership, purchase, entitlement, preview-only or region. `taken-down`: no longer offered. `network`:
network, timeout, service unavailable or rate limited. `unknown`: anything else. The host's own reason
codes are not API.

```ts
type FoliumPlaybackFailureReason = 'auth' | 'restricted' | 'taken-down' | 'network' | 'unknown'
```

### FoliumNotificationEvents

Read-only notifications, emitted after the fact.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `playback.songChanged` | `{ readonly song: FoliumSong \| null }` | The displayed song changed. |
| `playback.stateChanged` | `{ readonly state: FoliumPlaybackState }` | Playing, paused or stopped. |
| `playback.seeked` | `{ readonly position: number }` | The user or a mod seeked; `position` in seconds. |
| `lyrics.loaded` | `{ readonly song: FoliumSong \| null; readonly lines: readonly FoliumLine[] }` | Lyrics for the displayed song are ready (after `lyrics.transform`). |
| `app.viewChanged` | `{ readonly view: string }` | The app switched views (e.g. `home`, `player`). |
| `visualizer.modeChanged` | `{ readonly mode: string; readonly origin: FoliumVisualizerChangeOrigin }` | The lyric animation mode changed, one event for each change. Folium 1.8: `origin` says who changed it (a host before 1.8 sends no `origin`). |
| `theme.changed` | `{ readonly theme: FoliumTheme }` | The theme or daylight mode changed. |
| `playback.likeChanged` | `{ readonly liked: boolean }` | `playback.getState().liked` changed (a like or unlike, or a new song). |
| `playback.volumeChanged` | `{ readonly volume: number; readonly muted: boolean }` | The volume or the mute switch changed, whoever changed it. |
| `playback.loopModeChanged` | `{ readonly mode: FoliumLoopMode }` | The repeat mode changed. |
| `playback.queueChanged` | `FoliumQueueChange` | The queue changed, or the displayed song moved within it. Only the outline: call `playback.getQueue()` for the songs. Changes made in one task arrive as one event. Folium 1.7: also fired when an automix blend ends, so a replaceQueue refused `transition` can try again. |
| `playback.failed` | `{ readonly song: FoliumSong \| null; readonly reason: FoliumPlaybackFailureReason; readonly phase: 'play' \| 'restore' \| 'mid-playback'; readonly willAutoSkip: boolean; }` | A song failed to play; reported once, after the host's own retries. `phase` says where it failed: `play`, the host got no playable source for the song just picked (sign-in, membership, taken down, the address lookup failed, a missing local file); `restore`, the same while restoring the last session; `mid-playback`, the player failed on the media itself (it would not load, decode or keep streaming). Every media error is `mid-playback`, so a song just picked or restored that fails before any sound is reported as `mid-playback` too. `willAutoSkip`: the host is counting down to skip it (its policy or the user's "skip unplayable songs" setting), so do not call `next()` yourself. Not emitted in the export window. |
| `account.changed` | `FoliumAccountState` | Folium 1.7: someone signed in to an online source, signed out, or another account took the place of the one there (`accountKey` changed); the payload is the source's new state, as `folium.account.getState(providerId)` reads it. One event per source for all the changes of one task; a source whose status and key end where they began fires none, and a new nickname or avatar alone fires none either. A status that settles from `unknown` (the host finished asking the platform, usually soon after start) fires too, for the same account as before: compare `accountKey` before dropping data. Not emitted in the export window. |
| `equalizer.changed` | `{ readonly state: FoliumEqualizerState; readonly origin: FoliumEqualizerChangeOrigin }` | Folium 1.7: the equalizer changed: anything `folium.equalizer.getState()` reports (the switch, the mode, the gains, `hostPlaysAudio`, `writable`). One event for all the changes of one task; its origin is the last of them that was not `host`, or `host` when all of them were. Changes that end where they began fire none. Not emitted in the export window. |
| `visualizer.renderQualityChanged` | `{ readonly quality: FoliumLyricRenderQuality; readonly origin: FoliumRenderQualityChangeOrigin; }` | Folium 1.8: the global lyric render quality changed (`folium.visualizer.getRenderQuality()`), whoever changed it. One event for all the changes of one task; its origin is the last of them. Changes that end where they began fire none, and neither does a change to one style's own override. Not emitted in the export window. |
| `visualizer.tuningChanged` | `{ readonly mode: string; readonly tuning: FoliumVisualizerTuning; readonly origin: FoliumVisualizerChangeOrigin; }` | Folium 1.8: the tuning of builtin mode `mode` changed (`folium.visualizer.getTuning(mode)`), whoever changed it; only the keys mods may set count. One event per mode for all the changes of one task; its origin is the last of them. Changes that end where they began fire none. Not emitted in the export window. |
| `visualizer.beatEffectsChanged` | `{ readonly state: FoliumBeatEffectsState; readonly origin: FoliumVisualizerChangeOrigin; }` | Folium 1.8: a beat effect's setting or the 智能动感模式 switch changed (`folium.visualizer.getBeatEffects()`), whoever changed it. One event for all the changes of one task; its origin is the last of them. Changes that end where they began fire none. Not emitted in the export window. |
| `visualizer.backgroundChanged` | `{ readonly background: string; readonly origin: FoliumVisualizerChangeOrigin; }` | Folium 1.9: the background type changed (`folium.visualizer.getBackground()`), whoever changed it. One event for all the changes of one task; its origin is the last of them. Changes that end where they began fire none. Not emitted in the export window. |
| `visualizer.animationIntensityChanged` | `{ readonly intensity: FoliumAnimationIntensity; readonly origin: FoliumVisualizerChangeOrigin; }` | Folium 1.9: the animation intensity changed (`folium.visualizer.getAnimationIntensity()`), whoever changed it. `theme.changed` fires for the same change, as the theme carries the intensity too. Not emitted in the export window. |

相关：[FoliumSong](#foliumsong) · [FoliumPlaybackState](#foliumplaybackstate) · [FoliumLine](#foliumline) · [FoliumVisualizerChangeOrigin](#foliumvisualizerchangeorigin) · [FoliumTheme](#foliumtheme) · [FoliumLoopMode](#foliumloopmode) · [FoliumQueueChange](#foliumqueuechange) · [FoliumPlaybackFailureReason](#foliumplaybackfailurereason) · [FoliumAccountState](#foliumaccountstate) · [FoliumEqualizerState](#foliumequalizerstate) · [FoliumEqualizerChangeOrigin](#foliumequalizerchangeorigin) · [FoliumLyricRenderQuality](#foliumlyricrenderquality) · [FoliumRenderQualityChangeOrigin](#foliumrenderqualitychangeorigin) · [FoliumVisualizerTuning](#foliumvisualizertuning) · [FoliumBeatEffectsState](#foliumbeateffectsstate) · [FoliumAnimationIntensity](#foliumanimationintensity)

### FoliumLyricsTransformEvent

Synchronous hook: runs when new lyrics reach the player, before they are
shown. Assign `lines` to rewrite them; lines left untouched (same object)
keep all their host-side data, new or changed ones are built from the DTO.

It also runs when the lyric load of the current song ended with none (no
lyrics found, an instrumental, a failed fetch), with `lines` empty: assign
lines to give the song lyrics. Left empty, the song stays without lyrics, so
a handler that only rewrites the lines it is given changes nothing there.

Always runs on untransformed lyrics, never on its own output: when the host
rebuilds lyrics already on screen (a word-segmentation update,
`folium.lyrics.refresh()`) it starts again from the untransformed version,
so handlers need not be idempotent. A rebuild can come at any time, for
whatever song is current then: key what you supply on `event.song`, never
on "the last thing I parsed".

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong \| null` | The song the lyrics belong to: the player's current song. During an automix blend that is the track the blend goes to, while the one it leaves is still the displayed song (`playback.getState().song`). |
| `lines` | `readonly FoliumLine[]` | Assign a new array to rewrite the lyrics. Empty when the song's lyric load ended with none. |

相关：[FoliumSong](#foliumsong) · [FoliumLine](#foliumline)

### FoliumBeforePlayEvent

Async hook: runs before a song starts. Handlers may cancel it or play
another song instead. Not run for the track an automix blend advances to:
the blend starts that track seconds early on a fixed schedule and cannot
wait for handlers.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong` | The song about to play. |
| `readonly cancelled` | `boolean` | A handler already cancelled. |
| `cancel()` | `(): void` | Stops the song from playing; later handlers are skipped. |
| `replaceWith()` | `(song: FoliumSong): void` | Plays this song instead; it must carry a `ref` from the host. |

相关：[FoliumSong](#foliumsong)

### FoliumOmniLyricsEvent

EXPERIMENTAL (manifest `experimental: ["omni.hooks"]`): Omni answered with
lyrics for an online song. Same line rules as `lyrics.transform`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong` | The online song. |
| `lines` | `readonly FoliumLine[]` | Assign a new array to rewrite the lyrics. |
| `readonly isPureMusic` | `boolean` | Omni reported the song as instrumental. |

相关：[FoliumSong](#foliumsong) · [FoliumLine](#foliumline)

### FoliumOmniAudioEvent

EXPERIMENTAL (`omni.hooks`): Omni resolved an audio URL; assign `url` to use another one.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong` | The online song. |
| `url` | `string \| null` | Assign another https URL to play that instead. |

相关：[FoliumSong](#foliumsong)

### FoliumHookEvents

Hooks: every handler receives the same event object, in priority order, and may change it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `lyrics.transform` | `FoliumLyricsTransformEvent` | Rewrite lyrics before they are shown (sync). |
| `playback.beforePlay` | `FoliumBeforePlayEvent` | Cancel or replace a song before it plays (async, 1.5 s per handler). |
| `omni.lyricsResolved` | `FoliumOmniLyricsEvent` | Rewrite lyrics Omni fetched (experimental, `omni.hooks`). |
| `omni.audioSourceResolved` | `FoliumOmniAudioEvent` | Replace the audio URL Omni resolved (experimental, `omni.hooks`). |

相关：[FoliumLyricsTransformEvent](#foliumlyricstransformevent) · [FoliumBeforePlayEvent](#foliumbeforeplayevent) · [FoliumOmniLyricsEvent](#foliumomnilyricsevent) · [FoliumOmniAudioEvent](#foliumomniaudioevent)

### FoliumEventMap

Every event type and its payload.

```ts
type FoliumEventMap = FoliumNotificationEvents & FoliumHookEvents
```

相关：[FoliumNotificationEvents](#foliumnotificationevents) · [FoliumHookEvents](#foliumhookevents)

### FoliumEvents

The event bus, as `folium.events`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `on()` | `<K extends keyof FoliumEventMap>(type: K, handler: (event: FoliumEventMap[K]) => void \| Promise<void>, options?: { priority?: FoliumEventPriority }): FoliumDisposer` | Adds a handler; returns its disposer. Each handler runs in its own error boundary; a sync handler over 16 ms logs a warning. The host removes the mod's handlers when the mod stops. Throws `unknown-event:<type>` for a name that is not an event type (the events table in docs/folium/api.md lists them), and `experimental-not-declared:<name>` for an experimental event whose opt-in the mod did not declare in mod.json `experimental`. |

相关：[FoliumEventMap](#foliumeventmap) · [FoliumEventPriority](#foliumeventpriority) · [FoliumDisposer](#foliumdisposer)

## 服务

`folium.playback` / `folium.ui` / `folium.net`，以及 Folium 1.7 的登录状态 `folium.account` 和经 Omni 只读在线音源的 `folium.omni`（两者都不需要权限；`folium.omni` 以用户在 Folia 登录的平台账号发请求），以及宿主均衡器 `folium.equalizer`（读不需要权限，写需 `equalizer.control`）；Folium 1.8 加了歌词显示设置 `folium.visualizer`：歌词画布渲染质量、歌词动画模式、内置模式的样式参数与智能动感效果（读不需要权限，写分别需 `visualizer.renderQuality`、`visualizer.mode`、`visualizer.tuning`、`visualizer.beatEffects`）；Folium 1.9 加了返回一层的 `folium.ui.back()`，以及 `folium.visualizer` 的背景类型与动画强度（写分别需 `visualizer.background`、`visualizer.animationIntensity`）。需要权限的方法见[权限一览](#权限一览)；导出窗口里调用会抛 `*-unavailable-in-export-context`（`ui.icon` 除外）。

### FoliumPlaybackService

`folium.playback`. The readers (`getState`, `getVolume`, `getLoopMode` and `getQueue`)
need no permission; every other method needs the `playback.control` permission, except `replaceQueue`,
which needs `playback.queue`. All of it is unavailable in the export window.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getState()` | `(): { song: FoliumSong \| null; state: FoliumPlaybackState; position: number; duration: number; liked: boolean; canLike: boolean; }` | The displayed song, player state, position and duration (seconds), `liked` (the displayed song is liked; false with no song) and `canLike` (toggleLike would act now; the host's own like button greys out otherwise). |
| `play()` | `(): void` | Resumes playback. Needs `playback.control`. |
| `pause()` | `(): void` | Pauses. Needs `playback.control`. |
| `toggle()` | `(): void` | Play/pause. Needs `playback.control`. |
| `seek()` | `(seconds: number): void` | Seeks to a playback position (audio time), seconds. Needs `playback.control`. |
| `seekToLyricTime()` | `(lyricSeconds: number): void` | Seeks to a point on the lyric clock, e.g. `line.startTime`, the way clicking a lyric line does in builtin modes. The host converts lyric time to playback time (lyric offsets, lyrics-only stage sources); `seek(line.startTime)` would land off by the offset. Ignored while the host has now-playing controls disabled. Needs `playback.control`. |
| `next()` | `(): void` | Next track. Needs `playback.control`. |
| `previous()` | `(): void` | Previous track. Needs `playback.control`. |
| `playSong()` | `(song: FoliumSong): Promise<boolean>` | Plays a song by its host `ref`. Resolves false when the ref is unknown. Needs `playback.control`. |
| `enqueue()` | `(song: FoliumSong): boolean` | Adds a song (by `ref`) to the queue the way the user's queue-add setting says (next or last), as the host's own add does: a song already queued moves there; the song playing now, and a song its source marks unavailable, are not added; the host shows its own notice. False when the ref is unknown; true otherwise, also when the queue did not change. Needs `playback.control`. |
| `shuffleQueue()` | `(): boolean` | Shuffles the play queue, keeping the current song first. False when there is nothing to shuffle (Personal FM, a queue of one, external Stage playback). Needs `playback.control`. |
| `toggleLike()` | `(): boolean` | Likes or unlikes the displayed song, like the host's like button, which also reports the result. False when `canLike` is false. Needs `playback.control`. |
| `getVolume()` | `(): { volume: number; muted: boolean }` | Output volume (0–1) and the mute switch, which is separate from it. |
| `setVolume()` | `(volume: number): void` | Sets the volume, clamped to 0–1, the way the host's volume slider does; `muted` stays as it is. Every call is saved, so set the value you settled on rather than animating through it. Needs `playback.control`. |
| `setMuted()` | `(muted: boolean): void` | Mutes or unmutes. A set rather than a toggle, so two windows acting at once cannot cancel each other out. Needs `playback.control`. |
| `getLoopMode()` | `(): FoliumLoopMode` | The repeat mode. |
| `setLoopMode()` | `(mode: FoliumLoopMode): void` | Sets the repeat mode; the host reports the change like its own repeat button does. Setting the mode already in effect does nothing. Needs `playback.control`. |
| `getQueue()` | `(options?: { offset?: number; limit?: number }): FoliumQueueSnapshot` | A page of the play queue. `limit` defaults to 500, the most one call returns; without `offset` the page is centred on the displayed song. Song refs come from a pool of 5,000 shared with every other song DTO, the least recently handed out dropped first: every ref of the page you just read resolves, so read the pages you show rather than the whole queue. To read a long queue whole, page it while `version` stays the same; a page with another version means the queue changed: start again. |
| `playQueueItem()` | `(index: number, expectedRef?: string): Promise<boolean>` | Plays queue entry `index`, with the same playback and navigation as clicking it in the host's queue panel; if it fails to play, the retry and skip buttons follow the queue as it is when pressed. In Personal FM, where the panel lists no queue, it plays the entry and FM stays on. With `expectedRef`, resolves false without acting when that position no longer holds that song (the queue changed between your calls). False for an index out of range and during external Stage playback. Needs `playback.control`. |
| `replaceQueue()` | `(songs: readonly FoliumSong[], options: { expectedVersion: string }): Promise<FoliumQueueReplaceResult>` | Folium 1.7: replaces the whole play queue with `songs` (by `ref`) in one step, if the queue is still the one you read: `expectedVersion` is the `version` of your last `getQueue` page or `playback.queueChanged` event. Either the whole queue is replaced or nothing changes (see FoliumQueueReplaceRefusal). Nothing starts playing and the song playing now plays on; when it is not in `songs`, `currentIndex` becomes -1 and the next track is the first of `songs`. Should that song be played again while it is not in the queue (the user retries it after a failure, or the host reloads it), the host may put it back at the front, which reaches you as a `playback.queueChanged` with `byThisMod` false. Songs stay exactly as given, in order: a song listed twice stays twice (the host finds the current song at its first position), and songs their source marks unavailable stay too (the host deals with those when it comes to them, as in any queue). The user's queue-add setting plays no part. Personal FM ends, as when a list is played: the queue becomes `kind: 'queue'`. An empty array empties the queue. A list with the same songs in the same order, outside Personal FM, changes nothing and resolves `replaced` with the same version. At most 5,000 songs, the size of the shared ref pool (see `getQueue`): every ref must still resolve, so collect the songs just before you replace, and mirror a window around the current song rather than a very long queue. A replacement is saved like the host's own edits. The host tells the user which mod replaced the queue and lets them undo it until the queue changes again; an undo reaches you as a `playback.queueChanged` with `byThisMod` false. Your own replacement reaches you once, with `byThisMod` true, if you listen at the time. Rejects with a TypeError (`invalid-arguments: …`) for malformed arguments: `songs` not an array or longer than 5,000, an entry that is not a song DTO from the host (no `ref`, or a DTO that is not a song's, such as a `folium.omni` album), or no `expectedVersion` string. Needs `playback.queue`. |

相关：[FoliumSong](#foliumsong) · [FoliumPlaybackState](#foliumplaybackstate) · [FoliumLoopMode](#foliumloopmode) · [FoliumQueueSnapshot](#foliumqueuesnapshot) · [FoliumQueueReplaceResult](#foliumqueuereplaceresult)

### FoliumFileHandle

A local file the user picked for this mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | folia-mod:// URL usable as a media/img src for this session. |
| `name` | `string` | File name. |
| `size` | `number` | Size in bytes. |
| `grantId?` | `string` | Opaque id of a persisted grant (pickFile with `persist`, or restoreFile). Store it to get the file back after a restart. |

### FoliumIconOptions

Options for `folium.ui.icon`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `size?` | `number` | Width and height in px. Default 24. |
| `strokeWidth?` | `number` | Stroke width in the icon's 24-unit grid. Default 2. |
| `color?` | `string` | Any CSS color. Default `currentColor`, so the icon follows the surrounding text. |

### FoliumUiService

`folium.ui`. Unavailable in the export window, except `icon`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `toast()` | `(message: string, options?: { type?: 'info' \| 'success' \| 'error'; durationMs?: number }): void` | Shows a status message. |
| `openPlayerPanel()` | `(tabId?: string): void` | Opens the player panel, optionally on one of this mod's panel tabs (local id). |
| `openHomeTab()` | `(tabId: string): void` | Opens this mod's registered home tab (local id). Rejects unknown tabs. |
| `navigate()` | `(view: 'home' \| 'player'): void` | Switches to the home or player view. |
| `openVolume()` | `(): void` | Opens the host volume panel (the command palette's volume command). |
| `back()` | `(): boolean` | Folium 1.9: goes back one level, as one press of Escape does. The topmost thing that can step back takes it: an open dialog, the command palette or the settings window closes; then what a page has open over itself (a focused card, a list panel, a filter); then the page: the player panel closes, the player and the wall return to where they were opened from, a collection page returns to the one before it, the search page and a mod's home page close. Returns true when the host took it, false when there was nothing to go back from (the home page with nothing open): a mod that binds a mouse button to it lets the click through then. An open window always takes it, also one that stays open: a dialog busy with work, or one that Escape does not close; nothing under it moves. Unlike the key it never leaves fullscreen. One call is one level: never call it in a loop, and not from a handler of the Escape key, which the host answers itself. Call it on the press of the button (`pointerdown`), before the host's own "press outside closes" handling takes a level of its own. An older host has no `back`: check `folium.host.folium.minor >= 9` first. |
| `pickFile()` | `(options?: { accept?: 'video' \| 'audio' \| 'image' \| 'any'; persist?: boolean }): Promise<FoliumFileHandle \| null>` | Lets the user pick a local file; null when cancelled. With `persist` the pick is remembered for this mod and the handle carries a `grantId` for restoreFile. |
| `restoreFile()` | `(grantId: string): Promise<FoliumFileHandle \| null>` | A file this mod picked with `persist`, as a fresh session handle. Null when the grant is unknown to this mod or the file is gone. |
| `releaseFile()` | `(grantId: string): Promise<void>` | Forgets a persisted grant. URLs already handed out keep working this session. |
| `embed()` | `(container: HTMLElement, url: string, options?: { title?: string; allow?: string[] }): FoliumDisposer` | Embeds an external page in `container` as a sandboxed iframe. The URL's origin must be listed in the manifest `embedOrigins` (needs `net.embed`). |
| `icon()` | `(name: string, options?: FoliumIconOptions): Promise<SVGSVGElement \| null>` | One of the host's icons as a new <svg> element the mod owns, from the icon set of lucide-react 1.48, the version Folia bundles, named as on lucide.dev (e.g. "play", "skip-forward"). Resolves to null for a name that version does not have, including icons added in later lucide releases. Works in every context, the export window included. |

相关：[FoliumFileHandle](#foliumfilehandle) · [FoliumDisposer](#foliumdisposer) · [FoliumIconOptions](#foliumiconoptions)

### FoliumFetchInit

Request options for `folium.net.fetch`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `method?` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'HEAD'` | Default `GET`. |
| `headers?` | `Record<string, string>` | Request headers. |
| `body?` | `string` | Request body (text). |
| `timeoutMs?` | `number` | Default 15000, at most 60000 (a source mod sets any). |
| `responseType?` | `'text' \| 'arrayBuffer'` | Folium 2, source mods only: `arrayBuffer` reads the body as bytes, for `arrayBuffer()` (an ordinary mod's answers are text). Default `text`. |
| `session?` | `string` | Folium 2, source mods only: the named partition the request goes through (as the main entry's `api.net.session`). |

### FoliumFetchResponse

A fully read response (body at most 5 MB, none for a source mod); `text` and `json` return synchronously.
Folium 2: a source mod's response also has `arrayBuffer()`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly ok` | `boolean` | Status is 2xx. |
| `readonly status` | `number` | HTTP status. |
| `readonly statusText` | `string` | HTTP status text. |
| `readonly headers` | `Readonly<Record<string, string>>` | Response headers, lowercase names. |
| `text()` | `(): string` | The body as text. |
| `json()` | `<T = unknown>(): T` | The body parsed as JSON; throws on invalid JSON. |
| `arrayBuffer?()` | `(): ArrayBuffer` | Folium 2, source mods only: the body as bytes (asked with `responseType: 'arrayBuffer'`; otherwise the text's UTF-8). An ordinary mod's response has none. |

### FoliumLyricsService

`folium.lyrics`: the shared lyric helpers (FoliumLyricsHelpers, in both contexts), plus two members that
reach the displayed song's lyrics. Those two are unavailable in the export window: they throw
`lyrics-unavailable-in-export-context`.

```ts
interface FoliumLyricsService extends FoliumLyricsHelpers
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getLines()` | `(): readonly FoliumLine[]` | The lines on screen now; empty when there are none. For a mod that starts after `lyrics.loaded` fired: read them once, then follow `lyrics.loaded`. |
| `refresh()` | `(): void` | Runs `lyrics.transform` again, now, and shows the result: on the displayed song's lyrics as they were before any transform (the way the host does when it rebuilds lyrics on screen), or, when the song's lyric load ended with none, on empty `lines` again. Does nothing while the song's lyrics are still loading. Takes no arguments: the handlers decide. This is the way to supply lyrics that take time to get, since the hook itself is synchronous: fetch or `parse` them, keep them keyed on the song, then call `refresh()`. The result is the same song's lyrics rebuilt, not a new load: it is not announced as `lyrics.loaded`. `getLines()` returns the new lines, and lyric mounts (visualizers, stage layers) get them as a new mount. |
| `getLineRenderEndTime()` | `(line: FoliumLine \| null \| undefined): number` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。When the host stops showing the line: `renderHints.renderEndTime`. -Infinity for null. |
| `segmentWords()` | `(line: Pick<FoliumLine, 'fullText' \| 'wordSegments'>): FoliumWordSegment[]` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。The user's saved split when valid, otherwise Folia's default word segmentation (icu-folia: Intl.Segmenter with jieba for Chinese and BudouX for Japanese; plain Intl.Segmenter until it has loaded). |
| `getRecentCompletedLine()` | `(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine \| null` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。With no active line (index -1): the last line already over, for subtitles in gaps. |
| `getUpcomingLine()` | `(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine \| null` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。The next line: after the active one, or the first still ahead when none is active. |
| `getUpcomingLines()` | `(lines: readonly FoliumLine[], lineIndex: number, count?: number): FoliumLine[]` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。Up to `count` (default 2) lines after the active one; empty when none is active. |
| `buildWordColorRanges()` | `(fullText: string, wordColors: FoliumTheme['wordColors']): FoliumWordColorRange[]` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。Non-overlapping keyword color spans of `fullText` for `theme.wordColors`. |
| `resolveWordColor()` | `(wordText: string, wordColors: FoliumTheme['wordColors'], fallbackColor: string, options?: { cjkMatchMode?: 'target-contains-token' \| 'bidirectional-contains' \| 'exact' }): string` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。The keyword color of one word, or `fallbackColor`. |
| `parse()` | `(track: FoliumLyricsTrack): Promise<FoliumParsedLyrics>` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。Parses a lyric document with the host's local lyric file pipeline, off the main thread. Rejects with a TypeError (`invalid-lyrics-track`) when the track is malformed. |
| `isPureMusicText()` | `(text: string \| null \| undefined): boolean` | 继承自 [FoliumLyricsHelpers](#foliumlyricshelpers)。Folium 2: whether a lyric text is only the "instrumental, please enjoy" notice, by the host's own rule (the one its lyric display and its platforms use). For a source's `lyrics@1` answer (`isPureMusic`). Synchronous. |

相关：[FoliumLyricsHelpers](#foliumlyricshelpers) · [FoliumLine](#foliumline)

### FoliumNetService

`folium.net`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `fetch()` | `(url: string, init?: FoliumFetchInit): Promise<FoliumFetchResponse>` | Fetch through the host (no CORS limits); needs the `net.fetch` permission. |

相关：[FoliumFetchInit](#foliumfetchinit) · [FoliumFetchResponse](#foliumfetchresponse)

### FoliumAccountState

Folium 1.7: who is signed in to one online source, as `folium.account.getState()` and the
`account.changed` event give it. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly providerId` | `string` | The source: an Omni provider id, as `FoliumSong.source` names it. |
| `readonly status` | `'signed-in' \| 'signed-out' \| 'unknown'` | `signed-in`: an account is signed in. `signed-out`: nobody is, or the source has no accounts at all (a mod's own source). `unknown`: the host has not found out yet, e.g. at start while it asks the platform, or the platform could not be asked. |
| `readonly user` | `{ readonly nickname: string; readonly avatarUrl?: string } \| null` | What the host shows of the account: its nickname and avatar, nothing else. Null unless signed in. |
| `readonly accountKey` | `string \| null` | An opaque key of the signed-in account, null unless signed in. The same account always has the same key on this installation, across restarts; another account has another key. Key data of your own on it, and drop what was kept under another key. It is no user id: it cannot be turned back into one. |

### FoliumAccountService

Folium 1.7: `folium.account`, the sign-in state of the online sources. Needs no permission; it carries
no user id, cookie or token. Unavailable in the export window: `getState` throws
`account-unavailable-in-export-context`. An older host has no `folium.account`: check
`folium.host.folium.minor >= 7` first.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getState()` | `(providerId?: string): FoliumAccountState \| null` | The state of one source; without `providerId`, of the source the host has selected now. Null for a provider id the host does not know. Follow changes with the `account.changed` event. |

相关：[FoliumAccountState](#foliumaccountstate)

### FoliumSongKey

Folium 1.7: a song's portable identity, as `FoliumSong.source` and `FoliumSong.id` give it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly source` | `string` | An Omni provider id (`FoliumSong.source`). |
| `readonly id` | `string` | The song id within that source (`FoliumSong.id`), as a string. |

### FoliumOmniProviderInfo

Folium 1.7: one online source of the host, as `folium.omni.listProviders()` lists it. Frozen.
More `supports` flags may come in later minors; a flag that is absent reads as false.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly providerId` | `string` | The Omni provider id, as `FoliumSong.source` and `FoliumAccountState.providerId` name it. |
| `readonly displayName` | `string` | Full name, as the host's source switcher shows it. |
| `readonly shortName` | `string` | Short name, as the search overlay's source chip shows it. |
| `readonly origin` | `'host' \| 'mod'` | `host`: built into Folia. `mod`: registered by a mod (`omni.providers`, or Folium 2 `folium.sources`); gone while that mod is off. |
| `readonly selected` | `boolean` | Whether this is the source the host has selected now (what `searchSongs` uses without `providerId`). |
| `readonly configured` | `boolean` | False when the source is not set up in this host. True does not promise that a request succeeds. |
| `readonly supports` | `{ readonly search: boolean; readonly resolve: boolean; readonly lyrics: boolean; readonly albums: boolean; readonly artists: boolean; }` | What of `folium.omni` this source answers; a method on a source without its flag rejects `unsupported`. |
| `readonly supports.search` | `boolean` | `searchSongs` can search it. |
| `readonly supports.resolve` | `boolean` | `resolveSongs` can look its songs up by id. |
| `readonly supports.lyrics` | `boolean` | `getLyrics` can read its songs' lyrics. |
| `readonly supports.albums` | `boolean` | `getAlbum`, and albums in `resolveCollection` / `getTracks`. |
| `readonly supports.artists` | `boolean` | `getArtists`, and artists in `resolveCollection` / `getTracks` / `getArtistAlbums`. |

### FoliumOmniPage

Folium 1.7: one page of a list `folium.omni` reads. Frozen. Ask for the next page with `nextCursor`;
sources page differently, so there is no offset to compute.

```ts
interface FoliumOmniPage<T>
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly items` | `readonly T[]` | The page, in the source's order; never more items than the `limit` asked for. |
| `readonly nextCursor` | `string \| null` | Pass it as `cursor` for the next page of the same list; null when the source has no more. Opaque, valid for this session only, and a cursor not used for a while stops resolving (`stale-ref`): start again without one. An album or an artist is the same list by its `source`, `kind` and `id`, whichever DTO of it comes with the cursor (one read again by its key, say). |
| `readonly total` | `number \| null` | The whole list's length when the source says it; null otherwise. |

### FoliumSongResolution

Folium 1.7: what `resolveSongs` found for one key, in the order of the keys.
`found`: the song, with a `ref` for playSong and enqueue.
`not-found`: the source answered and has no such song.
`unsupported`: this host cannot look it up now: no source by that id (a mod's source while that mod is
off, a source of another Folia build), a source that is not online (`local`, `navidrome`, `stage`), or one
that cannot look songs up by id. This may change as sources come and go: keep the key.
`failed`: the lookup did not get an answer; `code` says why (never `unsupported`), and a later try may work.
Later minors may add statuses: treat one you do not know as `failed`.

```ts
type FoliumSongResolution = | { readonly status: 'found'; readonly song: FoliumSong } | { readonly status: 'not-found' } | { readonly status: 'unsupported' } | { readonly status: 'failed'; readonly code: FoliumOmniErrorCode }
```

相关：[FoliumSong](#foliumsong) · [FoliumOmniErrorCode](#foliumomnierrorcode)

### FoliumSongDetails

Folium 1.7: what `describeSong` knows of an online song without asking its source. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly durationMs` | `number \| null` | Duration in milliseconds; null when the source did not give it. |
| `readonly coverUrl` | `string \| null` | Cover image URL; null when there is none. |
| `readonly availability` | `'playable' \| 'taken-down' \| 'restricted' \| 'unknown'` | `playable`: the source marks nothing against it. `taken-down`: the source took it down. `restricted`: the source marks it as limited (paying accounts, regions); whether it plays is found out when it is played. `unknown`: the source says nothing either way. It is what the source told the account signed in to it, so it may change with that account. Later minors may add values: treat one you do not know as `unknown`. |
| `readonly pageUrl` | `string \| null` | The song's public web page at its source; null when the source has none. |

### FoliumOmniLyrics

Folium 1.7: an online song's lyrics, as `folium.omni.getLyrics` reads them. Frozen. `lines` and
`isWordByWord` mean what they mean for `folium.lyrics.parse`; a line's `isChorus` is the source's marking
or the host's detection from repeated lines.

```ts
interface FoliumOmniLyrics extends FoliumParsedLyrics
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly isPureMusic` | `boolean` | The source marks the song as instrumental. |
| `lines` | `readonly FoliumLine[]` | 继承自 [FoliumParsedLyrics](#foliumparsedlyrics)。The parsed lines; empty when the text holds none. The host's lyric display filter is not applied. |
| `isWordByWord` | `boolean` | 继承自 [FoliumParsedLyrics](#foliumparsedlyrics)。Whether the lines carry real word timings rather than timings the host estimated. |

相关：[FoliumParsedLyrics](#foliumparsedlyrics)

### FoliumCollectionKey

Folium 1.7: a portable key of an album or an artist, as `FoliumCollection` carries it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly source` | `string` | An Omni provider id (`FoliumCollection.source`). |
| `readonly kind` | `'album' \| 'artist'` | `album` or `artist`. |
| `readonly id` | `string` | The id within that source and kind (`FoliumCollection.id`). |

### FoliumCollection

Folium 1.7: an album or an artist at an online source. Frozen. Key data of your own on `source`, `kind`
and `id` together; `ref` is valid for this session only. Later minors may add kinds: treat a kind you do
not know as one you cannot read.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly kind` | `'album' \| 'artist'` | `album` or `artist`. |
| `readonly source` | `string` | The Omni provider id. |
| `readonly id` | `string` | The id within the source and kind; `resolveCollection` takes it back. |
| `readonly name` | `string` | Its name. |
| `readonly artist` | `string` | For an album, its artists joined with ` / `; '' for an artist or when unknown. |
| `readonly coverUrl` | `string \| null` | Cover or portrait URL; null when there is none. |
| `readonly description` | `string \| null` | The source's description; null when it gives none. |
| `readonly trackCount` | `number \| null` | Songs on an album; null when unknown (a summary from a song or a list carries less). |
| `readonly albumCount` | `number \| null` | An artist's albums; null when unknown. |
| `readonly publishedAt` | `number \| null` | An album's release time, milliseconds since the epoch; null when unknown. |
| `readonly ref` | `string` | Opaque handle for getTracks / getArtistAlbums; valid for the session. |

### FoliumOmniErrorCode

Folium 1.7: why a `folium.omni` call failed, as the rejection's `code` (and its message), or as a
`failed` resolution's `code`.
`unsupported`: the source does not answer this (its `supports` flag is false), or there is no such source.
`unavailable`: the source cannot take requests now (not set up, its service not running, or it refused).
`region-restricted`: the source does not answer from this region.
`not-signed-in` / `session-expired`: the source needs a signed-in account for this.
`vip-required`: only paying accounts may.
`rate-limited`: too many requests (see FoliumOmniService), or the source says so.
`network`: no answer in time, or a failure the source did not explain.
`account-changed`: the selected source or its account changed while the call was under way, so the
answer was dropped.
`stale-ref`: the DTO's `ref`, or the `cursor`, no longer resolves; read it again.
`aborted`: the call's `signal` aborted, or the mod stopped.
Later minors may add codes: treat one you do not know as `network`.

```ts
type FoliumOmniErrorCode = | 'unsupported' | 'unavailable' | 'region-restricted' | 'not-signed-in' | 'session-expired' | 'vip-required' | 'rate-limited' | 'network' | 'account-changed' | 'stale-ref' | 'aborted'
```

### FoliumOmniService

Folium 1.7: `folium.omni`, the host's online music sources (Omni), read only: search, songs by id,
lyrics, albums and artists. Needs no permission. Requests are made as the account signed in to that
source in Folia. Songs come with a `ref`, so `folium.playback.playSong` and `enqueue` take them as they
are. Nothing here reads the signed-in account's own library, hands out audio URLs or changes anything at
a source.

A song's `ref` is not its identity: the same song read twice (from the queue and from `resolveSongs`, say)
may come with different refs. Compare `source` and `id`.

Each time the host has to ask a source for you counts once against this mod's allowance, shared with
`platform.raw`: currently 120 a minute (past it a call rejects `rate-limited`) and 8 at a time (past it a
call waits its turn). Looking up many songs may ask more than once; the host may answer from what it read
recently. The host may also limit requests per source across all mods, which rejects `rate-limited` too.
Requests to a source a mod provides (origin `mod`) count against the minute but never wait. A call that
gets no answer in a while rejects `network`. `aborted` (the call's `signal`, or the mod stopping) only
drops the answer: the request at the source may still run, and counts as under way until it ends.

Main window only: in the export window the synchronous methods throw, and the others reject, an Error
whose message is `omni-unavailable-in-export-context` (it has no `code`). The main entry has no `omni`; ask
the client over `rpc`. An older host has no `folium.omni`: check `folium.host.folium.minor >= 7` first.
Async methods reject with an Error whose `code` is a FoliumOmniErrorCode, and with a TypeError
(`invalid-arguments: …`, no `code`) for malformed arguments, a song DTO without a `ref` included.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `listProviders()` | `(): readonly FoliumOmniProviderInfo[]` | The host's online sources, in the host's order. Synchronous; asks no source. |
| `searchSongs()` | `(query: string, options?: { providerId?: string; cursor?: string; limit?: number; signal?: AbortSignal }): Promise<FoliumOmniPage<FoliumSong>>` | Searches songs at `providerId`, or at the source the host has selected now. `query` is 1–200 characters after trimming. Without `cursor` it reads the first page; `limit` (default 30, at most 50) is read only then, and later pages keep it. Song refs come from the host's shared pool (see `playback.getQueue`): read the pages you show. |
| `resolveSongs()` | `(keys: readonly FoliumSongKey[], options?: { signal?: AbortSignal }): Promise<readonly FoliumSongResolution[]>` | Looks songs up by their portable identity (`FoliumSong.source` + `FoliumSong.id`), 1–50 keys a call; resolves one FoliumSongResolution per key, in order. A key that fails does not fail the call; the call rejects only for malformed arguments, the export window and `aborted`. A source without a way to look many songs up at once is asked once per key: resolve the keys you are about to show. A song that only existed on another device (a local file, a cloud upload, a source not installed here) may not resolve, or may resolve to that source's public version. `not-found` comes only from the source's own answer: a key whose request the source refused, or that this host cannot look up by that id yet, comes back `failed`, so keep it. Nothing is played, and no audio address is fetched. |
| `describeSong()` | `(song: FoliumSong): FoliumSongDetails \| null` | What the host knows of a song (by `ref`) without asking its source. Null for a song that is not online, or whose `ref` no longer resolves. Synchronous. |
| `getLyrics()` | `(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<FoliumOmniLyrics>` | The lyrics of an online song (by `ref`), as its source gives them, parsed by the host. Mods' `omni.lyricsResolved` hooks do not run for this read. Rejects `unsupported` for a song that is not online or whose source has no lyrics. |
| `getAlbum()` | `(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<FoliumCollection \| null>` | The album of an online song (by `ref`); null when its source has no album for it. May ask the source. Rejects `unsupported` for a song that is not online or whose source has no albums. |
| `getArtists()` | `(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<readonly FoliumCollection[]>` | The artists of an online song (by `ref`) its source can open; empty when none. May ask the source. Rejects `unsupported` for a song that is not online or whose source has no artists. |
| `resolveCollection()` | `(key: FoliumCollectionKey, options?: { signal?: AbortSignal }): Promise<FoliumCollection \| null>` | An album or artist by its key, with the details its source gives; null when the source has none. A source may also reject `unavailable` or `network` for an id it does not know. |
| `getTracks()` | `(collection: FoliumCollection, options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<FoliumOmniPage<FoliumSong>>` | A page of an album's songs, or of an artist's songs (in the source's order, most popular first for most sources). Without `cursor` the first page; `limit` (default 50, at most 100) is read only then. |
| `getArtistAlbums()` | `(artist: FoliumCollection, options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<FoliumOmniPage<FoliumCollection>>` | A page of an artist's albums; paged as `getTracks`. |
| `capability()` | `(sourceId: string, id: string): unknown` | Folium 2 (a `folium: 1` mod has none): a custom capability (`x.<mod id>.<name>@<version>`) of a source, the very object its mod registered, or null where the source has none by that id (or is not there). The host does not call into it, check it or time it: what it does is between the two mods. Synchronous. |

相关：[FoliumOmniProviderInfo](#foliumomniproviderinfo) · [FoliumOmniPage](#foliumomnipage) · [FoliumSong](#foliumsong) · [FoliumSongKey](#foliumsongkey) · [FoliumSongResolution](#foliumsongresolution) · [FoliumSongDetails](#foliumsongdetails) · [FoliumOmniLyrics](#foliumomnilyrics) · [FoliumCollection](#foliumcollection) · [FoliumCollectionKey](#foliumcollectionkey)

### FoliumEqualizerBand

Folium 1.7: one band of the host's graphic equalizer, as `FoliumEqualizerState.bands` lists it. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly frequency` | `number` | The band's frequency in Hz: the centre of a peaking band, the corner of a shelf. |
| `readonly shape` | `'lowshelf' \| 'peaking' \| 'highshelf'` | `lowshelf` (the first band) lifts or cuts everything below its frequency, `highshelf` (the last band) everything above it, `peaking` (the others) the frequencies around it. Later minors may add shapes: read one you do not know as `peaking`. |

### FoliumEqualizerPresetId

Folium 1.7: a built-in sound of the host, as the audio effects window lists it: `flat` (Level), `lofi`,
`radio`, `hall`, `vocal` and `bass` (Bass boost). Each is an equalizer curve together with a set of effects.
`setMode` takes each of these ids for all of Folium 1.x; later minors may add more.

```ts
type FoliumEqualizerPresetId = 'flat' | 'lofi' | 'radio' | 'hall' | 'vocal' | 'bass'
```

### FoliumEqualizerCustomId

Folium 1.7: one of the user's own saved sounds in the audio effects window (Custom 1 and Custom 2), each a
curve and a set of effects. `setMode` takes each of these ids for all of Folium 1.x; later minors may add more.

```ts
type FoliumEqualizerCustomId = 'custom1' | 'custom2'
```

### FoliumEqualizerUserMode

Folium 1.7: a sound `folium.equalizer.setMode` can switch to: a built-in one, or one of the user's own.

```ts
type FoliumEqualizerUserMode = | { readonly kind: 'preset'; readonly id: FoliumEqualizerPresetId } | { readonly kind: 'custom'; readonly id: FoliumEqualizerCustomId }
```

相关：[FoliumEqualizerPresetId](#foliumequalizerpresetid) · [FoliumEqualizerCustomId](#foliumequalizercustomid)

### FoliumEqualizerMode

Folium 1.7: what the equalizer plays now. `preset` / `custom`: a sound the user chose (or a mod switched
to with `setMode`). `mod`: a curve a mod put in place with `applyCurve`, over the user's own effects;
`modId` names the mod. While that mod is disabled or removed the user's own sound plays, and the state
shows it; the curve comes back when the mod is enabled again. Later minors may add kinds: a mode you do
not know is one the user chose, so leave it be.

```ts
type FoliumEqualizerMode = | FoliumEqualizerUserMode | { readonly kind: 'mod'; readonly modId: string }
```

相关：[FoliumEqualizerUserMode](#foliumequalizerusermode)

### FoliumEqualizerState

Folium 1.7: the host's graphic equalizer as it is heard, as `folium.equalizer.getState()` and
`equalizer.changed` give it. Frozen. The user's custom sounds are not part of it, except the curve of the
one playing.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly enabled` | `boolean` | The processing switch of the audio effects window. While false the gains are kept but not heard, and the effects are off too; the switch is the user's, and no `folium.equalizer` write turns it on. |
| `readonly mode` | `FoliumEqualizerMode` | What plays now. |
| `readonly gains` | `readonly number[]` | The gain of each band in dB, in the order of `bands`, from `minGain` to `maxGain`. Heard only while `enabled`. |
| `readonly bands` | `readonly FoliumEqualizerBand[]` | The bands, lowest first: ten in Folium 1.7. The same frozen array on every read. |
| `readonly minGain` | `number` | The lowest gain of a band in dB: -12 in Folium 1.7. |
| `readonly maxGain` | `number` | The highest gain of a band in dB: 12 in Folium 1.7. |
| `readonly hostPlaysAudio` | `boolean` | Whether what plays goes through the host's own audio, where the equalizer sits. False during external Stage playback (another player's now-playing, a Stage source with lyrics and no audio), and while an online platform sounds the song in a player of its own (a page or a program of the platform's): the equalizer has nothing to act on then. Its settings still apply once the host plays again. |
| `readonly writable` | `boolean` | False while the audio effects window is open: a write that would change something is refused `panel-open` then, and `equalizer.changed` fires when the window closes. Later minors may add other times it is false. The permission and the rate limit are not part of it. |

相关：[FoliumEqualizerMode](#foliumequalizermode) · [FoliumEqualizerBand](#foliumequalizerband)

### FoliumEqualizerChangeOrigin

Folium 1.7: who changed the equalizer, as `equalizer.changed` reports it. `user`: the user, in the audio
effects window. `command`: a host command (the command palette's sound commands). `mod`: a mod, through
`folium.equalizer`; compare `modId` with your own `folium.modId`. `host`: the host itself, with nobody
changing the sound (the sound left the host's own audio or came back to it, the audio effects window opened
or closed, the mod of the curve in place was disabled, removed or enabled again). Later minors may add
kinds: read one you do not know as `user`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly kind` | `'user' \| 'command' \| 'host' \| 'mod'` | Who it was. |
| `readonly modId` | `string \| null` | The mod, for `mod`; null for the others. |

### FoliumEqualizerRefusal

Folium 1.7: why the host did not take a `folium.equalizer` write. `stopped`: this mod has stopped.
`unknown-mode`: this host has no such sound (one a later minor added). `panel-open`: the audio effects
window is open, so the user is at it; wait for `equalizer.changed` with `state.writable` true.
`rate-limited`: too many writes (see FoliumEqualizerService). When several apply, the first of these in
this order is given. A write that would change nothing is never refused for `panel-open` or `rate-limited`.
Later minors may add reasons: treat one you do not know as `rate-limited`, and try again later rather than
in a loop.

```ts
type FoliumEqualizerRefusal = 'stopped' | 'unknown-mode' | 'panel-open' | 'rate-limited'
```

### FoliumEqualizerWriteResult

Folium 1.7: the outcome of a `folium.equalizer` write; `state` is the equalizer after it.

```ts
type FoliumEqualizerWriteResult = | { readonly ok: true; readonly state: FoliumEqualizerState } | { readonly ok: false; readonly reason: FoliumEqualizerRefusal }
```

相关：[FoliumEqualizerState](#foliumequalizerstate) · [FoliumEqualizerRefusal](#foliumequalizerrefusal)

### FoliumEqualizerService

Folium 1.7: `folium.equalizer`, the host's graphic equalizer (the bands of the audio effects window).
Reading needs no permission; `setMode`, `applyCurve` and `releaseCurve` need `equalizer.control`. A mod
gets the equalizer's settings, never its audio nodes. A write lands where the user's own choices do, so the
audio effects window and the sound follow it, and it is kept across restarts.

No write changes the user's custom sounds or turns the processing switch on: while `enabled` is false a
write is kept but not heard. The user comes first: any choice the user makes in the audio effects window
(a sound, keeping a mod's curve as one of their own, going back to their own) ends a mod's curve, and
while that window is open writes are refused `panel-open`. Follow `equalizer.changed`: once its `origin`
is the user, a host command or another mod (not `host`, and not your own mod), step back: putting your
curve back after that overrides the user. The host tells the user which mod changed the sound.

Every write that changes something is saved: write what you settled on rather than animating through it.
Currently a mod may make one such write a second and 20 a minute; past that a write is refused
`rate-limited`. A write changes nothing when the user's settings it would leave and the curve in place
are the same as now; such a write is accepted, does not count, and is never refused `panel-open` or
`rate-limited`. During an automix blend the host holds a mod's change back from the sound until the blend
has ended (`getState` reports it at once), and it glides a mod's gains in rather than switching them.

Main window only: in the export window every method throws an Error whose message is
`equalizer-unavailable-in-export-context`. The main entry has no `equalizer`; ask the client over `rpc`.
An older host has no `folium.equalizer`: check `folium.host.folium.minor >= 7` first. Malformed arguments
throw a TypeError (`invalid-arguments: …`); a write without the permission throws
`permission-denied:equalizer.control`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getState()` | `(): FoliumEqualizerState` | The equalizer now, as it is heard. Synchronous; follow changes with `equalizer.changed`. |
| `setMode()` | `(mode: FoliumEqualizerUserMode): FoliumEqualizerWriteResult` | Switches to a built-in sound or to one of the user's own, as the command palette's sound commands do: its curve and its effects together, and a mod's curve in place ends. Writes no custom sound and leaves the processing switch as it is. Refused `unknown-mode` for a sound this host does not have. Needs `equalizer.control`. |
| `applyCurve()` | `(gains: readonly number[]): FoliumEqualizerWriteResult` | Puts this mod's own curve in place, as mode `{ kind: 'mod' }`: 1 to `bands.length` finite gains in dB, one per band from the lowest. Bands left out read 0; each gain is clamped to `minGain`–`maxGain` and rounded to 0.1 dB, as `state.gains` then shows. The effects and the switch stay as the user had them. The curve stays, across restarts and while this mod reloads, until the user or a mod changes the sound; while this mod is disabled or removed the user's own sound plays, and the curve comes back when it is enabled again. The user can go back to their own sound, or keep the curve as one of their own, from the audio effects window. Needs `equalizer.control`. |
| `releaseCurve()` | `(): boolean` | Takes this mod's curve off and goes back to the user's own sound. True when this mod's curve was in place; false otherwise, and nothing changes. Never refused for the rate or the open window. Needs `equalizer.control`. |

相关：[FoliumEqualizerState](#foliumequalizerstate) · [FoliumEqualizerUserMode](#foliumequalizerusermode) · [FoliumEqualizerWriteResult](#foliumequalizerwriteresult)

### FoliumLyricRenderScale

Folium 1.8: how many pixels the host's canvas and WebGL lyric styles draw, as a multiple of each style's own
default pixel density (for most, the screen's, capped at 2): below 1 draws fewer pixels (lighter, softer),
above 1 supersamples (sharper, heavier on the GPU). `setRenderQuality` takes each of these for all of
Folium 1.x; later minors may add more: read one you do not know as the nearest one you do.

```ts
type FoliumLyricRenderScale = 0.5 | 0.75 | 1 | 1.5 | 2
```

### FoliumLyricAntialias

Folium 1.8: the antialiasing of the canvas and WebGL lyric styles. `auto`: each style's own default (some
use multisampling, some smooth in post-processing); `on` and `off` force it. `setRenderQuality` takes each
of these for all of Folium 1.x; later minors may add modes: read one you do not know as `auto`.

```ts
type FoliumLyricAntialias = 'auto' | 'on' | 'off'
```

### FoliumLyricRenderQuality

Folium 1.8: the host's global lyric render quality, the one level in Settings → Performance & motion, as
`folium.visualizer.getRenderQuality()` and `visualizer.renderQualityChanged` give it. Frozen. The canvas and
WebGL lyric styles follow it unless the user set an override in a style's own settings; those overrides
are not part of it, and no mod reads or writes them. Styles drawn with HTML and CSS do not use it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly scale` | `FoliumLyricRenderScale` | The resolution, as a multiple of each style's own default pixel density. |
| `readonly antialias` | `FoliumLyricAntialias` | The antialiasing. |

相关：[FoliumLyricRenderScale](#foliumlyricrenderscale) · [FoliumLyricAntialias](#foliumlyricantialias)

### FoliumRenderQualityChangeOrigin

Folium 1.8: who changed the render quality, as `visualizer.renderQualityChanged` reports it, and who changed
the mode, a mode's tuning or the beat effects, as the other `visualizer.*` events report it
(FoliumVisualizerChangeOrigin). `user`: anyone but a mod (the user in the settings, the player panel or the
command palette, or the host on the user's behalf: a mode picked at random for the song, an imported or
synced config). `mod`: a mod, through one of the `folium.visualizer.set*` methods; compare `modId` with your
own `folium.modId`. Later minors may add kinds: read one you do not know as `user`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly kind` | `'user' \| 'mod'` | Who it was. |
| `readonly modId` | `string \| null` | The mod, for `mod`; null for `user`. |

### FoliumRenderQualityRefusal

Folium 1.8: why the host did not take a `setRenderQuality`. `stopped`: this mod has stopped.
`rate-limited`: too many writes (see FoliumVisualizerService). A write that would change nothing is never
refused `rate-limited`. Later minors may add reasons: treat one you do not know as `rate-limited`, and try
again later rather than in a loop.

```ts
type FoliumRenderQualityRefusal = 'stopped' | 'rate-limited'
```

### FoliumRenderQualityWriteResult

Folium 1.8: the outcome of a `setRenderQuality`; `quality` is the render quality after it.

```ts
type FoliumRenderQualityWriteResult = | { readonly ok: true; readonly quality: FoliumLyricRenderQuality } | { readonly ok: false; readonly reason: FoliumRenderQualityRefusal }
```

相关：[FoliumLyricRenderQuality](#foliumlyricrenderquality) · [FoliumRenderQualityRefusal](#foliumrenderqualityrefusal)

### FoliumVisualizerChangeOrigin

Folium 1.8: who changed the mode, a mode's tuning or the beat effects; see FoliumRenderQualityChangeOrigin.

```ts
type FoliumVisualizerChangeOrigin = FoliumRenderQualityChangeOrigin
```

相关：[FoliumRenderQualityChangeOrigin](#foliumrenderqualitychangeorigin)

### FoliumVisualizerWriteRefusal

Folium 1.8: why the host did not take a `setMode`, `setTuning` or `setBeatEffects` (and, Folium 1.9, a
`setBackground` or `setAnimationIntensity`), as for `setRenderQuality` (FoliumRenderQualityRefusal):
`stopped` or `rate-limited`. Each kind of write has its own allowance (see FoliumVisualizerService). Treat
a reason you do not know as `rate-limited`.

```ts
type FoliumVisualizerWriteRefusal = FoliumRenderQualityRefusal
```

相关：[FoliumRenderQualityRefusal](#foliumrenderqualityrefusal)

### FoliumTuningKeyInfo

Folium 1.8: one key of a builtin mode's tuning that mods may read and write, as `listModes()` describes it,
with the same range or choices as the control in the mode's own settings. `number`: from `min` to `max`, a
value outside is clamped; with a `step`, a value lands on the nearest whole step from `min` (a count, say),
with none any value in the range is kept. `boolean`: a switch. `choice`: one of `options`. `defaultValue`:
the value before the user changed anything. A value `getTuning` reads may be one the key does not offer
(a choice left to the user, such as cappella's `custom` avatar, which needs a picture the user uploaded):
writing back the value the key holds is always taken. Later minors may add types: leave a key whose type you
do not know alone.

```ts
type FoliumTuningKeyInfo = | { readonly type: 'number'; readonly min: number; readonly max: number; readonly step: number | null; readonly defaultValue: number } | { readonly type: 'boolean'; readonly defaultValue: boolean } | { readonly type: 'choice'; readonly options: readonly string[]; readonly defaultValue: string }
```

### FoliumTuningValue

Folium 1.8: a value of a mode's tuning key.

```ts
type FoliumTuningValue = number | boolean | string
```

### FoliumVisualizerTuning

Folium 1.8: a builtin mode's tuning as mods see it: its declared keys (FoliumTuningKeyInfo) and their values now. Frozen.

```ts
type FoliumVisualizerTuning = Readonly<Record<string, FoliumTuningValue>>
```

相关：[FoliumTuningValue](#foliumtuningvalue)

### FoliumBeatEffectSource

Folium 1.8: what a beat effect of 智能动感模式 plays on. `beats`: the beat list of the track (Beat This!);
`drums`: the drum hits (the drum stem); `stems`: the drum hits and the vocal together. Later minors may add
sources: read one you do not know as `beats`.

```ts
type FoliumBeatEffectSource = 'beats' | 'drums' | 'stems'
```

### FoliumBeatEffectPartInfo

Folium 1.8: a part of a beat effect with its own strength in place of the one (`parts`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly key` | `string` | Stable: the key in FoliumBeatEffectState `parts` and FoliumBeatEffectPatch `parts`. |
| `readonly label` | `string` | Its name in the user's language. |

### FoliumBeatEffectInfo

Folium 1.8: a beat effect a builtin mode draws under 智能动感模式, as `listModes()` describes it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `string` | Stable, `<mode>.<name>`, e.g. `sonnet.lensTear`. |
| `readonly mode` | `string` | The mode that draws it. |
| `readonly label` | `string` | Its name in the user's language, as the mode's settings show it. |
| `readonly source` | `FoliumBeatEffectSource` | What it plays on. |
| `readonly parts` | `readonly FoliumBeatEffectPartInfo[]` | Its parts, each with its own strength; empty for an effect with one strength. |

相关：[FoliumBeatEffectSource](#foliumbeateffectsource) · [FoliumBeatEffectPartInfo](#foliumbeateffectpartinfo)

### FoliumVisualizerModeInfo

Folium 1.8: a lyric animation mode, as `folium.visualizer.listModes()` gives it. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `string` | The mode id: a builtin's (`sonnet`, `machi`) or a mod's (`mod:<modid>:<id>`). What `setMode` takes. |
| `readonly label` | `string` | Its name in the mode picker, in the user's language. |
| `readonly kind` | `'builtin' \| 'mod'` | `builtin` or `mod`. |
| `readonly tuning` | `Readonly<Record<string, FoliumTuningKeyInfo>>` | The keys of its tuning mods may set with `setTuning`, by key; empty for a mode with none (every mod mode). |
| `readonly beatEffects` | `readonly FoliumBeatEffectInfo[]` | The beat effects it draws under 智能动感模式; empty for a mode with none. |

相关：[FoliumTuningKeyInfo](#foliumtuningkeyinfo) · [FoliumBeatEffectInfo](#foliumbeateffectinfo)

### FoliumBeatEffectState

Folium 1.8: one beat effect's own setting, as `getBeatEffects()` gives it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `string` | The effect, as FoliumBeatEffectInfo `id`. |
| `readonly mode` | `string` | The mode that draws it. |
| `readonly on` | `boolean` | Whether it plays (while 智能动感模式 is not `off`). |
| `readonly strength` | `number` | Its strength, 0..2; 1 is the look it was made for. Unused for an effect with parts. |
| `readonly parts` | `Readonly<Record<string, number>>` | The strength of each of its parts, 0..2, by part key; empty for an effect with none. |

### FoliumSmartBeatMode

Folium 1.8: the user's 智能动感模式 switch. `off`: no beat effect plays. `cached`: they play on tracks
already analysed, and nothing new is analysed. `on`: they play, and a track not yet analysed is analysed now
on the GPU, for the effects switched on in the mode on screen: an effect on `beats` runs the beat model, one
on `drums` or `stems` separates the drums, so switching such an effect on under `on` can start that work for
every new track. Read only: it is the user's (see FoliumVisualizerService). Later minors may add modes: read
one you do not know as `cached`.

```ts
type FoliumSmartBeatMode = 'off' | 'cached' | 'on'
```

### FoliumBeatEffectsState

Folium 1.8: the beat effects of every builtin mode, as `getBeatEffects()` and `visualizer.beatEffectsChanged` give them. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly smartBeat` | `FoliumSmartBeatMode` | The user's 智能动感模式 switch; the effects play only while it is not `off`. |
| `readonly effects` | `readonly FoliumBeatEffectState[]` | Every effect, in the order of the mode picker. |

相关：[FoliumSmartBeatMode](#foliumsmartbeatmode) · [FoliumBeatEffectState](#foliumbeateffectstate)

### FoliumBeatEffectPatch

Folium 1.8: a change to one beat effect: the fields given, the others as they are.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly on?` | `boolean` | Whether it plays. |
| `readonly strength?` | `number` | 0..2; a value outside is clamped. |
| `readonly parts?` | `Readonly<Record<string, number>>` | Strengths by part key, 0..2, each clamped; keys the effect has no part for are ignored. |

### FoliumModeWriteResult

Folium 1.8: the outcome of a `setMode`; `mode` is the mode after it.

```ts
type FoliumModeWriteResult = | { readonly ok: true; readonly mode: string } | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal }
```

相关：[FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal)

### FoliumTuningWriteResult

Folium 1.8: the outcome of a `setTuning`: `tuning` is the mode's tuning after it (the values as they were
kept: clamped, rounded to a step, or changed with a key the mode's settings change together, as 云阶's
stagger moved past the other end takes that end along); `ignored` the keys of the patch
the mode does not let mods set.

```ts
type FoliumTuningWriteResult = | { readonly ok: true; readonly tuning: FoliumVisualizerTuning; readonly ignored: readonly string[] } | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal }
```

相关：[FoliumVisualizerTuning](#foliumvisualizertuning) · [FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal)

### FoliumBeatEffectsWriteResult

Folium 1.8: the outcome of a `setBeatEffects`: `state` is the beat effects after it; `ignored` the effect ids
of the patch no mode offers, and `<id>:<part>` for part keys the effect does not have.

```ts
type FoliumBeatEffectsWriteResult = | { readonly ok: true; readonly state: FoliumBeatEffectsState; readonly ignored: readonly string[] } | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal }
```

相关：[FoliumBeatEffectsState](#foliumbeateffectsstate) · [FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal)

### FoliumBackgroundInfo

Folium 1.9: a background type, as `folium.visualizer.listBackgrounds()` gives it. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `string` | The background id: a builtin's (`latent`, `monet`) or a mod's (`mod:<modid>:<id>`). What `setBackground` takes. |
| `readonly label` | `string` | Its name in the background picker, in the user's language. |
| `readonly kind` | `'builtin' \| 'mod'` | `builtin` or `mod`. |

### FoliumAnimationIntensity

Folium 1.9: the animation intensity, the chip in the player panel: how lively the lyric styles and the
backgrounds move. `setAnimationIntensity` takes each of these for all of Folium 1.x; later minors may add
levels: read one you do not know as `normal`.

```ts
type FoliumAnimationIntensity = 'calm' | 'normal' | 'chaotic'
```

### FoliumBackgroundWriteResult

Folium 1.9: the outcome of a `setBackground`; `background` is the background type after it.

```ts
type FoliumBackgroundWriteResult = | { readonly ok: true; readonly background: string } | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal }
```

相关：[FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal)

### FoliumAnimationIntensityWriteResult

Folium 1.9: the outcome of a `setAnimationIntensity`; `intensity` is the animation intensity after it.

```ts
type FoliumAnimationIntensityWriteResult = | { readonly ok: true; readonly intensity: FoliumAnimationIntensity } | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal }
```

相关：[FoliumAnimationIntensity](#foliumanimationintensity) · [FoliumVisualizerWriteRefusal](#foliumvisualizerwriterefusal)

### FoliumVisualizerService

Folium 1.8: `folium.visualizer`, the host's settings of the lyric display that mods may share: the global
lyric render quality (FoliumLyricRenderQuality), the lyric animation mode, the tuning of the builtin modes
(the keys each declares, FoliumTuningKeyInfo) and the beat effects of 智能动感模式; Folium 1.9 adds the
background type and the animation intensity. Reading needs no permission; each kind of write needs its
own: `setRenderQuality` `visualizer.renderQuality`, `setMode` `visualizer.mode`, `setTuning`
`visualizer.tuning`, `setBeatEffects` `visualizer.beatEffects`, `setBackground` `visualizer.background`,
`setAnimationIntensity` `visualizer.animationIntensity`. A write is the
same as the user making the change in the settings or the player panel: what shows the setting changes with
it, the styles follow it (a style may rebuild its renderer for it), and it is kept across restarts. A style's
own render override, its picture-cost settings (resolution, render quality) and the 智能动感模式 switch
(`off` / `cached` / `on`, which decides whether tracks may be analysed on the GPU at all) stay the user's: mods
read them at most, and never write them. Under `on`, though, the effects a mod switches on decide which
analysis runs (FoliumSmartBeatMode): switch on only the effects you mean the picture to have.

The settings are the user's: follow the `visualizer.*Changed` events, and once an `origin` is the user (or
another mod), step back rather than writing yours again. Every write that changes something is saved and
can make the styles rebuild: write what you settled on, never animate through it. Each kind of write has
its own allowance per mod: currently one counted write a second and 20 a minute; past that a write is
refused `rate-limited`. A write that changes nothing is accepted, does not count and is never refused
`rate-limited`.

Main window only: in the export window every method throws an Error whose message is
`visualizer-unavailable-in-export-context` (a visualizer of yours that also renders there checks
`folium.env.context` first). The main entry has no `visualizer`; ask the client over `rpc`. An older host
has no `folium.visualizer`: check `folium.host.folium.minor >= 8` first (`>= 9` for the background and the
animation intensity). Malformed arguments throw a
TypeError (`invalid-arguments: …`); a write without its permission throws `permission-denied:<permission>`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getRenderQuality()` | `(): FoliumLyricRenderQuality` | The global lyric render quality now. Synchronous; follow changes with `visualizer.renderQualityChanged`. |
| `setRenderQuality()` | `(patch: Partial<FoliumLyricRenderQuality>): FoliumRenderQualityWriteResult` | Changes the global lyric render quality: the fields `patch` has, the others as they are. A `scale` or an `antialias` this contract does not list throws a TypeError, and so does a `patch` that is no object; other keys are ignored, and `{}` changes nothing. Needs `visualizer.renderQuality`. |
| `listModes()` | `(): readonly FoliumVisualizerModeInfo[]` | The lyric animation modes there are now, builtin and from mods, in the order of the mode picker, each with the tuning keys and the beat effects it offers. Frozen; a mod mode comes and goes with its mod. |
| `getMode()` | `(): string` | The mode on screen now. Synchronous; follow changes with `visualizer.modeChanged`. |
| `setMode()` | `(id: string): FoliumModeWriteResult` | Switches to the mode `id` (one of `listModes()`), as the user does in the player panel, without the "switched" notice: like the player panel it also switches off "a random mode for every song". An `id` that is not a mode now throws a TypeError. Switching to the mode on screen changes nothing, unless "a random mode for every song" is on: then it switches that off, as the player panel does. While that setting is on, the host picks a mode for each new song itself, and `visualizer.modeChanged` reports the pick as `user`. Needs `visualizer.mode`. |
| `getTuning()` | `(mode: string): FoliumVisualizerTuning` | The tuning of builtin mode `mode` now: the keys `listModes()` lists for it, frozen. A mode that is none now throws a TypeError; a mode with no such keys (every mod mode) gives `{}`. Follow changes with `visualizer.tuningChanged`. |
| `setTuning()` | `(mode: string, patch: Readonly<Record<string, FoliumTuningValue>>): FoliumTuningWriteResult` | Changes the tuning of builtin mode `mode`, as its settings do: the keys `patch` has, the others as they are, whether or not the mode is on screen. A key the mode does not offer is ignored (`ignored`); a value of the wrong type, a number that is not finite, a choice not listed, or a `patch` that is no object throws a TypeError, and nothing is written. A number outside its range is clamped; the value a key holds now is taken as it is, so a tuning `getTuning` read writes back unchanged. `{}` changes nothing. Needs `visualizer.tuning`. |
| `getBeatEffects()` | `(): FoliumBeatEffectsState` | The beat effects of every builtin mode now, and the user's 智能动感模式 switch. Follow changes with `visualizer.beatEffectsChanged`. |
| `setBeatEffects()` | `(patch: Readonly<Record<string, FoliumBeatEffectPatch>>): FoliumBeatEffectsWriteResult` | Changes beat effects, as each mode's settings do: `patch` is FoliumBeatEffectPatch by effect id, the fields given, the others as they are. An id no mode offers is ignored (`ignored`), and so is a part key the effect has no part for; an `on` that is no boolean, a strength that is no finite number, or a patch that is no object throws a TypeError, and nothing is written. Never changes the 智能动感模式 switch. `{}` changes nothing. Needs `visualizer.beatEffects`. |
| `listBackgrounds()` | `(): readonly FoliumBackgroundInfo[]` | Folium 1.9: the background types there are now, builtin and from mods, in the order of the background picker. Frozen; a mod background comes and goes with its mod. |
| `getBackground()` | `(): string` | Folium 1.9: the background type the user has picked. Synchronous; follow changes with `visualizer.backgroundChanged`. A mod's background can stay picked after its mod stopped (the host draws its default one meanwhile), so the id may be none of `listBackgrounds()` for that time. |
| `setBackground()` | `(id: string): FoliumBackgroundWriteResult` | Folium 1.9: switches to the background type `id` (one of `listBackgrounds()`), as the user does in the background picker. An `id` that is not a background now throws a TypeError. The type only: what a type draws from (the picture of `monet`, the list of `url`, each type's own options) stays as the user set it, so a type the user never set up draws its empty state. Needs `visualizer.background`. |
| `getAnimationIntensity()` | `(): FoliumAnimationIntensity` | Folium 1.9: the animation intensity now. Synchronous; follow changes with `visualizer.animationIntensityChanged`. |
| `setAnimationIntensity()` | `(value: FoliumAnimationIntensity): FoliumAnimationIntensityWriteResult` | Folium 1.9: sets the animation intensity, as the chip in the player panel does. A value this contract does not list throws a TypeError. While the app is still starting (no theme on screen yet) it throws an Error whose message is `visualizer-unavailable-in-main-context`, as `folium.ui` does then: write from an event or a user action rather than straight from `activate`. Needs `visualizer.animationIntensity`. |

相关：[FoliumLyricRenderQuality](#foliumlyricrenderquality) · [FoliumRenderQualityWriteResult](#foliumrenderqualitywriteresult) · [FoliumVisualizerModeInfo](#foliumvisualizermodeinfo) · [FoliumModeWriteResult](#foliummodewriteresult) · [FoliumVisualizerTuning](#foliumvisualizertuning) · [FoliumTuningValue](#foliumtuningvalue) · [FoliumTuningWriteResult](#foliumtuningwriteresult) · [FoliumBeatEffectsState](#foliumbeateffectsstate) · [FoliumBeatEffectPatch](#foliumbeateffectpatch) · [FoliumBeatEffectsWriteResult](#foliumbeateffectswriteresult) · [FoliumBackgroundInfo](#foliumbackgroundinfo) · [FoliumBackgroundWriteResult](#foliumbackgroundwriteresult) · [FoliumAnimationIntensity](#foliumanimationintensity) · [FoliumAnimationIntensityWriteResult](#foliumanimationintensitywriteresult)

## 共享工具

`folium.lyrics` 与 `folium.theme`：内置歌词动画使用的同一批函数，主窗口与导出窗口都可用。`folium.lyrics.parse` 是唯一的异步方法，走本地歌词文件的解析流程。

### FoliumWordSegment

One word from `folium.lyrics.segmentWords`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `segment` | `string` | The segment text. |
| `index` | `number` | UTF-16 offset of the segment in the line's `fullText`. |
| `isWordLike` | `boolean` | False for whitespace and punctuation-only segments. |

### FoliumWordColorRange

A keyword-colored span of a line's `fullText` (UTF-16 offsets, end exclusive).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `startOffset` | `number` | Start offset in `fullText` (UTF-16). |
| `endOffset` | `number` | End offset, exclusive. |
| `color` | `string` | CSS color from `wordColors`. |
| `priority` | `number` | Longer and more specific matches rank higher. |

### FoliumLyricsHelpers

The pure lyric helpers builtin modes share, so a mod lays out,
times and colors lines exactly as they do. Available in both contexts.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getLineRenderEndTime()` | `(line: FoliumLine \| null \| undefined): number` | When the host stops showing the line: `renderHints.renderEndTime`. -Infinity for null. |
| `segmentWords()` | `(line: Pick<FoliumLine, 'fullText' \| 'wordSegments'>): FoliumWordSegment[]` | The user's saved split when valid, otherwise Folia's default word segmentation (icu-folia: Intl.Segmenter with jieba for Chinese and BudouX for Japanese; plain Intl.Segmenter until it has loaded). |
| `getRecentCompletedLine()` | `(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine \| null` | With no active line (index -1): the last line already over, for subtitles in gaps. |
| `getUpcomingLine()` | `(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine \| null` | The next line: after the active one, or the first still ahead when none is active. |
| `getUpcomingLines()` | `(lines: readonly FoliumLine[], lineIndex: number, count?: number): FoliumLine[]` | Up to `count` (default 2) lines after the active one; empty when none is active. |
| `buildWordColorRanges()` | `(fullText: string, wordColors: FoliumTheme['wordColors']): FoliumWordColorRange[]` | Non-overlapping keyword color spans of `fullText` for `theme.wordColors`. |
| `resolveWordColor()` | `(wordText: string, wordColors: FoliumTheme['wordColors'], fallbackColor: string, options?: { cjkMatchMode?: 'target-contains-token' \| 'bidirectional-contains' \| 'exact' }): string` | The keyword color of one word, or `fallbackColor`. |
| `parse()` | `(track: FoliumLyricsTrack): Promise<FoliumParsedLyrics>` | Parses a lyric document with the host's local lyric file pipeline, off the main thread. Rejects with a TypeError (`invalid-lyrics-track`) when the track is malformed. |
| `isPureMusicText()` | `(text: string \| null \| undefined): boolean` | Folium 2: whether a lyric text is only the "instrumental, please enjoy" notice, by the host's own rule (the one its lyric display and its platforms use). For a source's `lyrics@1` answer (`isPureMusic`). Synchronous. |

相关：[FoliumLine](#foliumline) · [FoliumWordSegment](#foliumwordsegment) · [FoliumTheme](#foliumtheme) · [FoliumWordColorRange](#foliumwordcolorrange) · [FoliumLyricsTrack](#foliumlyricstrack) · [FoliumParsedLyrics](#foliumparsedlyrics)

### FoliumThemeHelpers

Theme resolution builtin modes use. Available in both contexts.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `resolveFontStack()` | `(theme: Pick<FoliumTheme, 'fontStyle' \| 'fontFamily' \| 'fontFamilyStack'>): string` | CSS font-family value for lyric text. |
| `resolveTranslationFontStack()` | `(theme: Pick<FoliumTheme, 'fontStyle' \| 'fontFamily' \| 'fontFamilyStack'>): string` | CSS font-family value for translations and subtitles. |
| `resolveFontWeight()` | `(theme: Pick<FoliumTheme, 'fontWeight'> \| null \| undefined, fallback: number): number` | The theme's weight, normalized, or `fallback`. |

相关：[FoliumTheme](#foliumtheme)

## 设置 schema

设置分区、visualizer / background 设置、tunings 与命令参数共用 [FoliumSetting](#foliumsetting)。读到的值已合并默认值，写入按 schema 校验。

### FoliumSettingType

Field kinds: a slider (a number), a text box (a string), a switch (a boolean), a choice among `options`
(the chosen option's `value`), or a colour, shown as the app's own colour picker (a `#rrggbb` string,
in lower case).

Folium 1.7: `secret`, a key or token the user types in (an API key). Settings sections only. The form shows
a masked input that never shows a saved value, only whether one is set, and a button to clear it. The
value is not one of the section's values (`settings.get()` leaves it out, `settings.set` ignores it, a
`defaultValue` is ignored): the host keeps it in the main process, encrypted, and the mod reads it through
`folium.secrets` / `api.secrets` (FoliumSecretAccess). It never enters the stored
settings values (`folia_folium_params_v1`), the visual config export and import, the export window or the
logs. Anywhere else (visualizer and background settings, tunings, command params) a `secret` field is
dropped like a field of an unknown type, and the mod's row says so. A Folium 1.6 host drops it in
settings sections too (a section left with no field then fails to register), so check
`folium.host.folium.minor >= 7` before declaring one.

```ts
type FoliumSettingType = 'number' | 'text' | 'boolean' | 'select' | 'color' | 'secret'
```

### FoliumSettingOption

One choice of a `select` field.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `string` | The stored value. |
| `label` | `FoliumLabel` | What the user sees. |

相关：[FoliumLabel](#foliumlabel)

### FoliumSetting

One declarative field. The same schema drives settings sections, visualizer
settings, tunings of builtin modes and command parameters, and it is the only
source of keys, defaults and validation for the values it describes.

A field the host cannot use (no key, a key used twice, an unknown type, a
default of the wrong kind, a select without options) is dropped, and the
mod's row in Settings > Mods says which and why (`settings <key>`).

Values read back are typed `unknown` (FoliumSettingValues). The host has
already checked each against its field, so a read can be cast once to the
shape the schema declares: a JSDoc `@type` cast in plain JS, or
`as { speed: number; tint: string }` in TypeScript.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | Value key, unique within the schema. |
| `type` | `FoliumSettingType` | Field kind. |
| `label` | `FoliumLabel` | Field label. |
| `description?` | `FoliumLabel` | Help text. |
| `group?` | `FoliumLabel` | Fields sharing a group label render together under that heading. |
| `defaultValue?` | `string \| number \| boolean` | Used until the user changes the field; also what `reset` restores. Its kind must match `type`; a `color` default must be `#rrggbb`. Without one: `min` or 0, false, the first option, '' or `#ffffff`. |
| `min?` | `number` | `number`: lower bound (values are clamped). |
| `max?` | `number` | `number`: upper bound (values are clamped). |
| `step?` | `number` | `number`: slider step. Default 1 when both bounds are integers, else 0.01. |
| `placeholder?` | `string` | `text` and `secret`: placeholder. |
| `options?` | `FoliumSettingOption[]` | `select`: the choices; values outside them are rejected. |

相关：[FoliumSettingType](#foliumsettingtype) · [FoliumLabel](#foliumlabel) · [FoliumSettingOption](#foliumsettingoption)

### FoliumSettingValues

Values keyed by field `key`, defaults merged. Read-only; write through `FoliumSettingAccess.set`.

```ts
type FoliumSettingValues = Readonly<Record<string, unknown>>
```

### FoliumSettingAccess

Read/write access to one schema's persisted values (defaults already merged).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly schema` | `readonly FoliumSetting[]` | The fields, as registered (invalid declarations dropped), `secret` fields included. |
| `get()` | `(): FoliumSettingValues` | Current values, defaults merged. The same object until a value changes. `secret` fields are not in it; read them through `folium.secrets`. |
| `set()` | `(patch: Record<string, unknown>): void` | Validated against the schema: unknown keys are dropped, numbers clamped, selects checked. |
| `reset()` | `(): void` | Restores every default. Stored `secret` values stay; clear them with `folium.secrets.set(key, null)`. |
| `onChange()` | `(listener: () => void): FoliumDisposer` | Calls `listener` after any value changes, whoever changed it (the user, `set`, `reset`, an import). |

相关：[FoliumSetting](#foliumsetting) · [FoliumSettingValues](#foliumsettingvalues) · [FoliumDisposer](#foliumdisposer)

## 数据结构

歌词行与主题与内置 visualizer 收到的 `Line` / `Theme` 同名同义，是宿主投影出的冻结副本。

### FoliumLyricRuby

Ruby (furigana) over part of a syllable. Times in seconds on the lyric clock.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | The ruby text. |
| `startTime` | `number` | Start, seconds. |
| `endTime` | `number` | End, seconds. |

### FoliumLyricSyllable

One timed syllable of a word. Times in seconds on the lyric clock.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | The syllable text. |
| `startTime` | `number` | Start, seconds. |
| `endTime` | `number` | End, seconds. |
| `endsWithSpace?` | `boolean` | A space follows this syllable. |
| `ruby?` | `FoliumLyricRuby[]` | Ruby over this syllable. |
| `obscene?` | `boolean` | Marked explicit by the lyric source. |
| `emptyBeat?` | `number` | Beats of silence after the syllable, from the lyric source. |

相关：[FoliumLyricRuby](#foliumlyricruby)

### FoliumLyricAlternateText

Another rendering of a line or vocal: a translation, a romanization, or another role from the lyric source.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `role` | `string` | 'translation', 'romanization' or another role from the lyric source. |
| `language?` | `string` | BCP 47 language tag, when the source gives one. |
| `text` | `string` | The full text. |
| `syllables?` | `FoliumLyricSyllable[]` | Timed syllables, when the source has them. |

相关：[FoliumLyricSyllable](#foliumlyricsyllable)

### FoliumWord

One timed word of a line. Times in seconds on the lyric clock.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | The word text, including a trailing space when there is one. |
| `startTime` | `number` | Start, seconds. |
| `endTime` | `number` | End, seconds. |
| `syllables?` | `FoliumLyricSyllable[]` | Timed syllables, when the source has them. |

相关：[FoliumLyricSyllable](#foliumlyricsyllable)

### FoliumBackgroundVocal

A background vocal (harmony) attached to a line, timed and structured like a line.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `text` | `string` | The full text. |
| `startTime` | `number` | Start, seconds. |
| `endTime` | `number` | End, seconds. |
| `words` | `FoliumWord[]` | Timed words. |
| `agentId?` | `string` | The singer, when the source names one. |
| `translation?` | `string` | Translation text. |
| `romanization?` | `string` | Romanization text. |
| `alternateTexts?` | `FoliumLyricAlternateText[]` | All alternate texts from the source. |

相关：[FoliumWord](#foliumword) · [FoliumLyricAlternateText](#foliumlyricalternatetext)

### FoliumLineTimingClass

How short a line is: `micro` and `short` lines get faster transitions.

```ts
type FoliumLineTimingClass = 'normal' | 'short' | 'micro'
```

### FoliumLineTransitionMode

How the host moves a line in and out: full, fast, or no transition.

```ts
type FoliumLineTransitionMode = 'normal' | 'fast' | 'none'
```

### FoliumWordRevealMode

How the host reveals the words of a line: full, fast, or all at once.

```ts
type FoliumWordRevealMode = 'normal' | 'fast' | 'instant'
```

### FoliumLineRenderHints

How the host times a line on screen; builtin modes read the same values.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `rawDuration` | `number` | `endTime - startTime`, seconds. |
| `timingClass` | `FoliumLineTimingClass` | How short the line is. |
| `renderEndTime` | `number` | When the host stops showing the line (endTime plus hold/tail). |
| `lineTransitionMode` | `FoliumLineTransitionMode` | How the line moves in and out. |
| `wordRevealMode` | `FoliumWordRevealMode` | How its words are revealed. |

相关：[FoliumLineTimingClass](#foliumlinetimingclass) · [FoliumLineTransitionMode](#foliumlinetransitionmode) · [FoliumWordRevealMode](#foliumwordrevealmode)

### FoliumLine

One lyric line, the same fields and meanings as the host `Line` builtin visualizers receive. Times in
seconds on the lyric clock.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `words` | `FoliumWord[]` | Timed words; a line without word timing has one word spanning the line. |
| `startTime` | `number` | Start, seconds. |
| `endTime` | `number` | The lyric's own end time. When the line leaves the screen is `renderHints.renderEndTime`. |
| `fullText` | `string` | The whole line. |
| `renderHints` | `FoliumLineRenderHints` | Always present: the host fills in hints the lyric source did not carry. |
| `translation?` | `string` | Translation text. |
| `romanization?` | `string` | Romanization text. |
| `alternateTexts?` | `FoliumLyricAlternateText[]` | All alternate texts from the source, with language and role. |
| `id?` | `string` | Line id from the source, when it has one. |
| `agentId?` | `string` | The singer, when the source names one. |
| `songPart?` | `string` | Song part name from the source, e.g. `Chorus`. |
| `blockIndex?` | `number` | Index of the song part this line belongs to. |
| `isChorus?` | `boolean` | The line is part of a chorus. |
| `chorusEffect?` | `'bars' \| 'circles' \| 'beams'` | The chorus effect builtin modes draw for it. |
| `backgroundVocals?` | `FoliumBackgroundVocal[]` | Background vocals. |
| `wordSegments?` | `string[]` | The user's saved word split; `join('')` equals `fullText`. See `folium.lyrics.segmentWords`. |

相关：[FoliumWord](#foliumword) · [FoliumLineRenderHints](#foliumlinerenderhints) · [FoliumLyricAlternateText](#foliumlyricalternatetext) · [FoliumBackgroundVocal](#foliumbackgroundvocal)

### FoliumTheme

The current theme, the same fields and meanings as the host `Theme` builtin visualizers receive, plus
`isDaylight`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | Theme name. |
| `backgroundColor` | `string` | CSS color. |
| `primaryColor` | `string` | CSS color of lyric text. |
| `accentColor` | `string` | CSS color for highlights. |
| `secondaryColor` | `string` | CSS color for secondary text. |
| `fontStyle` | `'sans' \| 'serif' \| 'mono'` | The builtin font family class. |
| `fontFamily?` | `string` | The user's chosen family, if any. For a CSS font-family value use `folium.theme.resolveFontStack(theme)`. |
| `fontFamilyStack?` | `string[]` | The user's font fallback list. |
| `fontWeight?` | `number` | For a concrete weight use `folium.theme.resolveFontWeight(theme, fallback)`. |
| `animationIntensity` | `'calm' \| 'normal' \| 'chaotic'` | How lively animations should be; builtin modes scale motion by it. |
| `wordColors?` | `{ word: string; color: string }[]` | Keyword colors; match them with `folium.lyrics.buildWordColorRanges` / `resolveWordColor`. |
| `lyricsIcons?` | `string[]` | Decorative icon names the theme suggests. |
| `provider?` | `string` | Where the theme came from (e.g. an AI provider). |
| `description?` | `string` | Theme description. |
| `isDaylight` | `boolean` | Folium addition: builtin modes get this as a separate `isDaylight` prop. |

### FoliumSong

A song as mods see it. Pass it back to the host (playSong, enqueue, beforePlay.replaceWith) only when it
carries a `ref`.

To keep data of your own per song, key it on `source` and `id` together when `id` is not null (an id is
unique only within its source); for a song without an id, on `title` and `artist`. `ref` is no key: it
is valid for one session only.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string \| null` | The song id at its source, as a string; unique only within `source`; null when unknown. |
| `title` | `string` | Song title. |
| `artist` | `string` | Artists joined with ` / `, in the order the source gives them; '' when there are none. |
| `album` | `string \| null` | Album name. |
| `source` | `string \| null` | Where the song comes from: an Omni provider id, 'local', 'navidrome', … |
| `ref` | `string \| null` | Opaque handle the host can turn back into the real song (playSong, enqueue, beforePlay.replaceWith). Valid for the session; null when the DTO was not built from a host song. |

### FoliumPlaybackState

The host player state.

```ts
type FoliumPlaybackState = 'playing' | 'paused' | 'stopped'
```

### FoliumLoopMode

The repeat mode. `all` repeats the queue, `one` the current song.

```ts
type FoliumLoopMode = 'off' | 'all' | 'one'
```

### FoliumQueueItem

One entry of the play queue, as `folium.playback.getQueue()` lists it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong` | The song; its `ref` works with playSong, enqueue and playQueueItem. |
| `readonly index` | `number` | Its position in the host queue; stale as soon as the queue's `version` changes (`playback.queueChanged`). |

相关：[FoliumSong](#foliumsong)

### FoliumQueueSnapshot

A page of the play queue, from `folium.playback.getQueue()`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly items` | `readonly FoliumQueueItem[]` | The requested page, in queue order; each item carries its absolute `index`. |
| `readonly length` | `number` | Songs in the whole queue, not just this page. |
| `readonly currentIndex` | `number` | Position of the displayed song in the queue; -1 when it is not in it. The host finds the current song by identity, so a song listed twice counts at its first position. |
| `readonly kind` | `'queue' \| 'fm' \| 'stage'` | `queue`: the play queue. `fm`: Personal FM, whose queue is the current FM batch. `stage`: external Stage playback; the queue has nothing to do with what is playing, and playQueueItem refuses. |
| `readonly version` | `string` | Folium 1.7: the queue's version. Equal strings mean the same songs in the same order and the same `kind`; it does not change when only the displayed song moves. Opaque and valid for this session: pass it to `replaceQueue`, never store it. Pages read with the same version belong to the same queue. |

相关：[FoliumQueueItem](#foliumqueueitem)

### FoliumQueueChange

Folium 1.7: what a `playback.queueChanged` event carries. Frozen. Only the outline: read the songs with
`playback.getQueue()`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly length` | `number` | Songs in the whole queue. |
| `readonly currentIndex` | `number` | Position of the displayed song in the queue (its first position); -1 when it is not in it. |
| `readonly version` | `string` | Folium 1.7: the queue's version now, as `FoliumQueueSnapshot.version` gives it. The same as in the event before when only the displayed song moved. |
| `readonly byThisMod` | `boolean` | Folium 1.7: true only in the event the host fires for this mod's own `replaceQueue`, when nothing else changed the queue in the same task; false for every other mod, for a change anyone else made (the user's undo of it included), and when only the displayed song moved. A replacement made while this mod was not listening is never reported as its own later. |

### FoliumQueueReplaceRefusal

Folium 1.7: why `replaceQueue` left the queue as it was.
`stage`: external Stage playback holds the player; try again after a `playback.queueChanged` whose
snapshot `kind` is no longer `stage`.
`transition`: an automix blend is under way (a few seconds, rarely more than half a minute); try again
after a `playback.queueChanged`. One is also fired when the blend ends, and one that comes during the
blend (the arriving song landing in the queue, say) may be refused `transition` again: keep waiting.
`stale-version`: the queue is no longer the one `expectedVersion` names (the user, the host or a mod
changed it); read it again and decide anew rather than replacing blindly.
`stale-ref`: the song DTO at `index` has a `ref` that no longer resolves; read that song again.
`not-queueable`: the song at `index` cannot be in the play queue (a song of external Stage playback).
`rate-limited`: this mod replaced the queue a moment ago; try again after `retryAfterMs`.
Checked in this order: stage, transition, stale-version, then the songs from first to last (stale-ref or
not-queueable for the first song that fails, with its index), then rate-limited. Later minors may add
reasons: treat one you do not know like `transition`.

```ts
type FoliumQueueReplaceRefusal = | 'stage' | 'transition' | 'stale-version' | 'stale-ref' | 'not-queueable' | 'rate-limited'
```

### FoliumQueueReplaced

Folium 1.7: `replaceQueue` replaced the queue, or found it already as asked. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly status` | `'replaced'` | `replaced`. |
| `readonly version` | `string` | The queue's version now; the one you passed when nothing had to change. |
| `readonly length` | `number` | Songs in the queue now. |
| `readonly currentIndex` | `number` | Position of the displayed song in the new queue (its first position); -1 when it is not in it. |

### FoliumQueueReplaceRefused

Folium 1.7: `replaceQueue` left the queue as it was. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly status` | `'refused'` | `refused`. |
| `readonly reason` | `FoliumQueueReplaceRefusal` | Why. |
| `readonly version` | `string` | The queue's version now, which this call did not change. |
| `readonly index` | `number \| null` | For `stale-ref` and `not-queueable`, the position in `songs` of the first song refused; null otherwise. |
| `readonly retryAfterMs` | `number \| null` | For `rate-limited`, milliseconds until this mod may replace the queue again; null otherwise. |

相关：[FoliumQueueReplaceRefusal](#foliumqueuereplacerefusal)

### FoliumQueueReplaceResult

Folium 1.7: what `replaceQueue` resolves. `status` is `replaced` or `refused`; later minors may add
fields, not statuses.

```ts
type FoliumQueueReplaceResult = FoliumQueueReplaced | FoliumQueueReplaceRefused
```

相关：[FoliumQueueReplaced](#foliumqueuereplaced) · [FoliumQueueReplaceRefused](#foliumqueuereplacerefused)

### FoliumPlaybackSnapshot

The whole playback picture, as main entries read it with `api.runtime.getPlaybackSnapshot()`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `song` | `FoliumSong \| null` | The displayed song. |
| `state` | `FoliumPlaybackState` | The player state. |
| `position` | `number` | Seconds. |
| `duration` | `number` | Seconds; 0 when unknown. |
| `lines` | `FoliumLine[]` | Lyrics of the displayed song. |
| `theme` | `FoliumTheme \| null` | The current theme. |
| `visualizerMode` | `string \| null` | The current lyric animation mode id. |
| `volume` | `number` | Output volume, 0–1. |
| `muted` | `boolean` | The mute switch, separate from `volume`. |
| `loopMode` | `FoliumLoopMode` | The repeat mode. |

相关：[FoliumSong](#foliumsong) · [FoliumPlaybackState](#foliumplaybackstate) · [FoliumLine](#foliumline) · [FoliumTheme](#foliumtheme) · [FoliumLoopMode](#foliumloopmode)

### FoliumLyricFormat

Lyric formats the host parses, the same parsers as local lyric files. These and nothing
else: lyrics in any other form (a platform's JSON, SRT, ASS, a custom word-timing scheme) are the mod's
to convert into one of them first. QRC and KRC are the decrypted plain text; the host does not decrypt.

The format is never sniffed, and the content is not checked against it: an `lrc` track that carries
`<mm:ss.xx>` word tags is read as plain LRC (name it `enhanced-lrc`), and mislabelled or malformed text
parses to no lines or to garbled ones. `folium.lyrics.parse` runs the same pipeline, to check a conversion.

```ts
type FoliumLyricFormat = 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'krc' | 'ttml' | 'vtt' | 'awlrc'
```

### FoliumLyricsTrack

One lyric document in its raw text, parsed by the host's local lyric file pipeline.
Each text is at most 1,048,576 characters.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `format` | `FoliumLyricFormat` | How to read `text`. |
| `text` | `string` | The raw lyric document. |
| `translationText?` | `string` | Translation lines, matched to `text` by start time like a local `.t.lrc` file (VTT cues for a `vtt` track). Ignored for `ttml`, which carries its translations inline. |
| `romanizationText?` | `string` | Romanization lines, matched like `translationText`. Ignored for `ttml`. |

相关：[FoliumLyricFormat](#foliumlyricformat)

### FoliumLyricsResult

Lyrics a provider hands the host. With both tracks the host shows `wordByWord`, and falls
back to `main` when it is missing or parses to no lines; a `wordByWord` track without its own
translation or romanization borrows the ones on `main`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `main?` | `FoliumLyricsTrack` | Line-timed lyrics, also the fallback for `wordByWord`. |
| `wordByWord?` | `FoliumLyricsTrack` | Word-timed lyrics, shown in preference to `main`. |
| `isPureMusic?` | `boolean` | An instrumental: the host shows its pure-music view and ignores both tracks. |
| `chorusRanges?` | `Array<{ startTime: number; endTime: number }>` | Chorus spans in seconds on the lyric clock; lines inside one get the chorus effect. Without them the host detects choruses from repeated lines, and TTML `songPart` markers take precedence over both. At most 64 are kept; a span needs finite times with `0 <= startTime < endTime`. |

相关：[FoliumLyricsTrack](#foliumlyricstrack)

### FoliumLegacyLyricsResult

The Folium 1.3 `getLyrics` answer: plain LRC, parsed as plain LRC. Deprecated in favor of
FoliumLyricsResult; Folium 2 drops it. A mod that answers it is told so once in its row in Settings.
@deprecated Answer a FoliumLyricsResult: `{ main: { format: 'lrc', text, translationText } }`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `lrc` | `string` | LRC text. |
| `translationLrc?` | `string` | Translation LRC. |

### FoliumParsedLyrics

What `folium.lyrics.parse` returns.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `lines` | `readonly FoliumLine[]` | The parsed lines; empty when the text holds none. The host's lyric display filter is not applied. |
| `isWordByWord` | `boolean` | Whether the lines carry real word timings rather than timings the host estimated. |

相关：[FoliumLine](#foliumline)

## 音源（Folium 2）

> **预览**：Folium 2 的音源接口（`folium.sources` 与音源类模组 main 入口的 `api`）还是预览版，九个内置音源全部迁过去之前可能变动；用它写的模组可能要随新版本更新。`folium: 1` 冻结在 Folium 1.9 的接口不受影响。

`folium: 2` 的音源类模组（`mod.json` 里声明了 `sources`）在 client 入口里用 `folium.sources.register` 注册音源：注册字段加上一组带版本的能力（`search@1`、`songs@1`、`playback.audio@1` …），宿主按实现了哪些能力、其中哪些成员在推导界面上的开关。`folium.sources.supports(id, version)` 说这个宿主实现了哪些能力；`folium.omni.capability` 取别的音源的自定义能力。这一节来自 [`src/mods/folium/sources/contract.ts`](../../src/mods/folium/sources/contract.ts)。`folium: 1` 的模组没有这些成员。

### FoliumText

Folium 2: a text a source hands the host: written out (shown as it is in every language), one string per
language (a FoliumLabel), or a key of the mod's own locale files (`folium.i18n.key`). The host turns each
into a key of its own translations, so the text follows the UI language like the host's.

```ts
type FoliumText = string | FoliumLabel | FoliumTextKey
```

相关：[FoliumLabel](#foliumlabel) · [FoliumTextKey](#foliumtextkey)

### FoliumTextKey

Folium 2: a key of the mod's own locale files (manifest `locales`: one `<language>.json` each, e.g.
`zh-CN.json`, `en.json`), as `folium.i18n.key` makes it. Frozen. `{{name}}` in the text takes `params`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly i18nKey` | `string` | The key in the mod's locale files; dots go into nested objects (`login.title`). |
| `readonly params?` | `Readonly<Record<string, string \| number>>` | Values for the text's `{{name}}` places. |

### FoliumI18nService

Folium 2: `folium.i18n`, the mod's own locale files.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `key()` | `(key: string, params?: Record<string, string \| number>): FoliumTextKey` | A FoliumText that names `key` of the mod's locale files, with `params` for its `{{name}}` places. |

相关：[FoliumTextKey](#foliumtextkey)

### FoliumSourceCapabilityId

Folium 2: a standard capability id with its version, as a source's `capabilities` names it. The host may
know more in later minors; `folium.sources.supports(id, version)` says what this host implements.

```ts
type FoliumSourceCapabilityId = | 'search@1' | 'songs@1' | 'playback.audio@1' | 'playback.external@1' | 'playback.surface@1' | 'reports@1' | 'lyrics@1' | 'auth@1' | 'library@1' | 'catalog@1' | 'recommendations@1' | 'explore@1' | 'mutations@1' | 'covers@1' | 'raw@1'
```

### FoliumSourceCapabilities

Folium 2: what a source implements, by capability id. A standard capability the host does not know is
warned of once in the mod's row and left out; one it knows the id of but not at this version is left
out too. A custom capability is named `x.<mod id>.<name>@<version>`: the host does not read it, other
mods take it through `folium.omni.capability(sourceId, id)`. A capability (or a member of one) may be a
getter whose answer changes with the account or the system: call `handle.changed()` after it changed.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `search@1?` | `FoliumSourceSearch` | Searching the source. |
| `songs@1?` | `FoliumSourceSongs` | Songs by id, and what is known of one song. |
| `playback.audio@1?` | `FoliumSourceAudioPlayback` | Audio the host plays itself, from an address. |
| `playback.external@1?` | `FoliumSourceExternalPlayback` | A player of the source's own, outside the app, that the host drives and follows. |
| `playback.surface@1?` | `FoliumSourceSurfacePlayback` | A picture of the source's own (a `<video>`, an embedded page) on the player page. Reserved: this host does not implement it yet (`folium.sources.supports('playback.surface', 1)` is false). |
| `reports@1?` | `FoliumSourceReports` | Telling the source what the listener played. |
| `lyrics@1?` | `FoliumSourceLyrics` | Lyrics of its songs, and of other songs where it can match them. |
| `auth@1?` | `FoliumSourceAuth` | Signing in and out. |
| `library@1?` | `FoliumSourceLibrary` | The signed-in account's own lists. |
| `catalog@1?` | `FoliumSourceCatalog` | Albums, artists, playlists and their songs. |
| `recommendations@1?` | `FoliumSourceRecommendations` | What the source recommends to the account. |
| `explore@1?` | `FoliumSourceExplore` | The source's own recommendation page. |
| `mutations@1?` | `FoliumSourceMutations` | Changes to the account: likes, playlists, saved albums. |
| `covers@1?` | `FoliumSourceCovers` | How the source's cover pictures are asked for a size. |
| `raw@1?` | `FoliumSourceRaw` | The source's own backend endpoints, for `platform.raw`. |

相关：[FoliumSourceSearch](#foliumsourcesearch) · [FoliumSourceSongs](#foliumsourcesongs) · [FoliumSourceAudioPlayback](#foliumsourceaudioplayback) · [FoliumSourceExternalPlayback](#foliumsourceexternalplayback) · [FoliumSourceSurfacePlayback](#foliumsourcesurfaceplayback) · [FoliumSourceReports](#foliumsourcereports) · [FoliumSourceLyrics](#foliumsourcelyrics) · [FoliumSourceAuth](#foliumsourceauth) · [FoliumSourceLibrary](#foliumsourcelibrary) · [FoliumSourceCatalog](#foliumsourcecatalog) · [FoliumSourceRecommendations](#foliumsourcerecommendations) · [FoliumSourceExplore](#foliumsourceexplore) · [FoliumSourceMutations](#foliumsourcemutations) · [FoliumSourceCovers](#foliumsourcecovers) · [FoliumSourceRaw](#foliumsourceraw)

### FoliumSourceMark

Folium 2: the letter and colour the host draws for a source (switcher, sign-in, the account avatar's corner).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `letter` | `string` | One character. |
| `color` | `string` | A CSS colour. |

### FoliumSourceAvailability

Folium 2: whether a source can be used now. `not-configured`: it needs something the user has to set up
first. `runtime-unavailable`: this system or build cannot run it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `configured` | `boolean` | False when it cannot be used now. |
| `reason?` | `'not-configured' \| 'runtime-unavailable'` | Why not. |
| `message?` | `FoliumText` | A line on why, shown on its row. |

相关：[FoliumText](#foliumtext)

### FoliumSourceDef

Folium 2: what `folium.sources.register` takes.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | The source's id in mod.json `sources[].id`; the host knows it as `FoliumSourceHandle.id`. |
| `displayName` | `FoliumText` | The full name: the switcher row's second line, the sign-in window. |
| `shortName?` | `FoliumText` | The short name: the switcher row, the search chip. Defaults to `displayName`. |
| `mark?` | `FoliumSourceMark` | Defaults to the short name's first character on a neutral colour. |
| `getAvailability?()` | `(): FoliumSourceAvailability` | Synchronous; asked whenever the host draws the source's rows. Without it the source is always available. |
| `describeFailure?()` | `(operation: 'audio' \| 'collection', error: unknown): FoliumSourceFailureDetail \| null` | After a request for a song's audio or a collection's songs failed: the source's own reading of `error`, or null to leave it to the host's rules. Never throws. |
| `capabilities` | `FoliumSourceCapabilities` | What the source implements. |
| `itemKinds?` | `Record<string, FoliumSourceItemKind>` | Item kinds besides songs (a video, say), each with its traits. Reserved for `playback.surface`: this host reads none yet. |
| `routeOf?()` | `(song: FoliumSourceSong): 'audio' \| 'external' \| 'surface'` | For a source with more than one way to play: which one plays `song`. Reserved for `playback.surface`: this host does not ask it yet, and a source with both `playback.audio` and `playback.external` plays through the external player. |

相关：[FoliumText](#foliumtext) · [FoliumSourceMark](#foliumsourcemark) · [FoliumSourceAvailability](#foliumsourceavailability) · [FoliumSourceFailureDetail](#foliumsourcefailuredetail) · [FoliumSourceCapabilities](#foliumsourcecapabilities) · [FoliumSourceItemKind](#foliumsourceitemkind) · [FoliumSourceSong](#foliumsourcesong)

### FoliumSourceItemKind

Folium 2: the traits of an item kind (`FoliumSourceDef.itemKinds`). Reserved: this host reads none yet.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `lyrics?` | `'none' \| 'own' \| 'match'` | `none`: never lyrics; `own`: only the source's own; `match`: matched like a song's. |
| `likable?` | `boolean` | It can be liked. |
| `reported?` | `boolean` | A play of it is reported to the source. |

### FoliumSourceHandle

Folium 2: what `folium.sources.register` returns. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly id` | `string` | The id the host knows the source by, as `FoliumSong.source` names its songs: a built-in source's short id, or `folium.<mod id>.<source id>`. |
| `unregister()` | `(): void` | Removes the source. Safe to call more than once; the host removes it when the mod stops anyway. |
| `changed()` | `(): void` | Tells the host that something it reads synchronously changed (a getter of `capabilities`, of a capability, `access`, `audioQualityLevels`): it reads the source again. |
| `notify()` | `(notice: FoliumSourceNotice): void` | Tells the listener something unasked (a local service of the source's own that stopped, say), as the app's status line. Two notices with the same `nonce` are one. |

相关：[FoliumSourceNotice](#foliumsourcenotice)

### FoliumSourceNotice

Folium 2: a notice of a source (`FoliumSourceHandle.notify`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `'error' \| 'success' \| 'info'` | How it is drawn. |
| `text` | `FoliumText` | What it says. |
| `nonce?` | `number` | Two notices with the same nonce are the same notice. |
| `durationMs?` | `number` | How long it stays, in milliseconds. |

相关：[FoliumText](#foliumtext)

### FoliumSourceErrorCode

Folium 2: the codes of `folium.sources.error`, the host's own reading of a failure.
`auth-required`: it needs a signed-in account (or the sign-in ran out). `unsupported`: the source does not
do this. `not-public`: the list is private. `unavailable`: the source's service did not take the request
(not set up, not running, refused); never "taken down". `not-playable`: it answered without audio for the
song and cannot say why. `preview-only`: only a clip may play. `subscription-required`: only paying
accounts may. `region-restricted`: not from this region. `network`: no answer. `invalid-response`: an
answer the source could not read.

```ts
type FoliumSourceErrorCode = | 'auth-required' | 'unsupported' | 'not-public' | 'unavailable' | 'not-playable' | 'preview-only' | 'subscription-required' | 'region-restricted' | 'network' | 'invalid-response'
```

### FoliumSourceErrorDetails

Folium 2: what goes with a source error (`folium.sources.error`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `httpStatus?` | `number` | The HTTP status of the answer that failed, apart from any code in its body. |
| `retryAfterMs?` | `number` | How long the source asks to wait before the next try (a 429), in milliseconds. |
| `cause?` | `unknown` | What failed underneath. |

### FoliumSourceError

Folium 2: an Error made by `folium.sources.error`.

```ts
interface FoliumSourceError extends Error
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly code` | `FoliumSourceErrorCode` | The code it was made with. |
| `readonly httpStatus?` | `number` | As it was given. |
| `readonly retryAfterMs?` | `number` | As it was given. |

相关：[FoliumSourceErrorCode](#foliumsourceerrorcode)

### FoliumSourcePageStore

Folium 2: a synchronous store of short strings in this window, for what a source reads while the host
draws (a session token, a device id). Kept per source id; read and written at once.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `get()` | `(key: string): string \| null` | The value, or null. |
| `set()` | `(key: string, value: string \| null): void` | Stores `value`; null removes it. |
| `keys()` | `(): string[]` | The keys stored. |

### FoliumSourcesService

Folium 2: `folium.sources`, how a source mod (one with `sources` in mod.json) gives the host its sources.
Main window only: in the export window `register` and `pageStore` throw `sources-unavailable-in-export-context`.
A mod without `sources` in mod.json gets `not-a-source-mod` from them.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `register()` | `(def: FoliumSourceDef): FoliumSourceHandle` | Registers a source the manifest declares (`sources[].id`). Register before the first `await` of `activate`, so that the first screen finds it. Throws for an id the manifest does not declare, a second registration of one id, or a definition without capabilities. A source the user turned off is not registered: the handle's `unregister` does nothing then. |
| `supports()` | `(id: string, version: number): boolean` | Whether this host implements capability `id` at `version` (`supports('search', 1)`). Synchronous. |
| `error()` | `(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError` | An Error with a code the host reads: throw it from a capability member. |
| `pageStore()` | `(sourceId: string): FoliumSourcePageStore` | The synchronous store of one of this mod's sources (by the id the manifest declares, or the handle's). |

相关：[FoliumSourceDef](#foliumsourcedef) · [FoliumSourceHandle](#foliumsourcehandle) · [FoliumSourceErrorCode](#foliumsourceerrorcode) · [FoliumSourceErrorDetails](#foliumsourceerrordetails) · [FoliumSourceError](#foliumsourceerror) · [FoliumSourcePageStore](#foliumsourcepagestore)

### FoliumSourcePage

Folium 2: one page of a list, read by offset.

```ts
interface FoliumSourcePage<T>
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `T[]` | The page, in the source's order. |
| `total?` | `number` | The whole list's length, where the source says it. |
| `hasMore` | `boolean` | There are more after this page. |
| `nextOffset?` | `number` | Where the next page starts; defaults to the offset asked plus the items given. |

### FoliumSourceNamedRef

Folium 2: an artist or an album a song names, with where it opens in the source's catalog.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | The source's own id of the artist or album. |
| `name` | `string` | Its name. |
| `ref?` | `boolean` | It opens in `catalog@1` (an album by `getAlbumTracks`, an artist by `getArtistDetail`). Default true. |

### FoliumSourceAlbumRef

Folium 2: a song's album (`FoliumSourceSong.album`).

```ts
interface FoliumSourceAlbumRef extends FoliumSourceNamedRef
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `coverUrl?` | `string` | The album's cover. |
| `id` | `string` | 继承自 [FoliumSourceNamedRef](#foliumsourcenamedref)。The source's own id of the artist or album. |
| `name` | `string` | 继承自 [FoliumSourceNamedRef](#foliumsourcenamedref)。Its name. |
| `ref?` | `boolean` | 继承自 [FoliumSourceNamedRef](#foliumsourcenamedref)。It opens in `catalog@1` (an album by `getAlbumTracks`, an artist by `getArtistDetail`). Default true. |

相关：[FoliumSourceNamedRef](#foliumsourcenamedref)

### FoliumSourceReplayGain

ReplayGain values of a song, in decibels and linear peaks.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `trackGain?` | `number` | Track gain, dB. |
| `albumGain?` | `number` | Album gain, dB. |
| `trackPeak?` | `number` | Track peak, a positive linear ratio. |
| `albumPeak?` | `number` | Album peak, a positive linear ratio. |

### FoliumSourceSong

Folium 2: a song as a source describes it (plan §4.3). The host keeps it with its queue, history and
playlists, so `data` must be JSON and small; what else is stored with a song is the host's.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | The song's id at the source. |
| `title` | `string` | The title. |
| `artists` | `FoliumSourceNamedRef[]` | The artists, in order. |
| `album?` | `FoliumSourceAlbumRef` | The album. |
| `durationMs?` | `number` | Milliseconds. |
| `coverUrl?` | `string` | The song's own cover; the album's when left out. |
| `aliases?` | `string[]` | Other titles of the song (a subtitle, a known-as). |
| `translatedTitles?` | `string[]` | The title in other languages. |
| `kind?` | `string` | An item kind of `FoliumSourceDef.itemKinds`; a song when left out. Reserved: this host reads none yet. |
| `variant?` | `string` | Which version of the song this is (a cloud upload, a live take), where the source tells them apart. |
| `pureMusic?` | `boolean` | The source marks it as instrumental. |
| `video?` | `boolean` | Its audio is a music video's. |
| `lyricIds?` | `Record<string, string>` | The ids other sources know the song by, for their lyrics: `{ '<source id>': '<the song's id there>' }`. |
| `row?` | `{ id?: string; listenCount?: number }` | What goes with the row it was read from, not with the song. |
| `replayGain?` | `FoliumSourceReplayGain` | Loudness values of the song. |
| `data?` | `Record<string, FoliumJsonValue>` | The source's own data of the song, handed back with it. Plain JSON of at most 16 KB as JSON text: the host keeps it with the song (queue, history). Data that is not JSON, or larger, is not kept at all (one warning a source in the log), and the song comes back without it. Functions in it are left out, as JSON does. |

相关：[FoliumSourceNamedRef](#foliumsourcenamedref) · [FoliumSourceAlbumRef](#foliumsourcealbumref) · [FoliumSourceReplayGain](#foliumsourcereplaygain) · [FoliumJsonValue](#foliumjsonvalue)

### FoliumSourceUser

Folium 2: an account at a source.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | The source's id of the account. |
| `nickname` | `string` | Its name. |
| `avatarUrl?` | `string` | Its picture. |
| `backgroundUrl?` | `string` | Its banner. |
| `vipType?` | `number` | The source's own membership level, where it has one. |

### FoliumSourceFmLaunch

Folium 2: what a radio card starts (`FoliumSourceCollection.personalFm`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `'DEFAULT' \| 'FAMILIAR' \| 'EXPLORE' \| 'SCENE_RCMD' \| 'PUZZLE_MODE_RCMD'` | A mode of `getPersonalFmCatalog`. |
| `scene` | `string \| null` | A scene, for `SCENE_RCMD` only. |
| `station?` | `string \| null` | One of the source's extra radios; the personal FM when left out. |

### FoliumSourceCollection

Folium 2: a playlist, an album, an artist, or a list the source makes (`radio`, `cloud`,
`listening_rank`, `artist_songs`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | The source's own id. |
| `type` | `'playlist' \| 'album' \| 'artist' \| 'radio' \| 'cloud' \| 'listening_rank' \| 'artist_songs' \| (string & {})` | What it is. |
| `name` | `string` | Its name. |
| `coverUrl?` | `string` | Its cover. |
| `description?` | `string` | The source's description. |
| `trackCount?` | `number` | Songs in it. |
| `albumCount?` | `number` | An artist's albums. |
| `isOwned?` | `boolean` | The account made it. |
| `creator?` | `FoliumSourceUser` | Who made it. |
| `artists?` | `FoliumSourceNamedRef[]` | An album's artists. |
| `aliases?` | `string[]` | Other names. |
| `publishedAt?` | `number` | Release time, milliseconds since the epoch. |
| `publisher?` | `string` | The label or publisher. |
| `playCount?` | `number` | Plays the source counts. |
| `updatedAt?` | `number` | Last change, milliseconds since the epoch. |
| `tracksUpdatedAt?` | `number` | Last change of its songs, milliseconds since the epoch. |
| `isLiked?` | `boolean` | The account saved or liked it. |
| `listeningRank?` | `'week' \| 'all'` | For `listening_rank`: the span it counts. |
| `personalFm?` | `FoliumSourceFmLaunch` | For `radio`: what selecting it starts. |
| `data?` | `Record<string, FoliumJsonValue>` | The source's own data, handed back with it: plain JSON of at most 16 KB, as a song's `data` (not kept otherwise). |

相关：[FoliumSourceUser](#foliumsourceuser) · [FoliumSourceNamedRef](#foliumsourcenamedref) · [FoliumSourceFmLaunch](#foliumsourcefmlaunch) · [FoliumJsonValue](#foliumjsonvalue)

### FoliumSourceSearchContext

Folium 2: who is searching. Paging of one `session` does not disturb another's.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `session?` | `string` | Absent for the host's own search page. |

### FoliumSourceAccess

Folium 2: whether a capability works with no one signed in (`anonymous`, the default) or only with an account.

```ts
type FoliumSourceAccess = 'anonymous' | 'account'
```

### FoliumSourceSearch

Folium 2: `search@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly access?` | `FoliumSourceAccess` | Whether searching needs an account; read when the host builds its search sources. May be a getter. |
| `searchSongs()` | `(query: string, limit: number, offset: number, context?: FoliumSourceSearchContext): Promise<FoliumSourcePage<FoliumSourceSong>>` | Songs for `query`, `limit` from `offset`. |
| `searchAlbums?()` | `(query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>` | Albums (`type: 'album'`); left out where the source has no album search. |
| `searchPlaylists?()` | `(query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>` | Playlists (`type: 'playlist'`); left out where the source has no playlist search. |

相关：[FoliumSourceAccess](#foliumsourceaccess) · [FoliumSourceSearchContext](#foliumsourcesearchcontext) · [FoliumSourcePage](#foliumsourcepage) · [FoliumSourceSong](#foliumsourcesong) · [FoliumSourceCollection](#foliumsourcecollection)

### FoliumSourceSongAvailability

Folium 2: what a source marks against a song. `unavailable` goes with `taken-down` only; limits of
accounts, payment or region are `unknown` with `restricted`, found out when it is played.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `state` | `'playable' \| 'unavailable' \| 'unknown'` | What the source says. |
| `label?` | `FoliumText` | A short tag on its row. |
| `reason?` | `'taken-down' \| 'restricted'` | Why. |

相关：[FoliumText](#foliumtext)

### FoliumSourceSongs

Folium 2: `songs@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly access?` | `FoliumSourceAccess` | Whether looking songs up needs an account. May be a getter. |
| `readonly metadataMatch?` | `boolean` | The source can give local songs online details (the metadata match): it is searched by title and artist for them, in the order the sources registered. It needs `search@1`. |
| `getSong()` | `(id: string): Promise<FoliumSourceSong \| null>` | The song by id; null where the source has none by it. |
| `getSongs?()` | `(ids: string[]): Promise<(FoliumSourceSong \| null)[]>` | Many at once, in the order of `ids`, null for an id it has none by. A refused request rejects. |
| `readonly songsPerRequest?` | `number` | How many ids one `getSongs` takes at most; all of them when left out. |
| `getAvailability?()` | `(song: FoliumSourceSong): FoliumSourceSongAvailability` | What the source marks against a song. Synchronous; asked while rows are drawn. |
| `getReplacement?()` | `(song: FoliumSourceSong): Promise<{ song: FoliumSourceSong; label?: FoliumText } \| null>` | Another version of a song that cannot play, to play in its place; null where there is none. |
| `getPlayedSong?()` | `(song: FoliumSourceSong): Promise<FoliumSourceSong \| null>` | The song that plays in this one's place (a video's song version); null where it plays as itself. |
| `getPageUrl?()` | `(song: FoliumSourceSong): string \| null` | The song's public web page; null where there is none. Synchronous. |

相关：[FoliumSourceAccess](#foliumsourceaccess) · [FoliumSourceSong](#foliumsourcesong) · [FoliumSourceSongAvailability](#foliumsourcesongavailability) · [FoliumText](#foliumtext)

### FoliumSourceAudioQuality

Folium 2: the quality levels, lowest first. `ultra` only for a source that lists it.

```ts
type FoliumSourceAudioQuality = 'standard' | 'high' | 'ultra' | 'lossless' | 'hires'
```

### FoliumSourceAudio

Folium 2: a song's audio address (`playback.audio@1`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | An http(s) address the host plays. |
| `expiresAt?` | `number` | When the address stops working, milliseconds since the epoch. |
| `quality?` | `FoliumSourceAudioQuality` | The level it really is, where that is not the one asked for. |
| `replayGain?` | `FoliumSourceReplayGain` | Loudness values that go with this file. |
| `preview?` | `boolean` | It is a clip, not the whole song: it plays with a notice and is never kept. |
| `clipStartMs?` | `number` | Where the clip starts in the song, milliseconds. |

相关：[FoliumSourceAudioQuality](#foliumsourceaudioquality) · [FoliumSourceReplayGain](#foliumsourcereplaygain)

### FoliumSourceAudioPlayback

Folium 2: `playback.audio@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getAudioSource()` | `(song: FoliumSourceSong, quality: FoliumSourceAudioQuality): Promise<FoliumSourceAudio \| null>` | The address of `song` at `quality` (one of `audioQualityLevels`); null when there is none and nothing to say. |
| `readonly audioQualityLevels?` | `readonly FoliumSourceAudioQuality[]` | The levels the source tells apart, lowest first; all but `ultra` when left out. May be a getter. |
| `readonly previewNotice?` | `FoliumText` | What the notice says while a clip of this source plays; the host's own words when left out. |
| `keepAudio?()` | `(url: string): Promise<boolean>` | For a source that keeps audio in a cache of its own: keep the file `url` plays; resolves to whether it is kept. |
| `hasKeptAudio?()` | `(url: string): Promise<boolean>` | Whether that cache holds the file `url` plays. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourceAudioQuality](#foliumsourceaudioquality) · [FoliumSourceAudio](#foliumsourceaudio) · [FoliumText](#foliumtext)

### FoliumSourceExternalStatus

Folium 2: what an external player has loaded (`playback.external@1`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `mediaId` | `string` | The id the source gave the player. |
| `isPlaying` | `boolean` | It is playing. |
| `positionMs` | `number` | Milliseconds. |
| `durationMs` | `number` | Milliseconds. |
| `ended` | `boolean` | The player says the track ran out. |
| `live?` | `boolean` | A live broadcast: no timeline, no end. |
| `seeking?` | `boolean` | A seek the player made itself. |
| `starting?` | `boolean` | It accepted a start and is still buffering. |

### FoliumSourceExternalPlayback

Folium 2: `playback.external@1`, a player of the source's own that the host drives and follows.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `canPlay?()` | `(song: FoliumSourceSong): boolean` | False for a song it knows it cannot start. Synchronous, no request. |
| `prepareNext?()` | `(song: FoliumSourceSong, upcoming: FoliumSourceSong[]): Promise<void>` | Prepares what follows without interrupting the song now. |
| `isPrepared?()` | `(song: FoliumSourceSong): boolean` | Whether a prepared successor is there for `song`. Synchronous. |
| `play()` | `(song: FoliumSourceSong, startSec: number): Promise<void>` | Starts `song` at `startSec`; resolves once started. |
| `adopt?()` | `(song: FoliumSourceSong): void` | The player already has `song` (from a window that is gone): take it as the current one. Synchronous. |
| `pause()` | `(): Promise<void>` | Pauses. |
| `resume()` | `(): Promise<void>` | Resumes. |
| `seek()` | `(seconds: number): Promise<void>` | Seeks, seconds. |
| `setVolume?()` | `(volume: number): Promise<void>` | The player's own level, 0 to 1. |
| `setRepeatOne?()` | `(enabled: boolean): Promise<void>` | The player's own single-track repeat. |
| `getStatus()` | `(song: FoliumSourceSong): Promise<FoliumSourceExternalStatus>` | The player's state now, from no cache. |
| `isStatusForSong()` | `(song: FoliumSourceSong, status: FoliumSourceExternalStatus): boolean` | Whether the player's loaded track is `song`. Synchronous; asked twice a second. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourceExternalStatus](#foliumsourceexternalstatus)

### FoliumSourceSurfacePlayback

Folium 2: `playback.surface@1`. Reserved: the host does not implement it yet. It will be the external
player's members plus `mount`, which puts the source's picture into a container on the player page.

```ts
interface FoliumSourceSurfacePlayback extends FoliumSourceExternalPlayback
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `mount()` | `(container: HTMLElement, context: { readonly song: FoliumSourceSong }): FoliumDisposer` | Puts the picture into `container`; returns what takes it out. |
| `canPlay?()` | `(song: FoliumSourceSong): boolean` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。False for a song it knows it cannot start. Synchronous, no request. |
| `prepareNext?()` | `(song: FoliumSourceSong, upcoming: FoliumSourceSong[]): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Prepares what follows without interrupting the song now. |
| `isPrepared?()` | `(song: FoliumSourceSong): boolean` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Whether a prepared successor is there for `song`. Synchronous. |
| `play()` | `(song: FoliumSourceSong, startSec: number): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Starts `song` at `startSec`; resolves once started. |
| `adopt?()` | `(song: FoliumSourceSong): void` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。The player already has `song` (from a window that is gone): take it as the current one. Synchronous. |
| `pause()` | `(): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Pauses. |
| `resume()` | `(): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Resumes. |
| `seek()` | `(seconds: number): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Seeks, seconds. |
| `setVolume?()` | `(volume: number): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。The player's own level, 0 to 1. |
| `setRepeatOne?()` | `(enabled: boolean): Promise<void>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。The player's own single-track repeat. |
| `getStatus()` | `(song: FoliumSourceSong): Promise<FoliumSourceExternalStatus>` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。The player's state now, from no cache. |
| `isStatusForSong()` | `(song: FoliumSourceSong, status: FoliumSourceExternalStatus): boolean` | 继承自 [FoliumSourceExternalPlayback](#foliumsourceexternalplayback)。Whether the player's loaded track is `song`. Synchronous; asked twice a second. |

相关：[FoliumSourceExternalPlayback](#foliumsourceexternalplayback) · [FoliumSourceSong](#foliumsourcesong) · [FoliumDisposer](#foliumdisposer)

### FoliumSourcePlaybackReport

Folium 2: one finished listening report. `playedSeconds` is time really played, never a position.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `playedSeconds` | `number` | Seconds played, at most `totalSeconds`. |
| `totalSeconds?` | `number` | The track's length. |
| `quality?` | `FoliumSourceAudioQuality` | The level it played at. |

相关：[FoliumSourceAudioQuality](#foliumsourceaudioquality)

### FoliumSourceReports

Folium 2: `reports@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `canReport?()` | `(song: FoliumSourceSong): boolean` | Whether a play of `song` can be reported at all. Synchronous. |
| `report()` | `(song: FoliumSourceSong, report: FoliumSourcePlaybackReport): Promise<void>` | Reports a play. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourcePlaybackReport](#foliumsourceplaybackreport)

### FoliumSourceLyricFormat

Folium 2: the lyric formats of a source's tracks: those of `folium.lyrics.parse` (FoliumLyricFormat), and
`folia`, a Folia lyric document (`.fia`).

```ts
type FoliumSourceLyricFormat = 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'krc' | 'ttml' | 'vtt' | 'awlrc' | 'folia'
```

### FoliumSourceLyricsTrack

Folium 2: one lyric track in its raw text. The host parses it as its format says, as a platform's lyrics
(no local-file sniffing, no combined timelines). Each text is at most 1,048,576 characters.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `format` | `FoliumSourceLyricFormat` | How to read `text`. |
| `text` | `string` | The raw document. |
| `translationText?` | `string` | Translation lines, matched to the lines by start time. Ignored for `ttml` and `folia`. |
| `translationFormat?` | `'lrc' \| 'krc'` | The format of `translationText`: `lrc` when left out, or `krc`. |
| `romanizationText?` | `string` | Romanization lines, matched like the translation. |
| `romanizationFormat?` | `'lrc' \| 'krc'` | The format of `romanizationText`: `lrc` when left out, or `krc`. |

相关：[FoliumSourceLyricFormat](#foliumsourcelyricformat)

### FoliumSourceLyricsResult

Folium 2: a song's lyrics as a source gives them. With both tracks the host shows `wordByWord` and falls
back to `main`; a `wordByWord` track without its own translation or romanization borrows `main`'s.
`isPureMusic` may come with tracks: the host keeps both.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `main?` | `FoliumSourceLyricsTrack` | Line-timed lyrics. |
| `wordByWord?` | `FoliumSourceLyricsTrack` | Word-timed lyrics. |
| `isPureMusic?` | `boolean` | The source marks the song as instrumental. |
| `chorusRanges?` | `Array<{ startTime: number; endTime: number }>` | Chorus spans in seconds; without them the host finds choruses itself. At most 64. |

相关：[FoliumSourceLyricsTrack](#foliumsourcelyricstrack)

### FoliumSourceLyricAlias

Folium 2: another title and artist of the same song, for matching lyrics elsewhere.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | The title. |
| `artist` | `string` | The artist. |
| `album?` | `string` | The album. |

### FoliumSourceLyrics

Folium 2: `lyrics@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly access?` | `FoliumSourceAccess` | Whether lyrics need an account. May be a getter. |
| `readonly crossSource?` | `{ readonly linesOnly?: boolean }` | The source can give lyrics to other sources' songs and to local songs: it is a lyric source of the match windows and the automatic pick (searched through `search@1`). `linesOnly`: its lyrics are timed by line only and carry no chorus. |
| `getLyrics()` | `(song: FoliumSourceSong, context?: { userId?: string \| null }): Promise<FoliumSourceLyricsResult \| null>` | The lyrics of one of its songs; `context.userId` is the signed-in account's id, where there is one. |
| `readonly prefersOwnWordByWord?` | `boolean` | Its own word timing is the one to keep over another source's. |
| `getChorusRanges?()` | `(songId: string): Promise<Array<{ startTime: number; endTime: number }>>` | The chorus spans of a song by id, seconds. |
| `getSearchAlias?()` | `(song: FoliumSourceSong): Promise<FoliumSourceLyricAlias \| null>` | Another title and artist of the same song; null where there are none. |
| `getAlternateArtistName?()` | `(song: FoliumSourceSong): Promise<string \| null>` | Another name the song's artist goes by elsewhere; null where there is none. |

相关：[FoliumSourceAccess](#foliumsourceaccess) · [FoliumSourceSong](#foliumsourcesong) · [FoliumSourceLyricsResult](#foliumsourcelyricsresult) · [FoliumSourceLyricAlias](#foliumsourcelyricalias)

### FoliumSourceLoginCase

Folium 2: the cases a failed sign-in can be (the host's own table says what each shows).

```ts
type FoliumSourceLoginCase = | 'code-expired' | 'expired-after-scan' | 'browser-unfinished' | 'not-authorized' | 'unreachable' | 'no-answer' | 'refused' | 'retry-later' | 'device-limit' | 'wrong-scan-app' | 'local-service-stopped' | 'local-service-unavailable' | 'cannot-listen' | 'no-browser' | 'browser-still-open' | 'browser-closed-early' | 'browser-unread' | 'browser-not-opened' | 'account-not-read' | 'unknown'
```

### FoliumSourceLoginFailure

Folium 2: what a source knows of a failed sign-in step. Nothing private: no cookie, token, IP or account.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `case?` | `FoliumSourceLoginCase` | The case, where the source can name it; the host's rules sort the rest. |
| `code?` | `string` | The platform's own code. |
| `message?` | `string` | The platform's own words. |
| `httpStatus?` | `number` | HTTP status. |
| `upstreamCode?` | `string` | A code the platform passes on. |
| `retryAfterMs?` | `number` | How long to wait before trying again. |

相关：[FoliumSourceLoginCase](#foliumsourcelogincase)

### FoliumSourceFailureCase

Folium 2: the cases a failed audio or collection request can be.

```ts
type FoliumSourceFailureCase = | 'unreachable' | 'local-service-stopped' | 'retry-later' | 'sign-in-needed' | 'account-refused' | 'subscription-required' | 'purchase-required' | 'entitlement-required' | 'preview-only' | 'region-restricted' | 'not-configured' | 'taken-down' | 'no-audio' | 'audio-unplayable' | 'not-public' | 'refused' | 'unknown'
```

### FoliumSourceFailureDetail

Folium 2: what a source knows of a failed audio or collection request (`describeFailure`). Nothing private.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `case?` | `FoliumSourceFailureCase` | The case, where the source can name it. |
| `code?` | `string` | The platform's own code. |
| `message?` | `string` | The platform's own words. |
| `httpStatus?` | `number` | HTTP status. |
| `upstreamCode?` | `string` | A code the platform passes on. |
| `retryAfterMs?` | `number` | How long to wait. |
| `likelyCause?` | `'sign-in' \| 'subscription' \| 'region'` | What may be behind it, where the answer hints. |
| `signedOut?` | `boolean` | No account was signed in when it was asked. |

相关：[FoliumSourceFailureCase](#foliumsourcefailurecase)

### FoliumSourceLoginState

Folium 2: where a sign-in is (`auth@1.checkLogin`).

```ts
type FoliumSourceLoginState = | { state: 'waiting' } | { state: 'scanned' } | { state: 'confirmed' } | { state: 'expired'; failure?: FoliumSourceLoginFailure } | { state: 'error'; message?: string; failure?: FoliumSourceLoginFailure; transient?: boolean }
```

相关：[FoliumSourceLoginFailure](#foliumsourceloginfailure)

### FoliumSourceLoginStep

Folium 2: a step of a sign-in, as `describeLoginFailure` is told it.

```ts
type FoliumSourceLoginStep = 'start' | 'open' | 'wait' | 'check' | 'account' | 'form'
```

### FoliumSourceLoginMethod

Folium 2: one way to sign in (`auth@1.getLoginMethods`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Handed back to `startLogin`. |
| `label` | `FoliumText` | Its name. |
| `icon?` | `string` | A picture in the mod's folder (`assets/login.svg`) or an https or data URL. |
| `note?` | `FoliumText` | A line on what it is. |
| `preferred?` | `boolean` | The one chosen at first. |

相关：[FoliumText](#foliumtext)

### FoliumSourceLoginTexts

Folium 2: the sign-in window's own words for a source.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `FoliumText` | The title. |
| `note` | `FoliumText` | The line under it. |
| `caseNotes?` | `Partial<Record<FoliumSourceLoginCase, FoliumText>>` | A line a failure case has on this source only. |

相关：[FoliumText](#foliumtext) · [FoliumSourceLoginCase](#foliumsourcelogincase)

### FoliumSourceLoginForm

Folium 2: a form to sign in with (accounts with a password).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `fields` | `Array<{ key: string; type: 'text' \| 'password' \| 'url'; label?: FoliumText; placeholder?: FoliumText; required?: boolean }>` | The fields, in order. |
| `submitLabel?` | `FoliumText` | The button. |
| `note?` | `FoliumText` | A line under the form. |
| `errors?` | `Record<string, FoliumText>` | What a failure shows, by error code (`network`, `auth-required`, …). |

相关：[FoliumText](#foliumtext)

### FoliumSourceLocalService

Folium 2: a local service the sign-in needs, which the sign-in window can restart.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `subscribe()` | `(listener: () => void): FoliumDisposer` | Calls `listener` on every change; returns what stops it. |
| `getStatus()` | `(): { failed: boolean; error: string \| null; restarting: boolean }` | Its state; the same object between two changes. |
| `restart()` | `(): Promise<boolean>` | Restarts it; resolves true when it runs again. |

相关：[FoliumDisposer](#foliumdisposer)

### FoliumSourceSetupStep

Folium 2: a step of a source's setup list (`auth@1.getSetup`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Its id. |
| `title` | `FoliumText` | What it is. |
| `note?` | `FoliumText` | A line on it. |
| `state` | `'done' \| 'todo' \| 'warn' \| 'error'` | Where it stands. |
| `detail?` | `string` | A fact shown as it is (a path, a version). |
| `secret?` | `{ label: FoliumText; saved: boolean }` | A password box; `saved`: one is stored. |
| `actions?` | `Array<{ id: string; label: FoliumText; kind: 'link' \| 'run' \| 'pick-file' \| 'submit-secret'; primary?: boolean }>` | What can be done. |

相关：[FoliumText](#foliumtext)

### FoliumSourceSetupView

Folium 2: what a user has to do before a source works (a program to install, a key to fill in).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `FoliumText` | The title. |
| `note?` | `FoliumText` | A line under it. |
| `steps` | `FoliumSourceSetupStep[]` | The steps. |
| `complete` | `boolean` | Every step is done. |
| `message?` | `{ text: FoliumText; tone: 'ok' \| 'warn' \| 'error' }` | What the source says to the action just done. |

相关：[FoliumText](#foliumtext) · [FoliumSourceSetupStep](#foliumsourcesetupstep)

### FoliumSourceDiagnosticLine

Folium 2: a line of a sign-in diagnostic report. The host cleans it; nothing private.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | What it is. |
| `value` | `string \| number \| boolean \| null` | Its value. |

### FoliumSourceSelfCheck

Folium 2: what a source's self-check found (`auth@1.runLoginSelfCheck`), as JSON the host reports.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `runtime` | `'electron' \| 'web'` | `electron` or `web`. |
| `startedAt` | `number` | When it started, milliseconds since the epoch. |
| `durationMs` | `number` | How long it took. |
| `backend` | `FoliumJsonValue` | The source's backend, where it has one. |
| `proxy` | `FoliumJsonValue` | The proxy it found. |
| `hosts` | `FoliumJsonValue[]` | The hosts it checked. |
| `credentialStore?` | `FoliumJsonValue` | The credential store, where its sign-in needs one. |
| `keepsSignInEncrypted?` | `boolean` | The sign-in is kept encrypted. |

相关：[FoliumJsonValue](#foliumjsonvalue)

### FoliumSourceKeptAccount

Folium 2: what an older build kept of the account (`auth@1.oldKeptAccount`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `user` | `FoliumSourceUser` | The account. |
| `collections` | `FoliumSourceCollection[]` | Its lists. |
| `likedSongIds` | `string[]` | Its liked songs. |

相关：[FoliumSourceUser](#foliumsourceuser) · [FoliumSourceCollection](#foliumsourcecollection)

### FoliumSourceAuth

Folium 2: `auth@1`. Every member but the first two is optional.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getLoginStatus()` | `(): Promise<FoliumSourceUser \| null>` | Who is signed in; null for nobody. |
| `logout()` | `(): Promise<void>` | Signs out. The host stops showing the account as soon as this is called. |
| `signInRanOut?()` | `(): void \| Promise<void>` | The source names nobody, or refuses the sign-in: drop what is kept of it. |
| `readonly showsKeptAccountAtStart?` | `boolean` | The kept account shows at once at start while the source is asked. |
| `oldKeptAccount?()` | `(): Promise<FoliumSourceKeptAccount \| null>` | What an older build kept of the account, where no snapshot is there; null for nothing. |
| `forgetOldKeptAccount?()` | `(): Promise<void>` | That has been saved as the snapshot: remove the old copies. Never rejects. |
| `getLoginTexts?()` | `(): FoliumSourceLoginTexts` | The sign-in window's words. Synchronous. |
| `readonly localService?` | `FoliumSourceLocalService` | A local service the sign-in needs. |
| `getLoginMethods?()` | `(): FoliumSourceLoginMethod[]` | The ways to sign in, where there are several. Synchronous. |
| `resolveLoginMethods?()` | `(): Promise<FoliumSourceLoginMethod[]>` | The same, where finding them out takes a request. |
| `startLogin?()` | `(methodId?: string): Promise<string>` | Starts a sign-in; resolves to its key. |
| `getLoginForm?()` | `(): FoliumSourceLoginForm` | A form to sign in with, instead of a code. Synchronous. |
| `submitLoginForm?()` | `(values: Record<string, string>): Promise<unknown>` | Signs in with the form's values. |
| `describeLoginFailure?()` | `(step: FoliumSourceLoginStep, error: unknown): FoliumSourceLoginFailure \| null` | The source's reading of a failed step; null to leave it to the host. Never throws. |
| `createQr?()` | `(key: string): Promise<string>` | The picture of a sign-in code (a URL or a data URL). |
| `openLoginPage?()` | `(key: string): Promise<void>` | Opens the sign-in page in the browser, instead of a code. |
| `opensLoginPageItself?()` | `(key: string): boolean` | The source opened that page itself and cannot open it again. Synchronous. |
| `checkLogin?()` | `(key: string): Promise<FoliumSourceLoginState>` | Where the sign-in stands. |
| `cancelLogin?()` | `(key: string): Promise<void>` | Drops the sign-in of `key`; any key, known or not. |
| `getLoginTtlMs?()` | `(): number` | How long a sign-in stays open, milliseconds. Synchronous. |
| `getLoginDiagnostics?()` | `(): Promise<FoliumSourceDiagnosticLine[]>` | Lines for the diagnostic report of a failed sign-in. |
| `canRunLoginSelfCheck?()` | `(): boolean` | Whether a self-check can run now. Synchronous. |
| `runLoginSelfCheck?()` | `(): Promise<FoliumSourceSelfCheck \| null>` | Checks the source's network path. |
| `checkAfterLogin?()` | `(methodId: string \| null): Promise<FoliumSourceSetupView \| null>` | After the sign-in: whether the account can be used, as a setup list; null for nothing to do. |
| `getSetup?()` | `(): Promise<FoliumSourceSetupView \| null>` | The source's setup list now; null for nothing to set up. |
| `runSetupAction?()` | `(stepId: string, actionId: string, value?: string): Promise<FoliumSourceSetupView>` | Does one action of the list; resolves to the list after it. Failures go in the list, not a rejection. |

相关：[FoliumSourceUser](#foliumsourceuser) · [FoliumSourceKeptAccount](#foliumsourcekeptaccount) · [FoliumSourceLoginTexts](#foliumsourcelogintexts) · [FoliumSourceLocalService](#foliumsourcelocalservice) · [FoliumSourceLoginMethod](#foliumsourceloginmethod) · [FoliumSourceLoginForm](#foliumsourceloginform) · [FoliumSourceLoginStep](#foliumsourceloginstep) · [FoliumSourceLoginFailure](#foliumsourceloginfailure) · [FoliumSourceLoginState](#foliumsourceloginstate) · [FoliumSourceDiagnosticLine](#foliumsourcediagnosticline) · [FoliumSourceSelfCheck](#foliumsourceselfcheck) · [FoliumSourceSetupView](#foliumsourcesetupview)

### FoliumSourceLibrary

Folium 2: `library@1`, the signed-in account's lists. `userId` is the signed-in account's.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getSongLikeId?()` | `(song: FoliumSourceSong): string` | One id a song is liked under, where the source's ids of one song differ. Synchronous. |
| `getUserPlaylists()` | `(userId: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>` | The account's playlists. |
| `getLikedSongIds?()` | `(userId: string): Promise<{ ids: string[]; whole: boolean }>` | Every liked song's id; `whole` false where it cannot be sure it read to the end. |
| `getLikedSongCount?()` | `(userId: string): Promise<number \| null>` | How many songs the liked list holds, as the source counts; null where it does not say. |
| `areSongsLiked?()` | `(ids: string[]): Promise<Record<string, boolean>>` | Whether each song is liked, by id; one the source says nothing of is left out. |
| `getUserAlbums?()` | `(userId: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>` | The account's saved albums. |
| `getCloudCollection?()` | `(user?: FoliumSourceUser): Promise<FoliumSourceCollection \| null>` | The entry of the account's cloud songs (`type: 'cloud'`); null where it has none. |
| `getListeningRankCollections?()` | `(user: FoliumSourceUser): Promise<FoliumSourceCollection[]>` | The entries of the account's listening ranking (`type: 'listening_rank'`), one a span. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourcePage](#foliumsourcepage) · [FoliumSourceCollection](#foliumsourcecollection) · [FoliumSourceUser](#foliumsourceuser)

### FoliumSourceCatalog

Folium 2: `catalog@1`. `collection` is the entry as the host has it, where it has one.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `canResolveSongCatalogRefs?()` | `(song: FoliumSourceSong): boolean` | Whether `resolveSongCatalogRefs` can fill in where `song`'s album and artists open. Synchronous. |
| `resolveSongCatalogRefs?()` | `(song: FoliumSourceSong): Promise<FoliumSourceSong>` | `song` with its album's and artists' ids filled in. |
| `getPlaylistTracks?()` | `(id: string, limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>` | A playlist's songs. |
| `getPlaylistDetail?()` | `(id: string, collection?: FoliumSourceCollection): Promise<FoliumSourceCollection \| null>` | A playlist's details. |
| `getCloudTracks?()` | `(limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>` | The cloud songs. |
| `getListeningRankTracks?()` | `(range: 'week' \| 'all', limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>` | The ranking's songs, each with `row.listenCount` where the source gives one. |
| `getAlbumTracks?()` | `(id: string, limit?: number, offset?: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>` | An album's songs. |
| `getAlbumDetail?()` | `(id: string, collection?: FoliumSourceCollection): Promise<FoliumSourceCollection \| null>` | An album's details. |
| `getArtistSongs?()` | `(id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>>` | An artist's songs. |
| `getArtistAlbums?()` | `(id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>` | An artist's albums. |
| `getArtistDetail?()` | `(id: string): Promise<FoliumSourceCollection \| null>` | An artist's details. |
| `getSubscriptionStatus?()` | `(type: 'playlist' \| 'album', id: string, collection?: FoliumSourceCollection): Promise<boolean>` | Whether the account saved this playlist or album. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourceCollection](#foliumsourcecollection) · [FoliumSourcePage](#foliumsourcepage)

### FoliumSourceFmCatalog

Folium 2: the modes and scenes a personal FM offers (`recommendations@1.getPersonalFmCatalog`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `name?` | `FoliumText` | The radio's own name, for an extra radio. |
| `modes` | `Array<{ id: FoliumSourceFmLaunch['mode']; label: FoliumText; keywords?: string[] }>` | The modes. |
| `scenes` | `Array<{ id: string; category: string; label: FoliumText; keywords?: string[] }>` | The scenes of `SCENE_RCMD`. |
| `categories` | `Array<{ id: string; label: FoliumText }>` | The scene categories. |

相关：[FoliumText](#foliumtext) · [FoliumSourceFmLaunch](#foliumsourcefmlaunch)

### FoliumSourcePreference

Folium 2: one recommendation preference: a choice among options, or a number on a scale.

```ts
type FoliumSourcePreference = | { kind: 'choice'; key: string; label: FoliumText; options: Array<{ value: string; label: FoliumText }>; value: string; defaultValue: string } | { kind: 'ratio'; key: string; label: FoliumText; min: number; max: number; defaultValue: number; snapWithin?: number; value: number }
```

相关：[FoliumText](#foliumtext)

### FoliumSourcePreferences

Folium 2: the account's recommendation preferences.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `FoliumSourcePreference[]` | The preferences; a kind the host does not know is passed over. |
| `note?` | `FoliumText` | A line on what they reach. |

相关：[FoliumSourcePreference](#foliumsourcepreference) · [FoliumText](#foliumtext)

### FoliumSourceRecommendations

Folium 2: `recommendations@1`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly personalFmModes?` | `boolean` | The personal FM takes a mode and a scene (`getPersonalFm`'s options). |
| `getPersonalFmCatalog?()` | `(station?: string): Promise<FoliumSourceFmCatalog>` | The modes of the personal FM, or of the extra radio `station`. |
| `getDailySongs?()` | `(refresh?: boolean): Promise<FoliumSourceSong[]>` | Today's songs. |
| `getPersonalFm?()` | `(options?: { mode?: string; submode?: string \| null; station?: string \| null }): Promise<FoliumSourceSong[]>` | The next songs of the personal FM. |
| `getRecommendedCollections?()` | `(limit: number): Promise<FoliumSourceCollection[]>` | Lists it recommends. |
| `getHistoryEntries?()` | `(): Promise<Array<{ id: string; label: string; data?: Record<string, FoliumJsonValue> }>>` | The days of earlier recommendations, as entries. |
| `getHistoryDates?()` | `(): Promise<string[]>` | The days of earlier recommendations. |
| `getHistorySongs?()` | `(entry: { id: string; label: string; data?: Record<string, FoliumJsonValue> } \| string): Promise<FoliumSourceSong[]>` | The songs of one earlier day. |
| `dislikeSong?()` | `(id: string): Promise<{ replacement?: FoliumSourceSong; limitReached?: boolean; removed?: boolean }>` | Takes a song out of the recommendations; `removed`: with no replacement. |
| `getDailyStyleGroups?()` | `(): Promise<Array<{ id: string; name: string; tags: Array<{ id: string; name: string }> }>>` | The style groups today's songs can be narrowed to. |
| `getDailyStyleSongs?()` | `(): Promise<{ songs: FoliumSourceSong[]; selection: { groupId: string; tagIds: string[] } \| null }>` | Today's songs of the picked styles. |
| `setDailyStyle?()` | `(selection: { groupId: string; tagIds: string[] }): Promise<void>` | Picks styles. |
| `readonly preferenceEntries?` | `readonly ('explore' \| 'personal-fm' \| 'daily')[]` | Where the host offers the preferences. |
| `getRecommendationPreferences?()` | `(): Promise<FoliumSourcePreferences>` | The preferences. |
| `saveRecommendationPreferences?()` | `(changes: Record<string, string \| number>): Promise<{ confirmed: boolean }>` | Saves what changed; `confirmed` false when it read back something else. |

相关：[FoliumSourceFmCatalog](#foliumsourcefmcatalog) · [FoliumSourceSong](#foliumsourcesong) · [FoliumSourceCollection](#foliumsourcecollection) · [FoliumJsonValue](#foliumjsonvalue) · [FoliumSourcePreferences](#foliumsourcepreferences)

### FoliumSourceExploreItem

Folium 2: one entry of a recommendation page.

```ts
type FoliumSourceExploreItem = | { kind: 'song'; song: FoliumSourceSong; wideCoverUrl?: string; subtitle?: string } | { kind: 'collection'; collection: FoliumSourceCollection; wideCoverUrl?: string; isMix?: boolean; subtitle?: string }
```

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourceCollection](#foliumsourcecollection)

### FoliumSourceExploreSection

Folium 2: a section of a recommendation page.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Its id. |
| `title` | `string` | Its heading, in the source's language. |
| `items` | `FoliumSourceExploreItem[]` | Its entries. |
| `moreCursor?` | `string` | Where its further entries are (`getSectionItems`). |
| `changesWithRead?` | `boolean` | Made up anew for every read. |

相关：[FoliumSourceExploreItem](#foliumsourceexploreitem)

### FoliumSourceExplorePage

Folium 2: a recommendation page.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `sections` | `FoliumSourceExploreSection[]` | The sections. |
| `nextCursor?` | `string` | Where its further sections are. |
| `refreshReadsAnew?` | `boolean` | "Refresh" reads the page anew. |

相关：[FoliumSourceExploreSection](#foliumsourceexploresection)

### FoliumSourceExplore

Folium 2: `explore@1`, the source's own recommendation page.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getFeed()` | `(cursor?: string, listened?: FoliumSourceSong[]): Promise<FoliumSourceExplorePage>` | The page, or its further sections from `cursor`; `listened` are songs of the source played here. |
| `getSectionItems?()` | `(cursor: string): Promise<{ items: FoliumSourceExploreItem[]; moreCursor?: string }>` | A section's further entries. |
| `songsShownAs?()` | `(songs: FoliumSourceSong[]): Promise<Record<string, FoliumSourceSong \| null>>` | Of songs played here, which song the source shows each as, by id; null for itself. |

相关：[FoliumSourceSong](#foliumsourcesong) · [FoliumSourceExplorePage](#foliumsourceexplorepage) · [FoliumSourceExploreItem](#foliumsourceexploreitem)

### FoliumSourceMutations

Folium 2: `mutations@1`. A song or a list is given as the DTO, or as its id alone.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `canAddToPlaylist?()` | `(playlist: FoliumSourceCollection): boolean` | Whether songs can be added to `playlist`. Synchronous. |
| `canEditPlaylistTracks?()` | `(playlist: FoliumSourceCollection): boolean` | Whether `playlist`'s songs can be edited. Synchronous. |
| `likeSong?()` | `(song: string \| FoliumSourceSong, liked: boolean): Promise<void>` | Likes or unlikes a song. |
| `updatePlaylistTracks?()` | `(operation: 'add' \| 'del', playlist: string \| FoliumSourceCollection, tracks: Array<string \| FoliumSourceSong>): Promise<void>` | Adds songs to a playlist, or removes them. |
| `createPlaylist?()` | `(name: string): Promise<FoliumSourceCollection>` | Makes an empty playlist. |
| `canSubscribe?()` | `(collection: FoliumSourceCollection): boolean` | Whether `collection` can be saved. Synchronous. |
| `subscribePlaylist?()` | `(playlist: string \| FoliumSourceCollection, subscribed: boolean): Promise<void>` | Saves or drops a playlist. |
| `subscribeAlbum?()` | `(id: string, subscribed: boolean): Promise<void>` | Saves or drops an album. |

相关：[FoliumSourceCollection](#foliumsourcecollection) · [FoliumSourceSong](#foliumsourcesong)

### FoliumSourceCovers

Folium 2: `covers@1`, how a source's cover pictures are asked for a size. Each member is synchronous and
runs while covers are drawn: answer null at once for a URL that is not the source's. `url` is shared
with the other rules: change it only when you answer.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly hosts` | `readonly string[]` | The hosts of the picture URLs this source knows: a host name (`img1.example.com`), or `*.` before a domain for every host under it (`*.example.com`; not `example.com` itself). The host asks the members below only about URLs on these hosts, and hands each call a URL of its own to change. A rule asked about every picture (another source's, a media server's, a local one) is the host's alone. |
| `sized()` | `(url: URL, size: number): string \| null` | The `size`-pixel variant of `url`. |
| `identity()` | `(url: URL): string \| null` | What names the picture apart from how it is fetched; two URLs of one picture give one value. |
| `original?()` | `(url: URL): string \| null` | The original picture. |
| `requestedSize?()` | `(url: URL): number \| null \| undefined` | The size `url` asks for; null where it asks for none, undefined where it is not the source's. |

### FoliumSourceRawEndpoint

Folium 2: a row of a source's endpoint table (`raw@1`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `access` | `'read' \| 'write' \| 'denied'` | `read`, `write` (changes the account), or `denied`. |
| `omni?` | `string` | The omni method that already does it. |
| `selfParam?` | `string` | The parameter that names the signed-in user; the host fills it in. |

### FoliumSourceRaw

Folium 2: `raw@1`, the source's own backend endpoints for `platform.raw`. The host checks the caller's
permissions against the table and strips credentials from the answer; the source adds its session.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly backend` | `{ name: string; version: string }` | The backend library, name and version. |
| `readonly reservedParams` | `readonly string[]` | Parameters the host sets and callers cannot. |
| `readonly credentialFields?` | `readonly string[]` | The source's own credential field names, stripped from answers. |
| `describeEndpoint()` | `(endpoint: string): FoliumSourceRawEndpoint \| null` | The row of `endpoint`; null for one not in the table. |
| `checkParams?()` | `(endpoint: string, params: Record<string, FoliumJsonValue>): string \| null` | A problem with the values; null for none. |
| `request()` | `(endpoint: string, params: Record<string, FoliumJsonValue>, signal: AbortSignal): Promise<unknown>` | The raw answer. Stops when `signal` aborts. |

相关：[FoliumSourceRawEndpoint](#foliumsourcerawendpoint) · [FoliumJsonValue](#foliumjsonvalue)

## 实验接口

需要在 `mod.json` 的 `experimental` 里选用，经 `folium.experimental[name]` 访问；任何 minor 版本都可能变化。

### FoliumLayoutRect

EXPERIMENTAL (`player.layout`): a rectangle in viewport CSS pixels.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly left` | `number` | Left edge. |
| `readonly top` | `number` | Top edge. |
| `readonly width` | `number` | Width. |
| `readonly height` | `number` | Height. |

### FoliumPlayerObstacle

EXPERIMENTAL (`player.layout`): a native control or its interactive reveal region; no internal ids.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly role` | `'navigation' \| 'window' \| 'playback' \| 'now-playing' \| 'panel' \| 'notification' \| (string & {})` | Coarse purpose; future hosts may add roles. |
| `readonly kind` | `'control' \| 'reveal-area'` | Hidden controls still reserve the pointer region that reveals them. |
| `readonly rect` | `FoliumLayoutRect` | Occupied rectangle. |

相关：[FoliumLayoutRect](#foliumlayoutrect)

### FoliumPlayerLayout

EXPERIMENTAL (`player.layout`): immutable snapshot; identity is stable until geometry changes.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly bounds` | `FoliumLayoutRect` | Live-player bounds in viewport CSS pixels. |
| `readonly insets` | `Readonly<{ top: number; right: number; bottom: number; left: number }>` | Four safe edge distances in CSS pixels, relative to bounds. |
| `readonly obstacles` | `readonly FoliumPlayerObstacle[]` | Regions to avoid; not guaranteed complete. Count, order and roles are not compatibility promises; native ids stay private. |

相关：[FoliumLayoutRect](#foliumlayoutrect) · [FoliumPlayerObstacle](#foliumplayerobstacle)

### FoliumRemoteActionDef

EXPERIMENTAL (`remote.actions`). Append-only buttons; native remote controls stay unchanged.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local action id; the host adds the owning mod and registration prefix. |
| `label` | `FoliumLabel` | Localized button label and accessible name. |
| `icon` | `string` | Lucide icon name in kebab-case. |
| `disabled?` | `boolean` | Prevents invocation while true. |
| `pressed?` | `boolean` | Toggle state exposed through aria-pressed. |
| `count?` | `number` | Optional nonnegative finite count. |
| `tone?` | `'normal' \| 'alert'` | Host-defined visual emphasis. |
| `scope?` | `'track' \| 'session'` | `track` (default) expires when the displayed song changes; `session` survives a song change. |
| `run()` | `(): void \| Promise<void>` | Runs in the main window through the host's remote bridge. |

相关：[FoliumLabel](#foliumlabel)

### FoliumRemoteActionsContext

EXPERIMENTAL (`remote.actions`). Current playback context for additional buttons.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly song` | `FoliumSong \| null` | Currently displayed song, or null when no song is displayed. |
| `readonly state` | `FoliumPlaybackState` | Playback state of the displayed song. |

相关：[FoliumSong](#foliumsong) · [FoliumPlaybackState](#foliumplaybackstate)

### FoliumRemoteActionsDef

EXPERIMENTAL (`remote.actions`). A group of buttons appended after native remote controls.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local registration id; the host adds the owning mod prefix. |
| `order?` | `number` | Order among mod groups only; native buttons cannot be reordered. |
| `actions()` | `(context: FoliumRemoteActionsContext): readonly FoliumRemoteActionDef[]` | Buttons for the current context. The per-mod limit is not yet finalized. |

相关：[FoliumRemoteActionsContext](#foliumremoteactionscontext) · [FoliumRemoteActionDef](#foliumremoteactiondef)

### FoliumRemoteActionsHandle

EXPERIMENTAL (`remote.actions`). Owns one additional remote-button registration.

```ts
interface FoliumRemoteActionsHandle extends FoliumRegistryHandle
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `invalidate()` | `(): void` | Re-evaluates actions and refreshes the remote window without changing native buttons. |
| `readonly id` | `FoliumId` | 继承自 [FoliumRegistryHandle](#foliumregistryhandle)。Full namespaced id (`modid:name`). |
| `unregister()` | `(): void` | 继承自 [FoliumRegistryHandle](#foliumregistryhandle)。Removes the entry now (the host also removes it when the mod stops). |

相关：[FoliumRegistryHandle](#foliumregistryhandle)

### FoliumProviderSong

EXPERIMENTAL (`omni.providers`): a song as a mod provider describes it.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Song id within this provider. |
| `title` | `string` | Song title. |
| `artists` | `string[]` | Artist names. |
| `album?` | `string` | Album name. |
| `coverUrl?` | `string` | Cover image URL. |
| `durationMs?` | `number` | Duration in milliseconds. |

### FoliumAudioQuality

Audio quality levels an Omni provider may be asked for.

```ts
type FoliumAudioQuality = 'standard' | 'high' | 'lossless' | 'hires'
```

### FoliumOmniProviderDef

EXPERIMENTAL (`omni.providers`): an online music source. The host adapts it
to its provider contract; songs from it play, queue and show lyrics like any
online song. Use folium.net.fetch for network access.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Local provider id. |
| `displayName` | `string` | Full name: the second line of the source's row in the home provider switcher. |
| `shortName?` | `string` | Short name: the switcher row, the search overlay's source chip and the home placeholder title; its first character is the avatar badge. Defaults to `displayName`. |
| `search?()` | `(query: string, page: { limit: number; offset: number }): Promise<{ items: FoliumProviderSong[]; hasMore: boolean; total?: number }>` | Search songs; `page` is offset-based. |
| `getSong?()` | `(id: string): Promise<FoliumProviderSong \| null>` | One song by id. |
| `getAudioUrl?()` | `(song: FoliumProviderSong, quality: FoliumAudioQuality): Promise<{ url: string; expiresAt?: number } \| null>` | A playable URL for the song at a quality. |
| `getLyrics?()` | `(song: FoliumProviderSong): Promise<FoliumLyricsResult \| FoliumLegacyLyricsResult \| null>` | Lyrics for a song, as raw text the host parses (FoliumLyricsResult), or the deprecated Folium 1.3 plain-LRC shape. Null when there are none. |

相关：[FoliumProviderSong](#foliumprovidersong) · [FoliumAudioQuality](#foliumaudioquality) · [FoliumLyricsResult](#foliumlyricsresult) · [FoliumLegacyLyricsResult](#foliumlegacylyricsresult)

### FoliumJsonValue

Folium 1.7: a JSON value, as `platform.raw` request parameters take them.

```ts
type FoliumJsonValue = string | number | boolean | null | FoliumJsonValue[] | { [key: string]: FoliumJsonValue }
```

### FoliumPlatformBackend

Folium 1.7: EXPERIMENTAL (`platform.raw`): the backend library the host pins for a platform.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly name` | `string` | The library's package name. |
| `readonly version` | `string` | Its version, as the host pins it; raw answers follow it. |

### FoliumPlatformDescription

Folium 1.7: EXPERIMENTAL (`platform.raw`): what `describe` says of one platform.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly supported` | `boolean` | Whether the platform's endpoints can be called through `request`. |
| `readonly backend?` | `FoliumPlatformBackend` | The pinned backend library; only when supported. |

相关：[FoliumPlatformBackend](#foliumplatformbackend)

### FoliumPlatformResponse

Folium 1.7: EXPERIMENTAL (`platform.raw`): what `request` resolves to.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly body` | `unknown` | The platform's own JSON answer, credential fields (cookies, tokens) taken out at any depth. |
| `readonly accountKey` | `string \| null` | The `accountKey` of the account the request was made as (`folium.account`); null when nobody is signed in. |

### FoliumPlatformErrorCode

Folium 1.7: EXPERIMENTAL (`platform.raw`): why a `request` failed, as the rejection's `code` (and its
message). `permission-denied:<permission>`: mod.json lacks `platform.<id>.read` (or, for an endpoint
that changes the account, `platform.<id>.write`). `endpoint-denied`: the platform's table of endpoints
does not open this one (sign-in, session and credential endpoints never are, and neither is any endpoint
the table does not list). `unsupported`: the platform has no raw endpoints in this host.
`not-signed-in` / `session-expired`: the endpoint needs a signed-in account and there is none, or its
session ran out. `vip-required`: the platform answers that only paying accounts may. `rate-limited`:
too many requests, from this mod (currently 120 a minute per mod, shared with `folium.omni`; past 8 at a
time a request waits for one of them to finish instead of failing) or as the platform says.
`network`: the platform could not be reached or did not answer in time. `account-changed`: the account
signed out or changed while the request was under way, so the answer was dropped. `aborted`: the
request's `signal` aborted, or the mod stopped (a request still under way then is aborted by the host).

```ts
type FoliumPlatformErrorCode = | `permission-denied:${string}` | 'endpoint-denied' | 'unsupported' | 'not-signed-in' | 'session-expired' | 'vip-required' | 'rate-limited' | 'network' | 'account-changed' | 'aborted'
```

### FoliumPlatformService

Folium 1.7: EXPERIMENTAL (manifest `experimental: ["platform.raw"]`), as
`folium.experimental['platform.raw']`; main window only. A fallback for what Omni does not offer yet:
it calls a platform's own backend endpoints as the account signed in to Folia, for capabilities only
that platform has (listening records, say). Where Omni offers the same, use Omni: the host says so in
the developer log, and where `folium.omni` offers the same, use it. Answers are the platform's raw JSON
and follow the backend library the host pins (`describe`), so they can change with any Folia release;
nothing about them is promised.

The host never hands out the session: the request goes through Omni and the platform's adapter, which
add it, and credential fields are taken out of the answer. Parameters the backend reads as options of the
request (the session, a proxy, the source IP and the like) are set by the host alone. Platform ids are
Omni provider ids; only a platform `describe` supports takes `platform.<id>.*` permissions.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `describe()` | `(providerId: string): FoliumPlatformDescription` | Whether a platform can be called through `request`, with its backend library's name and version. |
| `request()` | `(providerId: string, endpoint: string, params?: Record<string, FoliumJsonValue>, options?: { signal?: AbortSignal }): Promise<FoliumPlatformResponse>` | Calls one endpoint of the platform: `endpoint` is the pinned backend's own name for it (a module name such as `user_record`). `params` are the endpoint's parameters; an endpoint about the signed-in user gets that user's id when `params` leaves it out, so a mod never needs it. Reading endpoints need the `platform.<id>.read` permission; endpoints that change the account need `platform.<id>.write` as well. Rejects with an Error whose `code` is a FoliumPlatformErrorCode, and with a TypeError for malformed arguments (`params` must be a plain object of JSON values, its names letters, digits and `_`, at most 16 KB as JSON; a parameter the platform's backend writes into the path of its own request, such as an id, takes only the format the platform's table gives it, digits for ids). |

相关：[FoliumPlatformDescription](#foliumplatformdescription) · [FoliumJsonValue](#foliumjsonvalue) · [FoliumPlatformResponse](#foliumplatformresponse)

## main 入口（Node）

`mod.json` 的 `main` 指向一个 `.cjs` / `.js` 文件，它导出的 `activate(api)`（[FoliumMainModule](#foliummainmodule)）在 Folia 的主进程里运行，参数是 [FoliumMainApi](#foliummainapi)。这一节来自 [`src/mods/folium/mainContract.ts`](../../src/mods/folium/mainContract.ts)。

### FoliumMainModule

The shape of a main entry. The file `main` names exports the function itself:
`module.exports = function activate(api) { ... }`. It may return a function, which runs when the mod
stops, like one given to `api.onDispose`. It may be `async`; a throw, or a promise that rejects, marks
the mod as failed.

```ts
type FoliumMainModule = (api: FoliumMainApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>
```

相关：[FoliumMainApi](#foliummainapi) · [FoliumDisposer](#foliumdisposer)

### FoliumMainApi

The object a main entry's `activate(api)` receives.

The main entry runs in Node with full access: it can `require` any Node module, and `require('electron')`
too. But only `api` is the contract; anything else may change between Folia releases.

A member that needs a permission says so. Called without that permission in mod.json `permissions`, a
synchronous member throws `permission-denied:<permission>`, and an asynchronous one returns a promise that
rejects with that error.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly manifest` | `FoliumManifest` | This mod's mod.json as the host read it (missing fields filled in), frozen. |
| `readonly host` | `FoliumHostInfo` | Host versions; the same as the client entry's `folium.host`. |
| `readonly log` | `FoliumLogger` | Logging; `error` entries show in the mods panel under the mod. |
| `readonly storage` | `FoliumMainStorage` | This mod's data file: the same file the client entry's `folium.storage` reads and writes, so both sides see one state. Needs the `filesystem.data` permission. |
| `readonly secrets` | `FoliumSecretAccess` | Folium 1.7: the values of this mod's `secret` settings fields, the same store the client entry's `folium.secrets` reads and writes. A listener given to `subscribe` stops when the mod stops. |
| `readonly paths` | `FoliumMainPaths` | Folders to write into: this mod's own folder and the user's folders. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | Runs `disposer` when the mod stops: it is turned off, reloaded, or the app quits. Release here what `activate` started: timers, watchers, listeners, child processes. Cleanups run last registered first (the function `activate` returned counts as registered when `activate` returned), and one that throws does not stop the others. After the mod has stopped, `disposer` runs at once. Returns nothing. |
| `readonly runtime` | `FoliumMainRuntime` | What the app is playing. |
| `readonly rpc` | `FoliumMainRpc` | Answers calls from this mod's client entry, and (Folium 1.7) sends it messages. |
| `readonly render` | `FoliumMainRender` | Video export. |

相关：[FoliumManifest](#foliummanifest) · [FoliumHostInfo](#foliumhostinfo) · [FoliumLogger](#foliumlogger) · [FoliumMainStorage](#foliummainstorage) · [FoliumSecretAccess](#foliumsecretaccess) · [FoliumMainPaths](#foliummainpaths) · [FoliumDisposer](#foliumdisposer) · [FoliumMainRuntime](#foliummainruntime) · [FoliumMainRpc](#foliummainrpc) · [FoliumMainRender](#foliummainrender)

### FoliumManifest

A mod's mod.json as the main entry sees it in `api.manifest`: every field there, missing ones filled in.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly folium` | `number` | The Folium major version the mod is written for. |
| `readonly id` | `string` | The mod id. |
| `readonly name` | `string` | The mod's name. |
| `readonly version` | `string` | The mod's version, `MAJOR.MINOR.PATCH`. |
| `readonly author` | `string \| null` | The author, or null. |
| `readonly description` | `string \| null` | The description, or null. |
| `readonly main` | `string \| null` | The main entry's file name, or null. |
| `readonly client` | `string \| null` | The client entry's path in the mod folder, or null. |
| `readonly depends` | `readonly string[]` | The mods this one depends on (`id` or `id@^1.2.3`). |
| `readonly permissions` | `readonly string[]` | The permissions the mod declares. |
| `readonly experimental` | `readonly string[]` | The experimental surfaces the mod opts into. |
| `readonly embedOrigins` | `readonly string[]` | The https origins `folium.ui.embed` may load. |
| `readonly folia` | `string \| null` | The Folia versions the mod needs (e.g. `>=0.7.0 <0.8.0`), or null. |
| `readonly preview` | `string \| null` | The introduction image's path in the mod folder, or null. |
| `readonly sources?` | `readonly Readonly<Record<string, unknown>>[] \| null` | Folium 2: the sources a source mod provides (`id`, `name`, `requires`, …), or null for an ordinary mod. |
| `readonly locales?` | `string \| null` | Folium 2: the folder of the mod's locale files, or null. |
| `readonly assets?` | `string \| null` | Folium 2: the folder of the mod's pictures and other assets, or null. |
| `readonly secrets?` | `readonly string[] \| null` | Folium 2: the secret slots a source mod keeps outside settings fields, or null. |
| `readonly contexts?` | `readonly string[] \| null` | Folium 2: where the client runs (`main`, `export`), or null for everywhere. |
| `readonly native?` | `readonly string[] \| null` | Folium 2: native files of the app a built-in source uses, or null. |

### FoliumMainStorage

`api.storage`: the data file the client entry shares (FoliumStorage, capped at 1 MB), and the directories
for anything larger.

```ts
interface FoliumMainStorage extends FoliumStorage
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly paths` | `FoliumModPaths` | The directories this mod writes its own files to. Always there, permission or not, so `'paths' in api.storage` finds it. |
| `get()` | `<T = unknown>(key: string): Promise<T \| undefined>` | 继承自 [FoliumStorage](#foliumstorage)。The stored value, or undefined. |
| `set()` | `(key: string, value: unknown): Promise<void>` | 继承自 [FoliumStorage](#foliumstorage)。Stores a JSON-serializable value. |
| `has()` | `(key: string): Promise<boolean>` | 继承自 [FoliumStorage](#foliumstorage)。Whether the key exists. |
| `delete()` | `(key: string): Promise<void>` | 继承自 [FoliumStorage](#foliumstorage)。Removes the key. |
| `keys()` | `(): Promise<string[]>` | 继承自 [FoliumStorage](#foliumstorage)。All keys. |

相关：[FoliumStorage](#foliumstorage) · [FoliumModPaths](#foliummodpaths)

### FoliumModPaths

`api.storage.paths`, the directories this mod writes its files to. Needs the `filesystem.data` permission; without
it, reading either path throws `permission-denied:filesystem.data`. Each read creates the directory when it is
missing, and throws the file system's error when it cannot (a file or a dead link standing where the
directory should be; for `cache`, clearing the cache in the mods panel removes that entry). Both getters
are non-enumerable, so serializing or spreading `api` never reads them. Clients get no paths: they have no
file system.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly data` | `string` | Files to keep: `<userData>/mods-data/<id>/files`, beside (not holding) the data file. |
| `readonly cache` | `string` | Files the mod can rebuild: `<userData>/mods-cache/<id>`. The user can empty it from the mods panel at any time, even while the mod runs, so expect files to vanish; the host sets no size limit, so cap it yourself. |

### FoliumMainPaths

`api.paths`: where a main entry writes. Put what the user will look for (an export, a report) under one
of the user's folders; keep the mod's own files under `api.storage.paths`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly documents` | `string` | The user's Documents folder. Reading it throws when the system has no such folder; so do the other three. |
| `readonly downloads` | `string` | The user's Downloads folder. |
| `readonly music` | `string` | The user's Music folder. |
| `readonly videos` | `string` | The user's Videos folder. |

### FoliumMainRuntime

`api.runtime`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `getPlaybackSnapshot()` | `(): FoliumPlaybackSnapshot \| null` | The playback state the app last sent to the main process, or null before it sent one. While playing, `position` is moved on by the time since. Needs the `playback.read` permission. |

相关：[FoliumPlaybackSnapshot](#foliumplaybacksnapshot)

### FoliumMainRpc

`api.rpc`: the main half of `folium.rpc`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `handle()` | `(name: string, handler: (...args: any[]) => unknown): void` | Answers the client entry's `folium.rpc.call(name, ...args)`: `handler` gets the call's arguments, and what it returns (or what its promise resolves to) is the call's result; a throw rejects the call. Arguments and results cross between processes, so both must be JSON-serializable. `name` must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, and a second handler for the same name throws. |
| `send()` | `(name: string, payload?: unknown): void` | Folium 1.7: sends `payload` to this mod's client entry in the main window, where `folium.rpc.on(name, ...)` receives it; no other mod's client hears it, and the export window never does. Fire-and-forget: nothing is queued, so a message sent while the client is not running (the window rebuilt, the client not activated yet) or while there is no main window is dropped without an error. `payload` must be JSON-serializable, at most 64 KB as JSON text; left out, the client gets `null`. `name` follows the same rule as `handle`. A bad name or payload throws at the call (`rpc-payload-too-large:65536` for one over the limit). Older 1.x hosts lack it: check `api.host.folium.minor >= 7`. |

### FoliumMainRender

`api.render`.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `exportVideo()` | `(spec: FoliumExportSpec): Promise<FoliumExportResult>` | Exports the current song as a video, drawn the way the app shows it now: the lyric animation mode, its settings and tuning, the lyrics and the theme. `spec` holds only output choices. Needs the `render.export` permission, and an ffmpeg Folia can find (the mods panel says whether it found one). Folia shows the progress. The promise resolves when the export ends, whether or not the video was written: read `ok`. |

相关：[FoliumExportSpec](#foliumexportspec) · [FoliumExportResult](#foliumexportresult)

### FoliumExportSpec

Output choices for `api.render.exportVideo`. Every field is optional; numbers are clamped to their range.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `codec?` | `'vp9' \| 'prores'` | `vp9` (default): WebM, about a tenth of the size. `prores`: ProRes 4444 in a MOV, large, opens almost anywhere. |
| `width?` | `number` | Width in pixels, 320 to 3840; default 1920. |
| `height?` | `number` | Height in pixels, 180 to 2160; default 1080. |
| `fps?` | `number` | Frames per second, 10 to 60; default 30. |
| `startSec?` | `number` | Start, seconds into the song; default 0. |
| `endSec?` | `number` | End, seconds into the song. 0, or a time not after `startSec`, means 2 seconds after the lyrics end (and at least 1 second after `startSec`). The video is at most 15 minutes long. |
| `background?` | `'transparent' \| 'theme'` | `transparent` (default): the lyrics on a transparent background; the alpha channel is kept on Windows, and may come out black elsewhere. `theme`: on the song theme's background colour, on every system. |

### FoliumExportResult

What `api.render.exportVideo` resolves to.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `boolean` | True when the video was written. |
| `error?` | `string` | Why not, when `ok` is false: `export-no-lyrics`, `export-invalid-duration`, `export-unsupported-platform`, `export-already-running`, `export-ffmpeg-not-found`, `export-cancelled`, or another `export-…` code. |
| `cancelled?` | `boolean` | The user cancelled the export. |
| `outputPath?` | `string` | The video file, in `Folia Exports` under the user's Videos folder. |
| `frameCount?` | `number` | Frames written. |
| `sizeBytes?` | `number` | The file's size, bytes. |
| `durationSec?` | `number` | The video's length, seconds. |
| `backgroundMode?` | `'none' \| 'theme'` | `none` (a transparent background) or `theme`. |
| `transparent?` | `boolean` | The video has a transparent background. |
| `warnings?` | `string[]` | What may be off in a written video: `export-alpha-unavailable` (this machine captured no alpha channel), `export-alpha-not-guaranteed` (not Windows: the alpha channel may be black). |

## 音源类模组的 main 入口

> **预览**：Folium 2 的音源接口（`folium.sources` 与音源类模组 main 入口的 `api`）还是预览版，九个内置音源全部迁过去之前可能变动；用它写的模组可能要随新版本更新。`folium: 1` 冻结在 Folium 1.9 的接口不受影响。

音源类模组的 main 入口拿到的 `api` 比普通模组多下面这些成员（[FoliumSourceMainApi](#foliumsourcemainapi)，方案 §5.5），也不受普通模组的网络、存储限额约束；普通模组的 `api` 没有它们。

### FoliumSourceMainApi

Folium 2: the main entry's `api` of a source mod (one with `sources` in mod.json, plan §5.5): FoliumMainApi and
the members below, which an ordinary mod's `api` does not have. A source mod also needs no `filesystem.data` for
`api.storage` (16 MB instead of 1 MB) and keeps the secret slots its manifest's `secrets` names (64 KB each).
Everything it registers here goes when the mod stops.

```ts
interface FoliumSourceMainApi extends FoliumMainApi
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly net` | `FoliumSourceNet` | Electron `net`: binary, streamed, no answer cap and no time limit of the host's. |
| `readonly legacy` | `{ readonly store: FoliumSourceLegacyStore }` | A built-in source's old data, by the names its row of the host's trusted table (or its manifest `claims`, when it takes over a source the installation does not carry) lists. Any other key throws `legacy-key-not-claimed:<key>`. |
| `readonly paths` | `FoliumSourceMainPaths` | The paths of FoliumMainApi, and the userData folder a source's row or claims name. |
| `readonly seal` | `FoliumSourceSeal` | Sealing with the system's credential store (Electron safeStorage). |
| `readonly cache` | `FoliumSourceCache` | The source's cache folder, counted in the host's cache budget. |
| `readonly media` | `FoliumSourceMedia` | Cross-origin rules and streams for the source's media. |
| `readonly windows` | `FoliumSourceWindows` | Hidden windows, and whether the main window is there. |
| `readonly shell` | `{ openExternal(url: string): Promise<void> }` | Opens an http(s) address in the system's browser. |
| `readonly dialog` | `{ pickFile(options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }): Promise<string \| null> }` | A file the user picks, or null. |
| `readonly host` | `FoliumSourceHostInfo` | The host's versions, and its UI language now (`zh-CN`, `en`, …). |
| `onBeforeUnload()` | `(handler: () => void \| Promise<void>): FoliumDisposer` | Waited for (3 seconds at most) before the source is unloaded; its songs' playback has stopped by then. |
| `onBeforeQuit()` | `(handler: () => void \| Promise<void>): FoliumDisposer` | Waited for (3 seconds at most) when the app quits. |
| `onPlayersOrphaned()` | `(handler: () => void): FoliumDisposer` | The main window went and no window takes its playback over: pause what plays outside the app. |
| `readonly diagnostics` | `FoliumSourceDiagnostics` | The sign-in diagnostics and self-check of one of the mod's own sources. |
| `readonly native` | `FoliumSourceNative` | Native files the app ships for a built-in source, by the names its manifest `native` and its row both list. |
| `reportError()` | `(error: unknown, where?: string): void` | An error the source could not handle: into the host's crash report, without telling the user. |
| `readonly manifest` | `FoliumManifest` | 继承自 [FoliumMainApi](#foliummainapi)。This mod's mod.json as the host read it (missing fields filled in), frozen. |
| `readonly log` | `FoliumLogger` | 继承自 [FoliumMainApi](#foliummainapi)。Logging; `error` entries show in the mods panel under the mod. |
| `readonly storage` | `FoliumMainStorage` | 继承自 [FoliumMainApi](#foliummainapi)。This mod's data file: the same file the client entry's `folium.storage` reads and writes, so both sides see one state. Needs the `filesystem.data` permission. |
| `readonly secrets` | `FoliumSecretAccess` | 继承自 [FoliumMainApi](#foliummainapi)。Folium 1.7: the values of this mod's `secret` settings fields, the same store the client entry's `folium.secrets` reads and writes. A listener given to `subscribe` stops when the mod stops. |
| `onDispose()` | `(disposer: FoliumDisposer): void` | 继承自 [FoliumMainApi](#foliummainapi)。Runs `disposer` when the mod stops: it is turned off, reloaded, or the app quits. Release here what `activate` started: timers, watchers, listeners, child processes. Cleanups run last registered first (the function `activate` returned counts as registered when `activate` returned), and one that throws does not stop the others. After the mod has stopped, `disposer` runs at once. Returns nothing. |
| `readonly runtime` | `FoliumMainRuntime` | 继承自 [FoliumMainApi](#foliummainapi)。What the app is playing. |
| `readonly rpc` | `FoliumMainRpc` | 继承自 [FoliumMainApi](#foliummainapi)。Answers calls from this mod's client entry, and (Folium 1.7) sends it messages. |
| `readonly render` | `FoliumMainRender` | 继承自 [FoliumMainApi](#foliummainapi)。Video export. |

相关：[FoliumMainApi](#foliummainapi) · [FoliumSourceNet](#foliumsourcenet) · [FoliumSourceLegacyStore](#foliumsourcelegacystore) · [FoliumSourceMainPaths](#foliumsourcemainpaths) · [FoliumSourceSeal](#foliumsourceseal) · [FoliumSourceCache](#foliumsourcecache) · [FoliumSourceMedia](#foliumsourcemedia) · [FoliumSourceWindows](#foliumsourcewindows) · [FoliumSourceHostInfo](#foliumsourcehostinfo) · [FoliumDisposer](#foliumdisposer) · [FoliumSourceDiagnostics](#foliumsourcediagnostics) · [FoliumSourceNative](#foliumsourcenative)

### FoliumSourceHostInfo

Folium 2: `api.host` of a source mod.

```ts
interface FoliumSourceHostInfo extends FoliumHostInfo
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly locale` | `string` | The host's UI language now. |
| `folium` | `{ major: number; minor: number }` | 继承自 [FoliumHostInfo](#foliumhostinfo)。The Folium version (`major`, `minor`). |
| `folia` | `string \| null` | 继承自 [FoliumHostInfo](#foliumhostinfo)。Folia app version, or null when the host cannot tell. |

相关：[FoliumHostInfo](#foliumhostinfo)

### FoliumSourceMainPaths

Folium 2: `api.paths` of a source mod.

```ts
interface FoliumSourceMainPaths extends FoliumMainPaths
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `legacy()` | `(name: string): string` | `<userData>/<name>`, for a folder the source's row or claims name; any other throws `legacy-folder-not-claimed:<name>`. |
| `readonly documents` | `string` | 继承自 [FoliumMainPaths](#foliummainpaths)。The user's Documents folder. Reading it throws when the system has no such folder; so do the other three. |
| `readonly downloads` | `string` | 继承自 [FoliumMainPaths](#foliummainpaths)。The user's Downloads folder. |
| `readonly music` | `string` | 继承自 [FoliumMainPaths](#foliummainpaths)。The user's Music folder. |
| `readonly videos` | `string` | 继承自 [FoliumMainPaths](#foliummainpaths)。The user's Videos folder. |

相关：[FoliumMainPaths](#foliummainpaths)

### FoliumSourceDiagnostics

Folium 2: `api.diagnostics` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `register()` | `(sourceId: string, backend: { getDiagnostics(): unknown; getStatus?(): unknown; selfCheckHosts?: readonly string[] }): FoliumDisposer` | `backend` has `getDiagnostics()`, and may have `getStatus()` and `selfCheckHosts`; `sourceId` is one of the mod's sources, as the host knows it. Returns what takes it out. |

相关：[FoliumDisposer](#foliumdisposer)

### FoliumSourceNative

Folium 2: `api.native` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `path()` | `(name: string): string` | The file's path; throws `native-not-granted:<name>` or `native-unavailable:<name>`. |
| `load()` | `(name: string): unknown` | `require` of that path. |

### FoliumSourceNet

Folium 2: `api.net` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `fetch()` | `(url: string, init?: Record<string, unknown>): Promise<Response>` | A web `fetch` through Electron `net`; `init.session` names a partition (see `session`). Answers a web Response. |
| `request()` | `(options: FoliumSourceRequestOptions): FoliumSourceClientRequest` | Electron's `net.request` (a ClientRequest), for a request a web `fetch` cannot make: a GET with a body. `options` is Electron's (`url`, `method`, `redirect`, …); `options.session` names a partition (see `session`). |
| `session()` | `(name: string): FoliumSourceNetSession` | A partition of the source's own (`persist:folium.<mod id>.<name>`), or one its row or claims name: lower case letters, digits and `-`. |
| `resolveProxy()` | `(url: string): Promise<string>` | The system proxy for `url`, as Chromium resolves it. |

相关：[FoliumSourceRequestOptions](#foliumsourcerequestoptions) · [FoliumSourceClientRequest](#foliumsourceclientrequest) · [FoliumSourceNetSession](#foliumsourcenetsession)

### FoliumSourceNetSession

Folium 2: one partition of a source mod (`api.net.session`).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly partition` | `string` | The partition's name. |
| `fetch()` | `(url: string, init?: Record<string, unknown>): Promise<Response>` | `fetch` in this partition. |
| `request()` | `(options: FoliumSourceRequestOptions): FoliumSourceClientRequest` | `request` in this partition. |
| `resolveProxy()` | `(url: string): Promise<string>` | The proxy for `url` in this partition. |
| `setProxy()` | `(config: Record<string, unknown>): Promise<void>` | Electron's `session.setProxy`. |
| `clearStorageData()` | `(options?: Record<string, unknown>): Promise<void>` | Electron's `session.clearStorageData`. |

相关：[FoliumSourceRequestOptions](#foliumsourcerequestoptions) · [FoliumSourceClientRequest](#foliumsourceclientrequest)

### FoliumSourceRequestOptions

Folium 2: what `api.net.request` takes: Electron's `net.request` options.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | An http(s) address. |
| `method?` | `string` | `GET` when left out. |
| `redirect?` | `'follow' \| 'error' \| 'manual'` | `follow` (the default), `error` or `manual`. |
| `session?` | `string` | A partition, named as for `api.net.session`; the default session when left out. |

### FoliumSourceIncomingMessage

Folium 2: the answer of `api.net.request`, Electron's IncomingMessage (the members a source reads).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly statusCode` | `number` | The HTTP status. |
| `readonly headers` | `Record<string, string \| string[]>` | The headers, by lower-case name. |
| `on()` | `(event: 'data', listener: (chunk: Uint8Array) => void): this` | `data` gives the body piece by piece. |
| `on()` | `(event: 'end', listener: () => void): this` | `end` comes after the last piece. |
| `on()` | `(event: 'error' \| 'aborted', listener: (error?: Error) => void): this` | `error` or `aborted` when the body broke off. |

### FoliumSourceClientRequest

Folium 2: `api.net.request`'s request, Electron's ClientRequest (the members a source uses).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `setHeader()` | `(name: string, value: string): void` | Sets a header before the body is written. |
| `write()` | `(chunk: string \| Uint8Array): void` | Writes part of the body. |
| `end()` | `(chunk?: string \| Uint8Array): void` | Sends the request, with the last part of the body. |
| `abort()` | `(): void` | Stops it. |
| `on()` | `(event: 'response', listener: (response: FoliumSourceIncomingMessage) => void): this` | `response` with the answer. |
| `on()` | `(event: 'error', listener: (error: Error) => void): this` | `error` when the request failed. |
| `on()` | `(event: string, listener: (...args: unknown[]) => void): this` | Electron's other events: `redirect`, `login`, `finish`, `abort`, `close`. |

相关：[FoliumSourceIncomingMessage](#foliumsourceincomingmessage)

### FoliumSourceMediaRequest

Folium 2: what a media rule's `test` is asked: one read of a resource, with the answer's headers. Frozen.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `readonly url` | `string` | The address. |
| `readonly method` | `string` | `GET`, `HEAD` or `OPTIONS` (other methods never get the headers). |
| `readonly resourceType` | `string` | Electron's resource type (`media`, `xhr`, `image`, …). |
| `readonly responseHeaders` | `Readonly<Record<string, readonly string[]>>` | The answer's headers, a frozen copy of what Electron hands. |

### FoliumSourceLegacyStore

Folium 2: `api.legacy.store`, the main process's store keys a built-in source keeps its sign-in under.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `get()` | `(key: string): unknown` | The value, or undefined. |
| `set()` | `(key: string, value: unknown): void` | Stores `value`. |
| `has()` | `(key: string): boolean` | Whether the key has a value. |
| `delete()` | `(key: string): void` | Removes the key. |

### FoliumSourceSeal

Folium 2: `api.seal`. `available()` is false where the system keeps no encrypted store (Linux's basic_text).

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `available()` | `(): boolean` | Whether sealing works here. |
| `seal()` | `(text: string): string` | `text` sealed, as base64; throws where sealing does not work. |
| `open()` | `(sealed: string): string` | The text of a sealed base64 string. |

### FoliumSourceCache

Folium 2: `api.cache` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `dir()` | `(): string` | `<userData>/mods-cache/<id>`, made when missing. |
| `requestPrune()` | `(limitBytes?: number): void` | Asks the host to trim the media cache to its budget (or to `limitBytes`). |
| `provideEntries()` | `(provider: FoliumSourceCacheEntries): FoliumDisposer` | Hands the host the source's cache entries, so its cache view lists, removes and clears them. |

相关：[FoliumSourceCacheEntries](#foliumsourcecacheentries) · [FoliumDisposer](#foliumdisposer)

### FoliumSourceCacheEntries

Folium 2: what `api.cache.provideEntries` takes.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `list()` | `(): unknown[] \| Promise<unknown[]>` | The entries. |
| `remove?()` | `(id: string): void \| Promise<void>` | Removes one. |
| `clear?()` | `(): void \| Promise<void>` | Removes all. |

### FoliumSourceMediaRule

Folium 2: a rule of `api.media.allow`: which addresses get cross-origin headers, for how long.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `hosts?` | `string[]` | Host names; a request to one of them is the source's. |
| `urls?` | `string[]` | Whole addresses. |
| `ttlMs?` | `number` | How long an address added stays the rule's, milliseconds. |
| `test?()` | `(request: FoliumSourceMediaRequest): boolean` | What `hosts` cannot say (a path that ends in an audio extension, an answer's content type). It narrows the rule's `hosts`, which it needs: it is asked only for reads on them (never for another source's), and there the host alone lets nothing through. Synchronous; true lets the read through, one that throws counts as false. It runs for every answer from those hosts: keep it quick. `urls` of the same rule pass without it. |
| `followRedirects?` | `boolean` | An address a redirect leads to becomes the rule's too: from one of its `urls`, until that address's own expiry; from one its `test` let through, for `ttlMs` from the redirect. A read let through by `hosts` alone is not followed. |
| `resourceTypes?` | `string[]` | Electron's resource types the rule applies to (`media`, `xhr` and `image` by default). |

相关：[FoliumSourceMediaRequest](#foliumsourcemediarequest)

### FoliumSourceMediaAllowed

Folium 2: what `api.media.allow` returns: it removes the rule, and its `add(url)` makes an address issued later the rule's.

```ts
type FoliumSourceMediaAllowed = FoliumDisposer & { add(url: string): void }
```

相关：[FoliumDisposer](#foliumdisposer)

### FoliumSourceMedia

Folium 2: `api.media` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `allow()` | `(rule: FoliumSourceMediaRule): FoliumSourceMediaAllowed` | Registers `rule`. |
| `parseRange()` | `(header: string \| null \| undefined, size: number): { start: number; end: number } \| 'unsatisfiable' \| null` | One Range header against a size: `{ start, end }`, `'unsatisfiable'`, or null. |
| `serve()` | `(name: string, handler: (request: Request, rest: string) => unknown): FoliumDisposer` | Answers `folia-mod://<mod id>/_media/<name>/…`: `handler` gets the request and answers a web Response, or `{ file }` for the host to serve with Range. `name` is lower case letters, digits and `-`. Returns what stops it. |
| `url()` | `(name: string, rest?: string): string` | `folia-mod://<mod id>/_media/<name>/<rest>`. |

相关：[FoliumSourceMediaRule](#foliumsourcemediarule) · [FoliumSourceMediaAllowed](#foliumsourcemediaallowed) · [FoliumDisposer](#foliumdisposer)

### FoliumSourceWindows

Folium 2: `api.windows` of a source mod.

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `hidden()` | `(options?: Record<string, unknown>): unknown` | A hidden, sandboxed window without the app's preload (a sign-in, a signature sandbox), destroyed when the mod stops; `options.session` names its partition as `api.net.session` does. An Electron BrowserWindow. |
| `mainWindowPresent()` | `(): boolean` | Whether the main window is there. |
| `onMainWindowChanged()` | `(listener: (present: boolean) => void): FoliumDisposer` | Calls `listener` when the main window comes or goes. |

相关：[FoliumDisposer](#foliumdisposer)

## 基础类型

### FOLIUM_VERSION

The Folium version this host implements; mods read it at runtime as `folium.host.folium`.

```ts
const FOLIUM_VERSION = Object.freeze({ major: 2, minor: 0 })
```

### FoliumId

`modid:name`, like a Forge ResourceLocation. The mod id part is added by the host.

```ts
type FoliumId = string
```

### FoliumLabel

Localized text keyed by locale (`zh-CN`, `zh-TW`, `en`, `in`); the host falls back to `en`, then to any entry.

```ts
type FoliumLabel = Record<string, string | undefined>
```

### FoliumDisposer

Undoes a registration, subscription or mount. Safe to call more than once.

```ts
type FoliumDisposer = () => void
```

## 仍可用的旧名字

为 Folium 1.5 写的模组在 Folium 1.x 里照旧能用下面这些名字；模组用到哪一个，设置里这个模组那一行就提醒一次。Folium 2 起它们不再有效。本表由 `src/mods/folium/deprecated/oldNames.ts` 和 `electron/modSystem/deprecated.cjs` 生成，`npm run folium:check` 用同样的表把它们列为提醒。

| 旧名字 | 现在写 | 在哪里 |
| --- | --- | --- |
| `ctx.subscribe` | `ctx.onChange` | client 入口 |
| `ctx.currentTime` | ctx.lyricTime (visualizers, stage layers) or ctx.playbackTime (progress buttons and layers) | client 入口 |
| `ctx.currentTime.on` | ctx.onLyricTime or ctx.onPlaybackTime | client 入口 |
| `ctx.onTime` | ctx.onLyricTime or ctx.onPlaybackTime | client 入口 |
| params (of a settings section handle, of ctx in a settingsPanel) | `settings` | client 入口 |
| `params.subscribe` | `settings.onChange` | client 入口 |
| `folium.registries.controlButtons` | `folium.registries.progressButtons` | client 入口 |
| tunings.register({ params }) | tunings.register({ settings }) | client 入口 |
| `data-folium-kind="control-button"` | `data-folium-kind="progress-button"` | client 入口 |
| `folium.internals` | removed in Folium 2, nothing takes its place | client 入口 |
| getLyrics answering { lrc, translationLrc } | { main: { format: 'lrc', text, translationText } } | client 入口 |
| folium.events.on('<a name that is no event>') | does nothing; Folium 2 throws unknown-event:<name> | client 入口 |
| `api.storage.data` | `api.storage` | main 入口 |
| `api.lifecycle.onDeactivate` | `api.onDispose` | main 入口 |
| `api.experimental` | removed in Folium 2, nothing takes its place | main 入口 |
| activate returning { dispose } | a function returned from activate, or api.onDispose | main 入口 |
| 权限 `runtime.playback` | `playback.read` | mod.json |
| 权限 `ui.stage` | `stageLayers` | mod.json |
| mod.json 不认识的字段 | 只提醒；Folium 2 起是错误，模组不加载 | mod.json |
