# 探索页：接入一个新平台

读这一页就够动手。各平台实测到的数字和日期在同目录 `README.md` 的平台条目里，不在这里重复。

## 要做的事

1. 写一个 `OnlineExploreProvider`（定义和契约注释在 `src/types/onlineMusic.ts`），放在平台自己的 adapter 里。
   现成的三个：`spotify/spotifyExplore.ts`、`ytm/ytmExplore.ts`、`netease/neteaseExplore.ts`。
2. 挂到 provider 上：`explore` 成员，加 `capabilities.explore: true`，两样一起加。首页的“探索”页签只看 `capabilities.explore`（`src/components/Grid3D.tsx` 的 `canUseOnlineExplore`）和用户的设置（顶部胶囊入口里的“探索”，`showHomeTabExplore`；开关没开的平台那一项是暗的）：只开开关、没有成员，页签会出现但页面是空的。`omni.supportsExplore` 两样都看，但界面没有用它。
3. 界面（`src/components/app/home/explore/`）、页面数据（`src/stores/useExploreFeedStore.ts`）和队列拼贴的探索墙（`src/components/app/lattice/exploreWall.ts`）不认平台，不用改，`explore*` 文案也不用加。
   界面显示不了平台需要的东西时，停下来说明，不要为一个平台改各平台共用的规则。
4. 单元测试放在平台自己的测试目录（例如 `test/unit/ytm/`），见下面“验收”。

接入一整个平台的其他步骤见同目录 `README.md` 的“接入一个新平台”。由 mod 提供的平台怎么接探索页，见 [`docs/folium/api.md`](../../../docs/folium/api.md) 和 [`docs/folium/contributing.md`](../../../docs/folium/contributing.md)。

## 接口

```ts
getFeed(cursor?, listened?)  // → { sections, nextCursor?, refreshReadsAnew? }   不带 cursor = 从头读
getSectionItems?(cursor)     // → { items, moreCursor? }      一栏的后续条目
```

- 一栏：`{ id, title, items, moreCursor?, changesWithRead? }`
- 一个条目：一首歌，或一张打开集合（歌单、专辑、歌手）的卡片；可选 `wideCoverUrl`、`isMix`、`subtitle`
- 游标是平台自己定的字符串，调用方不解读
- `refreshReadsAnew`：从头读的那一页可以带上，声明“换一批”要把这一页从头重读（见规则 2）。不带就按默认规则；mod 提供的平台走同一个约定

## 动手前要量清楚的平台事实

每条用真实请求量一次，不要猜；量到的写进 `README.md`。

- 平台自己的推荐页是哪个接口；是否按账号生成；隔几秒连读两次，内容是否相同
- 一栏给几条，栏内能否翻页；整页有没有下一页；翻页游标认的是栏目还是页面上的位置
- 栏目有没有每次读取都不变的标识；标题会不会变
- 条目有哪几种；图片是方图还是宽图，多大
- 页面里有没有平台自己的“最近播放”“再听一次”一类栏目，靠什么认出来
- 有没有按一首歌取相似歌曲的接口：一次几首，同一首歌再问是否相同
- 未登录能拿到什么；登录过期时接口答什么
- 请求频率的限制

## 规则

