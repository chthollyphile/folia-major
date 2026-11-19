# 酷狗音乐（`kugou`）

Folia 内置的酷狗音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节，随平台搬到这里。
构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：第三方库 KuGouMusicApi（MakcRe/KuGouMusicApi），包名 `kugoumusicapi`。另有一处直接调酷狗旧的公开手机接口
  `https://m.kugou.com/app/i/getSongInfo.php`，在 `/song/url` 拒绝一个 hash 时用来取播放地址；匿名搜索直接调酷狗安卓客户端的签名搜索
  `http://complexsearch.kugou.com/v2/search/song`（两个请求怎么拼在 `core/kugouRequests.ts`）。
- **版本**：v1.6.0。不是从 npm 装的，是 GitHub 上这个标签的源码包：本目录的 `package.json`、根目录 `package.json` 和
  `deploy/docker/kugou-api/package.json` 都写 `https://github.com/MakcRe/KuGouMusicApi/archive/refs/tags/v1.6.0.tar.gz`
  （构建核对装着的版本；包从仓库根的 `node_modules` 找）。升级时几处一起改，连同各自的锁文件。
- **桌面端怎么用**：包声明成 `asar`（它加载时扫自己的 `module/` 目录逐个 require，要真实的文件布局），构建把它和它的依赖装进
  `deps.<指纹>.asar`。main 入口（`main/index.ts`）第一次请求前设 `process.env.platform = 'lite'`，再从归档加载它，交给
  `main/kugouApiBridge.cjs` 直接调用它的函数，不起本地服务。设备 cookie 和登录态由桥存：`api.legacy.store` 沿用迁移前的存储键
  （`KUGOU_API_SESSION_V2`，旧的明文 `KUGOU_API_SESSION_V1` 写成 V2 后删掉），用 `api.seal` 加密；加密不可用时只在内存里。
  client 经 `folium.rpc` 的 `request` 发操作；匿名搜索和旧播放信息接口也由 main 去问（`anonymousSearch`、`legacyPlayInfo`，main
  自己拼地址，经 `api.net.fetch`）。窗口里只留账号 id 的提示（页面存储 `online_provider:kugou:userid`），凭据不交给窗口。
  酷狗的一个媒体 CDN（`fs.youthandroid2.kugou.com`）证书名不对：清单的 `certificateExceptions` 只放宽它的
  `ERR_CERT_COMMON_NAME_INVALID`；媒体跨域经 `api.media.allow`（`kugou.com` 与 `*.kugou.com`）。
- **网页版怎么用**：网页版不加载模组，`src/services/onlineMusic/web/kugou.ts` 用 `core/` 的 `createSource` 和网页的 transport 自己
  注册（`src/services/onlineMusic/web/foliumWebSource.ts`）：请求发到 `VITE_KUGOU_API_BASE`，会话在页面存储里（和迁移前同一组键），
  匿名搜索、旧播放信息接口和封面经歌词代理。
- **我们改了什么**：没有改包；Docker 镜像跑同一个 `patch-music-api-client-ip.mjs`，改包的 `server.js`。
- **上游变了怎么跟**：
  - 接口的参数和答复按 `docs/ku-go-api-docs.md` 对；开发时怎么用真的服务对齐，见 skill `kugou-provider-alignment`。
  - 升级改几处的源码包地址和各自的锁文件。
  - 测试：`test/unit/electron/kugouApiBridge.test.ts` 用替身代替包，`test/unit/kugou/kugouMain.test.ts` 测 main 入口接到
    `api.*` 的那一层；`test/unit/onlineMusic/kugouTransport.test.ts`、`kugouProvider.test.ts` 经注册着的模组跑，用替身代替请求
    （`test/unit/helpers/kugouSource.ts`）：抓得到我们自己的解析错，抓不到上游改了答复。`test/manual/fakeSourceNetwork/kugou.mjs`
    是桌面版手测用的假网络。

## 能力

扫码登录（概念版会员的每日领取照旧在读账号时做）、歌曲 / 专辑 / 歌单搜索（没有登录时走匿名搜索，带凭据搜索空了退回匿名）、
歌曲详情、按音质降级取地址（云盘歌走云盘地址；`/song/url` 都不给时最后问旧接口）、KRC 逐字歌词与副歌段（也是别的歌的歌词来源，
`lyrics@1.crossSource`，在来源列表里叫 `name.lyrics`）、本地歌的元数据匹配（`songs@1.metadataMatch`）、账号的歌单与收藏专辑、
「我喜欢」歌单作红心、音乐云盘、听歌排行（最近一周、所有时间）、歌单 / 专辑 / 歌手详情、每日推荐、私人 FM、推荐卡片
（六张，作虚拟歌单）、历史日推、歌单增删歌与收藏、专辑收藏、封面按尺寸要（`covers@1`）。

歌的 id 是大写的 hash，`lyricIds.kugou` 也是它（宿主还在顶层的 `kgHash` 读它）。没有酷狗 id 的歌手给 `kugou-artist-<序号>`，
不能打开（`ref: false`）。歌的 `data` 是迁移前的 `providerData`（hash、mixSongId、albumAudioId、catalogLookupId、albumId、
fileId、originalName），旧的队列与历史照旧读得回来。

要地址、读集合没有成功时，情况由 `core/kugouFailure.ts` 说：main 入口没在跑或没能加载包是 `local-service-stopped`；
酷狗答了却没给地址是 `no-audio`（没有登录时可能是要登录）；带着酷狗 error_code 的是 `refused`；到了时限的是 `unreachable`。
登录失败由 `core/kugouLoginFailure.ts` 说。
