# Omni 在线音乐层

`src/services/onlineMusic/omni.ts` 是普通在线歌曲数据的唯一公开入口。组件、hook、store 和普通 app service 不得直接调用具体 provider、registry、transport 或 raw API；只有明确的跨 provider 编排，或 provider adapter/transport 自身，才可以使用 provider-explicit 层。

## Layer map

```text
UI / hooks / stores / app services
  -> omni.ts
       -> providerRegistry.ts
            -> neteaseProvider.ts
            -> kugouProvider.ts
                 -> kugouTransport.ts（酷狗请求/IPC 边界）
            -> qqProvider.ts
                 -> qqTransport.ts（QQ 音乐请求边界）
       -> providerAccountCache.ts / providerStorage.ts
  -> src/types/onlineMusic.ts（共享合同）
```

当前 registry 注册 `netease`、`kugou` 和 `qq`。Navidrome 是独立的 Subsonic 服务，入口是 `src/services/navidromeService.ts`，不属于 Omni provider。

## Public contract

调用前先看 `omni.ts` 的方法和 `src/types/onlineMusic.ts` 的类型。常用入口按能力分组：

| 能力 | Omni 方法/区域 | 结果/边界 |
| --- | --- | --- |
| provider 状态 | `getProviderSummaries`、`getActiveProviderSummary`、`getProviderCapabilities`、`getProviderAvailability` | `useOnlineProviderAccountStore` 提供 active provider 与账号快照 |
| 账号/二维码 | `getLoginStatus`、`logout`、`createQrLogin`、`checkQrLogin` | provider auth adapter；不要在 UI 直接保留 raw session |
| 搜索 | `searchSongs`、`searchProviderSongs` | 普通搜索按 active provider；显式 provider 或跨 provider 用第二个方法 |
| 用户库 | `getUserPlaylists`、`getProviderUserPlaylists`、`getUserAlbums`、`getLikedSongIds`、`getCloudCollection` | 统一 `OmniCollection` / page 类型，账号快照可先展示再静默刷新 |
| 推荐 | `getHomeFeed`、`getPersonalFm`、`getDailySongs`、`getRecommendationHistory*`、`dislikeSong` | 首页推荐与历史推荐仍由 Omni 路由 |
| 播放/歌词 | `getSongDetail`、`canPlaySong`、`getAudioSource`、`getLyrics`、`getChorusRanges` | 输出 `OmniAudioSource` / `OmniLyricsResult`；Navidrome 歌词走独立 service |
| 可用性 | `getSongAvailability`、`getSongReplacement` | 保留 unsupported / unavailable / auth 等 `OmniError` 语义 |
| 集合详情 | `getCollectionTracks`、`getCollectionDetail`、`getAlbumDetail`、`getArtistDetail`、`getArtistSongs`、`getArtistAlbums` | 按 collection 的 `providerId` 路由 |
| 修改 | `likeSong`、`toggleSongLike`、`getSubscriptionStatus`、`subscribe`、`updateCollectionTracks` | mutation 按歌曲/集合所属 provider 执行并更新 account cache |
| 外链与引用 | `canResolveCatalogRef`、`resolveCatalogRefs`、`getSongPageUrl` | 共享 `catalogRefs.ts` 的 provider-aware 引用 |

共享类型包括 `UnifiedSong`、`OmniCollection`、`OmniPage`、`OmniLyricsResult`、`OmniAudioSource`、`OmniUser`、`OmniError`、`OmniProviderCapabilities`。调用方不能依赖 provider 的 raw field、numeric id 单独比较或 raw response envelope。

## Provider and cache files

- `providerRegistry.ts`：注册、查找、按歌曲 `sourceRef` 选择 provider、能力检查。
- `neteaseProvider.ts`：网易云 adapter，归一化到 Omni contract。
- `kugouProvider.ts`：酷狗 adapter；请求细节在 `kugouTransport.ts`，具体接口需结合 `docs/ku-go-api-docs.md` 和 `skills/kugou-provider-alignment`。
- `qqProvider.ts`：QQ 音乐 adapter；请求与 opaque session 细节在 `qqTransport.ts`，归一化在 `qqNormalize.ts`。集合身份一律用 mid，数字 `albumid` / `singer.id` 会被上游拒收（返回 HTTP 200 但 `code` 非 0，只表现成空白页）。后端由 `VITE_QQ_API_BASE` 指向的私有 QQ API 提供，未配置时该 provider 不可用。
- `providerAccountCache.ts`：按 provider 保存用户、集合、点赞 ID、hydration/freshness 快照；刷新失败保留旧快照。
- `providerStorage.ts`：provider session/account 持久化边界。
- `resourceCache.ts` / `resourceKeys.ts`：在线资源缓存键和缓存层。
- `songMetadata.ts` / `songAvailability.ts`：歌曲元数据、可播放性和替代歌曲相关共享逻辑。
- `catalogRefs.ts`：歌曲、歌单、专辑、歌手的 provider-aware catalog 引用。

`omni.ts` 的 active-provider 调用带 request generation 检查：`withActiveProvider` 会丢弃 provider 切换后返回的旧响应，切换事务需要 `invalidateActiveRequests()`。不要在调用方重新实现一套取消/晚到响应防护。

## Routing rules

### Ordinary single-provider flow

```ts
import { omni } from '@/services/onlineMusic/omni';

const page = await omni.searchSongs(query, { limit: 30, offset: 0 });
const song = page.items[0];
if (song) {
    const lyrics = await omni.getLyrics(song);
    const audio = await omni.getAudioSource(song, 'high');
}
```

歌曲已经带有 provider identity 时，使用 song-aware 方法：

```ts
await omni.toggleSongLike(song);
await omni.getCollectionTracks(collection, { limit: 50, offset: 0 });
```

### Explicit cross-provider flow

歌词匹配、本地元数据匹配、联邦搜索、fallback、比较和迁移才是跨 provider。使用 `searchProviderSongs(providerId, ...)` 等显式方法，并保留每条结果的 `sourceRef.providerId`。不要为了“当前有两个 provider”就直接并发调用 raw adapter。

### Identity

在线歌曲身份是 `(sourceRef.kind='online', sourceRef.providerId, sourceRef.mediaId)`，不是 `song.id` 单值。比较、去重、替代、入队前优先使用：

- `src/utils/appPlaybackGuards.ts`：`getPlaybackSourceRef`、`getPlaybackSongKey`、`isSamePlaybackSong`
- `src/utils/appPlaybackHelpers.ts`：播放结构和来源相关派生

跨 provider 的 numeric id 不可直接去重；`online:netease:123` 与 `online:kugou:123` 默认是两个播放身份。

## Fast lookup

```powershell
rg -n "export const omni|searchSongs|getLyrics|getAudioSource|updateCollectionTracks" src/services/onlineMusic/omni.ts
rg -n "OnlineMusicProvider|OmniProvider|UnifiedSong|OmniLyricsResult|OmniAudioSource" src/types/onlineMusic.ts
rg -n "registerOnlineMusicProvider|neteaseProvider|kugouProvider|qqProvider|providerSupports" src/services/onlineMusic/providerRegistry.ts
```

先确认 Omni 是否已有能力；没有时扩展 `types/onlineMusic.ts`、`omni.ts` 和适用 adapter，不要新增第二条公开 bypass。
