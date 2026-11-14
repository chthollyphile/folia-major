# 波点（`bodian`，仅桌面端）

Folia 内置的波点音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节，随平台搬到这里。
构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：库 `bodian-music-api`（仓库 Mintcolour/bodian-music-api），请求签名、扫码、目录、播放、曲库、写入和歌词解码都在包里。
- **版本**：0.1.2，钉死在本目录的 `package.json`（构建核对装着的版本）和根目录 `package.json`（包从仓库根的 `node_modules` 找）。升级时两处一起改。网页版没有波点，Docker 里也没有。
- **怎么用**：main 入口（`main/index.ts`）在主进程里直接调包，不起服务也不开端口，包打进 `index.cjs`；client 经 `folium.rpc` 的 `request` 发操作，main 入口只放行包导出的 `BODIAN_OPERATIONS` 里的操作（`main/bodianApiBridge.cjs`）。桌面接口签名的是「GET 带 JSON 正文」，所以请求走 `api.net.request`（Electron 的 ClientRequest，web fetch 不许 GET 带正文）。会话存在 `main/session.cjs`，经 `api.legacy.store` 沿用迁移前的键（`BODIAN_SESSION_V2`、`BODIAN_DEVICE_ID`），用 `api.seal` 加密；音频和封面的跨域在 `main/mediaCors.cjs`，经 `api.media.allow` 的 `test` 登记。
- **我们改了什么**：不改包。协议上的问题在包的仓库里修好、发新版本，Folia 再升级依赖。
- **上游变了怎么跟**：规则和验收步骤见 [`docs/bodian.md`](../../docs/bodian.md) 的“会话”“验证”两节（版本必须钉死，锁文件只用 npm 上的版本）。测试里 `test/unit/onlineMusic/bodianAlbumPaging.test.ts`、`test/unit/gridView/bodianCollectionPaging.test.ts`、`test/unit/onlineMusic/loginFailurePlatforms.test.ts` 用真的 `createBodianApi`，只把发请求的那一层换成测试里写好的答复：包的接口或翻页规则变了，这几条会失败。`test/unit/electron/bodianApiBridge.test.ts` 管会话、操作白名单和 main 入口的接线。

## 目录

| 位置 | 是什么 |
| --- | --- |
| `mod.json` | 清单：`folium: 2`，音源 `bodian`，四种语言的名字 |
| `client/index.ts` | client 入口：接上请求通道，在第一个 `await` 前 `folium.sources.register` |
| `client/bodianProvider.ts` | 音源定义：每个能力族一组成员（`search@1`、`songs@1`、`playback.audio@1`、`lyrics@1`、`auth@1`、`library@1`、`catalog@1`、`mutations@1`、`recommendations@1`、`covers@1`） |
| `client/bodianTransport.ts` | 经 `folium.rpc` 调 main 入口，包的错误码与原话原样交给宿主 |
| `client/bodianNormalize.ts` | 原始记录 → 公开契约的 DTO |
| `client/bodianCatalog.ts`、`bodianLibrary.ts`、`bodianMutations.ts` | 目录、曲库、红心与歌单增删 |
| `client/bodianLyrics.ts` | 歌词交原始文本轨（LRC、逐字的 awlrc），纯音乐按宿主的规则判 |
| `client/bodianCovers.ts` | 酷我图床的尺寸规则（原宿主 `coverUrl.ts` 的 `kuwo` 一行） |
| `client/bodianFailure.ts` | 包的错误码与原话的意思 |
| `main/index.ts` | main 入口：会话、请求、媒体跨域接到 `api.*` |
| `main/bodianApiBridge.cjs`、`session.cjs`、`mediaCors.cjs` | 原 `electron/bodian/` 的三个文件，原样搬来 |
| `locales/` | 短名和登录窗口的文字；`zh-TW.json` 由构建生成 |
