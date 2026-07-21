# Omni (Online Music Network Interface)

> [!IMPORTANT]
> **使用规范**：除非有明确需要跨 Provider 处理/调度能力或底层 API 直接交互的特定需求，否则所有前端 UI、Hooks 和业务 Store 对在线音乐服务的调用**必须通过 `omni` 进行**，严禁直接绕过 Omni 耦合具体 Provider 实现。

`omni.ts` 是 Folia Major 在线音乐服务层的**统一网络接口与调度中枢**。它向上层 UI 界面、React Hooks 及 Store 暴露标准化的在线音乐操作 API，向下屏蔽具体的在线音乐服务提供商（Provider，如网易云音乐 `Netease`、酷狗音乐 `KuGou` 等）的实现细节与接口差异。

---

## Omni 的作用

1. **统一路由与抽象屏蔽**
   - 根据传入的 `providerId` 或歌曲/歌单归属的 `MediaId`，自动匹配并调用对应在线音乐 Provider 的底层能力。
   - 避免 UI 层直接依赖具体 Provider，保证架构的解耦与扩展性。

2. **状态与能力集中管理**
   - 整合并维护所有已注册 Provider 的账号登录状态、配置可用性（Availability）及能力支持情况（Capabilities）。
   - 与 Zustand 状态库 (`useOnlineProviderAccountStore`) 紧密结合，感知当前活跃 Provider 及其配置。

3. **防竞争与切换安全保障**
   - 内置请求代数（Request Generation）校验机制（`withActiveProvider`、`invalidateActiveRequests`）。
   - 在用户切换当前活跃 Provider 时，能自动摒弃上一 Provider 未完成的异步延迟响应，防止数据错乱覆盖。

4. **数据标准化与结构归一化**
   - 将不同 Provider 格式各异的数据转换为前端统一的数据模型（如 `UnifiedSong`、`OmniCollection`、`OmniPage<T>`、`OmniAudioSource`、`OmniLyricsResult`）。

---

## 能力列表

Omni 提供的能力按业务模块分类整理如下：

### 1. Provider 状态与能力管理 (Provider & Account Metadata)
- `getProviderSummaries()`: 获取所有已注册 Provider 的运行状态摘要（含登录用户、歌单快照及异常）。
- `getActiveProviderSummary()`: 获取当前活跃 Provider 的状态摘要。
- `getActiveCapabilities()` / `getProviderCapabilities(providerId)`: 查询活跃 Provider 或指定 Provider 所支持的能力集合 (`OmniProviderCapabilities`)。
- `getProviderAvailability(providerId)`: 获取 Provider 的配置与服务可用状态。
- `getProviderLabel(providerId)`: 获取 Provider 的展示名称或简称。
- Provider 账号摘要将登录状态、缓存水合状态和数据新鲜度分开维护；首页可先展示持久化快照，再静默刷新。
- `isSongLiked(song, fallbackLikedSongIds)`: 查询某首歌曲在对应 Provider 中是否已被点赞/收藏。
- `invalidateActiveRequests()` / `getActiveRequestGeneration()`: 递增与获取当前请求代数，用于异步响应防护。

### 2. 账号与认证 (Authentication & Session)
- `getLoginStatus(providerId)`: 查询指定 Provider 的当前登录状态与用户信息。
- `logout(providerId)`: 退出指定 Provider 的账号登录。
- `createQrLogin(providerId)`: 生成二维码登录 Key 与二维码图片 URL。
- `checkQrLogin(providerId, key)`: 轮询与检测二维码扫码登录状态（`QrLoginState`）。

### 3. 搜索 (Search)
- `searchSongs(query, page)`: 在当前活跃 Provider 中分页搜索歌曲。
- `searchProviderSongs(providerId, query, page)`: 在指定 Provider 中分页搜索歌曲。

歌词多源匹配和本地元数据匹配属于显式跨 Provider 编排：它们必须按指定 provider 调用 registry，不得使用会随 active provider 切换的 `searchSongs`。