1. **栏目 id**：同一栏在每次读取里 id 相同（页面先按 id 认栏目，认不上再按标题）。每次读都换标题、换内容的栏（按种子现做的）用新 id，并标 `changesWithRead`。
2. **“换一批”默认不重读页面**：页面先向每一栏要后续条目，所有栏都换不出新条目时才从头重读。所以能翻页或能重取的栏都要给 `moreCursor`；很长的列表要限制一次读取里交出的批数，否则页面永远不会重读，下一次从头读再接着上次停的地方。只要有一栏还能从自己的游标换出新条目，这一次“换一批”就不重读，只有重读才换得了的栏（平台每读一次重新挑、连标题一起换的栏，条目只有一批的种子栏）这一次就不变。平台的页面上这种栏多时，在从头读的那一页上声明 `refreshReadsAnew: true`（网易云这样做）：每次“换一批”都直接从头重读，页面不向任何一栏要后续条目；每栏一次读取交一批，由 adapter 记住上次交到哪里（记在哪里见规则 10）。声明之后各栏照样给 `moreCursor`，它只给“更多”用：把这一栏接着展开，不换内容。“更多”展开过的条目要算作这次读取交过的，下一次重读从没展开到的接着给（见 `README.md` 的 `netease/neteaseExplore.ts` 条目）。
3. **游标只在下一次从头读之前有效**：上一次读取的游标一律答空，不发请求，更不能答成“那个位置现在的内容”。靠在游标前面写上读取的序号来认的，用同目录 `exploreReads.ts` 的 `stampCursor` 写、`cursorWords` 读（网易云和 YouTube Music 这样做），不要自己再写一份；序号后面写什么仍由 adapter 自己定。
4. **收听记录栏去掉**：平台页面里账号自己的收听记录不属于这一页。“最近播放”“再听一次”由应用自己的播放记录给出，各平台一样。
5. **`listened`**：从头读时交来的、听者在应用里听过的本平台歌曲，常听的在前。可以拿来做“与某首歌相似”的栏；一次从头读做几栏、发几个请求要有上限。
6. **部分失败不拖垮整页**：一段读不到就略过这一段，全都读不到才报失败（`OnlineProviderError`，断网用 `network`）。
7. **条目用平台已有的 normalizer**：点开卡片走的是平台已有的 catalog 读取，所以集合的 `type` 和 `id` 必须是 catalog 认得的。
8. **平台自己的措辞留在 adapter**：卡片第二行要按平台的说法写时，放进条目的 `subtitle`。
9. **日志**：行首 `[平台名] Explore`（例如 `[Netease] Explore page: ...`、`[Ytm] Explore radio of ...`），写数量和做出的决定，不写标题。行首的 `[Explore]` 留给各平台共用的页面数据（`useExploreFeedStore.ts`）。
10. **交过什么记在共用模块里，不在 adapter 自己的变量里**：前几次读取交过哪些条目、拿哪些歌问过，用同目录 `exploreReads.ts` 的 `createHandedOut()` 记。规则只有一条，各平台相同：候选里没用过的排最前，其余按最久以前用过的在前（`inTurn`）；这一次用了哪些，用 `note` 记（先后由模块自己记：后记的算后用的，同一次读取里也分先后；adapter 不用报这是第几次读取）。所以不管列表比一批长多少，都是从头走到尾才回到开头，每一条轮到的次数一样，不用自己写“全用过了重来”。范围是 adapter 自己定的键，每次读取都要相同：一栏的条目用这一栏的 id，拿来问的歌用一个固定的词；栏的 id 每次读取都不同的（Spotify 自己做的电台栏），这类栏共用一个范围。每个范围最多记 5000 个，超出时忘掉最久以前用过的，忘掉的当作没用过。记录只在内存里，重启就没了；什么时候整份丢掉由 adapter 自己定（网易云在登录状态变化时另起一份，YouTube Music 和 Spotify 不丢）。只属于一次读取的东西（这次读取里各栏持有什么、还剩哪些歌可以问）和翻页的列表读到的位置不在此列，留在 adapter。

## 界面怎么用这些字段

- 第一栏：第一条放大，其余列在旁边。其后每栏一排横向卡片。只有一条的栏显示成横幅。
- 有 `wideCoverUrl` 按 16:9 显示，没有按方图；歌手一律圆图。
- 第二行：有 `subtitle` 就用它；否则歌曲写歌手名，集合写主人名，都没有才写类型。`isMix` 的卡片类型写“动态歌单”。
- 一批有几条，按这一栏第一次给了几条算。
- 卡片的文字由 `src/components/app/home/explore/exploreFace.ts` 的 `faceOf` 决定，队列拼贴的探索墙也用它。

## 验收

- 单元测试（毫秒级）：栏目 id 是否稳定、哪些栏被去掉、旧游标是否答空、条目去重。
- 用真实账号跑一遍：从头读到底；连读两次比较；每一栏的后续条目走到头。只记录数量。
- 在 `README.md` 补上平台条目。

## 接入新平台时常一起做的两件事（不属于探索页）

- **电台页签**：`recommendations` 成员（`getPersonalFm`、`getDailySongs`、`getRecommendedCollections`、`dislikeSong`）加 `capabilities.recommendations`。平台没有对应内容的卡片就不出，不拿别的东西充数。
- **音质档位**：`playback.audioQualityLevels` 列出平台真正分得开的档位，控制面板只显示这些。
