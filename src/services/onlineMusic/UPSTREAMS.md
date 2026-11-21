# 各平台依赖的上游

每个在线平台靠什么拿到数据和音频、版本钉在哪里、我们在上面包了或改了什么、上游变了怎么跟。平台清单以 `sources/` 下的目录为准（每个目录是一个音源模组，目录名就是短音源 id）；接入一个新平台见同目录 `README.md` 的“接入一个新平台”。

Folium 2.0 起每个平台是仓库内的一个音源模组（`sources/<id>/`），原来这里的各家一节都搬进了它自己的 `sources/<id>/README.md`：

| 平台 | 去哪里看 |
| --- | --- |
| 网易云音乐 | [`sources/netease/README.md`](../../../sources/netease/README.md) |
| 酷狗音乐 | [`sources/kugou/README.md`](../../../sources/kugou/README.md) |
| QQ 音乐 | [`sources/qq/README.md`](../../../sources/qq/README.md) |
| 波点 | [`sources/bodian/README.md`](../../../sources/bodian/README.md) |
| YouTube Music | [`sources/ytm/README.md`](../../../sources/ytm/README.md) |
| Spotify | [`sources/spotify/README.md`](../../../sources/spotify/README.md) |
| 汽水音乐 | [`sources/qishui/README.md`](../../../sources/qishui/README.md) |
| Apple Music | [`sources/appleMusic/README.md`](../../../sources/appleMusic/README.md) |
| 飞牛音乐 | [`sources/fnmusic/README.md`](../../../sources/fnmusic/README.md) |
| 洛雪音源（用户导入的自定义源脚本） | [`sources/lxmusic/README.md`](../../../sources/lxmusic/README.md) |

新平台的那一节也写在它自己的 `sources/<id>/README.md` 里，不加到这里。这里只剩各平台通用的事实和不是 Omni provider 的 Navidrome。

几条各平台通用的事实：

- 上游库的版本钉在这一家的 `sources/<id>/package.json`（构建核对装着的版本，不一致就报错），依赖怎么打进模组见 `dev/sources/README.md`。版本以 `package-lock.json` 为准。`npm ci` 按锁文件装，`package.json` 里写的范围只在改依赖时起作用。
- 网页版的三个平台（网易云、酷狗、QQ）要一个部署好的服务，地址写在环境变量里（`.env.example` 的 `VITE_NETEASE_API_BASE`、`VITE_KUGOU_API_BASE`、`VITE_QQ_API_BASE`）。Docker 部署的那份在 `deploy/docker/<平台>-api/package.json`，版本和根目录的分开钉，升级时两处都要改。
- `deploy/docker/**` 有改动时，CI 的 `docker-stack-check` 会构建镜像，并用 `deploy/docker/scripts/smoke-test.sh` 请求一次 `/netease/`、`/kugou/`、`/qq/login/status`。
- 下面“哪些测试能抓到”只算单元测试。大多数测试用替身代替上游的包，上游换了答复的样子它们照样通过；这种情况写明“抓不到”，升级后要在应用里用真账号试。

## Navidrome（不是 Omni 的 provider）

- **上游**：用户自己的 Navidrome 服务，走 Subsonic API（`/rest/<接口>`），入口是 `src/services/navidromeService.ts`。歌词等扩展先问 `getOpenSubsonicExtensions` 再决定用不用。
- **版本**：请求里写 `v=1.16.1`（Subsonic API 版本）、`c=Folia`；鉴权用 `md5(密码 + salt)` 的 token。没有要装的包。
- **上游变了怎么跟**：Subsonic 是公开的协议，服务端版本由用户自己定。`test/unit/navidrome/navidromeService.test.ts` 用替身代替服务端，管的是我们拼请求和读答复的写法。
