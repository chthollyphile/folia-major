# 酷狗与 Omni 能力对齐说明

更新时间：2026-07-20

本文对照以下内容整理：

- `src/services/onlineMusic/omni.ts`：统一入口及当前调用方式
- `src/types/onlineMusic.ts`：provider adapter 合约
- `src/services/onlineMusic/kugouProvider.ts`：酷狗实现
- `src/hooks/useKugouLibrary.ts`、`src/components/Grid3D.tsx`、`src/components/GridView.tsx`：当前 UI 使用点
- `docs/ku-go-api-docs.md`：酷狗接口文档

## 已对齐能力

| Omni 能力 | 酷狗实现 | 文档依据 |
| --- | --- | --- |
| 搜索歌曲 | `/search`，传入 `type=song` | “搜索” |
| 登录状态、退出、二维码登录 | `/user/detail`、`/logout`、`/login/qr/key`、`/login/qr/create`、`/login/qr/check` | “登录”“获取用户额外信息” |
| 用户歌单 | `/user/playlist`，过滤 `source=1` | “获取用户歌单” |
| 用户收藏专辑 | `/user/playlist`，过滤 `source=2` 或存在 `musiclib_id`，专辑 ID 使用 `musiclib_id` | “获取用户歌单”及实际接口返回结构 |
| 用户收藏歌曲 ID | 查找“我喜欢”歌单，再调用 `/playlist/track/all` | “获取用户歌单”“获取歌单所有歌曲” |
| 收藏/取消收藏歌曲 | 复用“我喜欢”歌单的 `/playlist/tracks/add`、`/playlist/tracks/del` | “对歌单添加歌曲”“对歌单删除歌曲” |
| 获取歌曲详情 | `/audio` | “歌曲详情” |
| 获取音源 | `/song/url`；云盘歌曲使用 `/user/cloud/url` | “获取音乐 URL”“获取用户云盘音乐 URL” |
| 获取歌词 | 现有歌词 provider 使用 `/search/lyric`、`/lyric` | “歌词搜索”“获取歌词” |
| 歌单曲目与详情 | `/playlist/track/all`、`/playlist/detail` | “获取歌单所有歌曲”“获取歌单详情” |
| 专辑曲目与详情 | `/album/songs`、`/album/detail` | “专辑音乐列表”“专辑详情” |
| 歌手详情、歌曲、专辑 | `/artist/detail`、`/artist/audios`、`/artist/albums` | “获取歌手详情”“获取歌手单曲”“获取歌手专辑” |
| 每日推荐 | `/everyday/recommend` | “每日推荐” |
| 私人 FM | `/personal/fm` | “私人 FM” |
| 推荐歌单 | `/top/card/youth`，使用 `card_id` 组装虚拟歌单 | “歌曲推荐（概念版）” |
| 历史推荐日期与歌曲 | `/everyday/history?mode=list`、`mode=song` | “历史推荐” |
| 歌单曲目增删 | `/playlist/tracks/add`、`/playlist/tracks/del` | “对歌单添加歌曲”“对歌单删除歌曲” |
| 歌单收藏/取消收藏 | `/playlist/add`、`/playlist/del` | “收藏歌单/新建歌单”“取消收藏歌单/删除歌单” |
| 歌单订阅状态 | 扫描 `/user/playlist` 的混合结果推导 | “获取用户歌单” |

其中“收藏歌曲”和“歌单订阅状态”没有在文档中找到独立接口，当前实现是基于文档明确提供的歌单接口组合出来的能力；“我喜欢”歌单识别使用名称和 `listid=2` 双重兼容条件。

## 当前无法完整实现的能力

| Omni 能力 | 当前状态 | 原因与影响 |
| --- | --- | --- |
| 歌曲可用性与版权替代 | 未实现 | 文档中没有与 `getAvailability`、`getReplacement` 对应的酷狗接口；当前播放失败只能返回无音源，不能像网易云一样获取版权替代歌曲。 |
| 歌曲页面 URL | 未实现 | Omni 暴露了 `getSongPageUrl`，但接口文档没有稳定的歌曲详情页 URL 约定，当前没有为酷狗拼接未经验证的链接。 |

## 非阻塞说明

- 酷狗云盘曲目和音源已经支持；当前 `useKugouLibrary` 直接把云盘入口组装成 collection，因此没有重复请求一个仅用于展示的 `getCloudCollection`。
- `getSubscriptionStatus` 是从用户歌单列表推导的快照，不是服务端独立状态查询；用户收藏数量较大时仍受当前分页上限影响。
- `likes` 已接入酷狗账户刷新流程，账户状态会加载“我喜欢”歌曲 ID，收藏按钮可以使用实际状态初始化。