### 4. 音乐库与用户资产 (User Library & Collections)
- `getUserPlaylists(userId, page)` / `getProviderUserPlaylists(providerId, userId, page)`: 分页获取用户的自建与收藏歌单。
- `getUserAlbums(userId, page)`: 分页获取用户收藏的专辑列表。
- `getLikedSongIds(userId)` / `getProviderLikedSongIds(providerId, userId)`: 获取用户点赞/收藏的歌曲 ID 列表。
- `getCloudCollection(user)` / `getProviderCloudCollection(providerId, user)`: 获取用户的网盘/云盘音乐集合。
- `normalizeCachedUser(providerId, raw)` / `normalizeCachedCollection(providerId, raw, type)`: 校验与标准化持久化的用户或歌单缓存数据。
- `providerAccountCache.ts`: 按 Provider 原子保存用户、集合与点赞 ID 首页快照；刷新失败保留旧快照，明确退出或登录失效时才清除。
- 静默刷新按 `providerId + type + id` 复用未变化集合对象，只替换内容发生变化的卡片。

### 5. 推荐与探索 (Recommendations & Home Feed)
- `getHomeFeed(limit)`: 一键聚合获取首页所需的推荐数据（私人 FM、每日推荐歌曲、推荐歌单）。
- `getPersonalFm()`: 获取私人 FM 推荐歌曲列表。
- `getDailySongs(refresh)`: 获取每日推荐歌曲列表（支持强制刷新）。
- `getRecommendationHistory()`: 获取历史推荐的概览列表。
- `getRecommendationHistoryDates()`: 获取历史推荐的可用日期列表。
- `getRecommendationHistorySongs(entry)`: 获取指定历史日期的推荐歌曲列表。
- `dislikeSong(song)`: 标记歌曲为不感兴趣（并尝试获取替换歌曲）。

### 6. 播放与媒体流 (Playback & Media Stream)
- `getSongDetail(providerId, id)`: 获取指定歌曲的详细元数据信息。
- `canPlaySong(song)`: 校验歌曲是否具备播放支持。
- `getAudioSource(song, quality)`: 获取歌曲指定音质（如标准、HQ、SQ、Hi-Res）的播放音频 URL 与格式。
- `getLyrics(song, context)`: 获取歌曲的歌词信息（支持逐字/逐句时序歌词）。
- `getChorusRanges(song)`: 通过歌曲所属 Provider 获取标准化的副歌时间区间。
- `getSongAvailability(song)`: 查询歌曲可用性状态（如版权限制、付费提示）。
- `getSongReplacement(song)`: 尝试查找不可用歌曲的同曲目替代版本。

### 7. 目录与实体详情 (Catalog & Navigation)
- `getCollectionTracks(collection, page)`: 获取歌单、专辑或云盘集合中的曲目列表（支持分页）。
- `getCollectionDetail(collection)` / `getAlbumDetail(collection)`: 获取歌单或专辑的详细元信息。
- `getArtistDetail(collection)`: 获取歌手/艺人的详细信息。
- `getArtistSongs(collection, page)`: 分页获取歌手的热门/单曲作品。
- `getArtistAlbums(collection, page)`: 分页获取歌手的专辑作品。

### 8. 更改与操作 (Mutations & Interactions)
- `getSubscriptionStatus(collection)`: 查询当前用户对指定歌单/专辑的订阅状态。
- `subscribe(collection, subscribed)`: 订阅或取消订阅指定的歌单/专辑。
- `updateCollectionTracks(collection, operation, tracks)`: 向指定歌单批量添加（`add`）或删除（`del`）歌曲。
- `likeSong(song, liked)`: 将指定歌曲加入或移出“我喜欢的音乐”。

### 9. 关联引用与外链 (Catalog References & Links)
- `canResolveCatalogRef(song, kind)`: 判断是否能解析歌曲在对应平台下的分类/目录关联引用。
- `resolveCatalogRefs(song)`: 解析并补全歌曲上关联的额外目录引用信息。
- `getSongPageUrl(song)`: 获取歌曲在对应音乐平台 Web 端对应的详情页外链。
