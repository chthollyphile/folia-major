# 「时刻」文件（JSON）

速记簿「时刻」页的数据（歌的标签、评论、带时刻的评论）可以导出成一个 JSON 文件，在别处（或这台设备上）导入。入口在设置 · 存储与备份「备份与导入」。

- 规则（纯函数）：`src/components/song-notes/songNotesFile.ts`
- 下载、读文件、认歌、补快照：`src/components/song-notes/songNotesFileIo.ts`
- 写库：`src/components/song-notes/songNotesService.ts` 的 `importSongNotes`
- 只读模组的库：`src/components/song-notes/musicNotesModDatabase.ts`
- 设置里的几行：`src/components/modal/settings/pages/storage/SongNotesTransferRows.tsx`

## 文件长什么样

扩展名 `.folia-notes.json`，UTF-8。

```jsonc
{
  "format": "folia-song-notes",  // 格式标识，认文件靠它
  "version": 1,                  // 格式版本，整数
  "exportedAt": 1795000000000,   // 导出时刻（毫秒），只作记录
  "tags": [                      // 全部标签，按先后
    { "name": "City Pop", "createdAt": 1790000000000 }
  ],
  "songs": [
    {
      "source": "online",        // 和歌单文件的条目同一种写法：online / navidrome / local
      "song": { /* 歌的快照 */ },
      "tags": [{ "name": "City Pop", "addedAt": 1790000000000 }],   // 这首歌的标签，按打上的先后
      "comments": [
        { "text": "副歌", "at": 61.5, "createdAt": 1790000001000 },  // at：挂在歌里的位置（秒），没有就是普通评论
        { "text": "改过的", "createdAt": 1790000002000, "editedAt": 1790000003000 }
      ],
      "updatedAt": 1790000003000 // 最近一次评论或打标签的时间
    }
  ]
}
```

- 歌的写法和 Folia 歌单文件完全一样（`source`、`song`，本地歌另带 `local`，Navidrome 的另带 `navidrome`），读写都走 `foliaPlaylistFile.ts` 的 `writeFoliaFileSong` / `readFoliaFileSong`。白名单、凭据与地址的规则、本地歌怎么重新认，见 [folia-playlist-file.md](folia-playlist-file.md)。
- 标签在歌里按写法引用（`name`），不写 key：key 是读入时由写法规整出来的（去掉开头的 `#`、空白并成一个、转小写）。
- 文件里不写评论的 id、歌的 key：读入时重新生成、重新算。

## 导入

导入只添加缺少的，已有的不改：

- **标签**：这台设备上没有的，按文件里的先后排在已有标签之后；已有的写法、先后不动。
- **歌**：没有的新建一行，快照用文件里的；已有的留着自己的快照，只添标签和评论。
- **评论**：同一首歌里字和时刻都一样的，算已经有了，不重复添加。
- **上限**照常：一首歌 32 个标签、1000 条评论，一条评论一万字，一个标签 64 字。超出的不添加，导入后的提示里写明条数。
- 外部播放器（舞台）的歌不导入。认不回来的本地歌不导入，确认框里写明有几首、列出前几首的名字。
- 最近改动的时间取两边晚的那个。
- 整个导入是一个事务：写不进去就什么都不变。

读文件时只读不写：先认格式、校验、在曲库里认本地歌，给出确认框（几首歌、几条评论、几个标签）；确认之后才写库。

上限：文件 256 MB，歌 200000 首。导出时超过上限的不导出（自己导出的文件一定读得回来）。文件里写着将来的时间的，导入时当成导入那一刻（不让一首歌永远排在「最近」最前）。不成样子的歌跳过并计数，不让一条坏记录挡住整个文件。

## 「音乐笔记」模组

setobox 的「音乐笔记」模组（folium-compound#177）的数据可以导入，两种来源：

1. **它导出的 JSON**（`format: "music-notes"`，`version` 1 或 2）：在「导入文件…」里选，和自己的格式一样认。
2. **它在这台设备上的库**（IndexedDB `FoliaMusicNotes`，和 Folia 同源）：有这个库时，「备份与导入」里多一行「从『音乐笔记』模组导入」，速记簿「时刻」页提示一次。

只读模组的库，从不写它：不带版本号打开（不触发它的升级），模组要升级时立刻让开；库不在时不为了看一眼去建一个空库。

换算：

| 模组 | 本体 |
| --- | --- |
| `song: { source: "online:<音源>", id }` | `online:<音源>:<id>`（模组的 id 就是 `sourceRef.mediaId`） |
| `song: { source: "local", id }` | `local:<id>`（曲库里的 id，只在同一台设备上认得；曲库里没有的不导入） |
| 别的来源 | 不导入 |
| 正文 `note` | 一条普通评论，写的时间取 `updatedAt`；超过一万字的切成几条 |
| 书签 `bookmarks[]` | 带时刻的评论（`positionSeconds` → `at`），写的时间取 `updatedAt` |
| 标签 `tags[]` | 照写法，打上的时间取这首笔记的 `createdAt` |
| 标签的先后 | v2 的 `tagOrder`（下标，指向按记录先后第一次出现的标签）或库里排序行的 `tagOrder`；v1 没有，照模组旧版的规则：用得多的在前，一样多按名字 |

模组只记了在线歌的名字和身份。确认导入之后，按音源分批向各音源补齐歌的信息（`omni.getSongDetails`）；补回来的歌对不上原来那首、音源没装、请求失败或超时（一次请求最多等 15 秒，整次导入最多花 60 秒问）的，留着只有名字的快照，播放时再按来源解析。这台设备上已经有的歌不去问，留着自己的快照。

## 同步

还没有接进 `src/services/sync/`，以后单独一项。
