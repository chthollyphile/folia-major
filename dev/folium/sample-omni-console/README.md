# 在线音源样例（sample-omni-console）

需要 Folium 1.7（桌面版）。在首页加一个「在线音源」页面，经 `folium.omni` 只读宿主的在线音源：列出本机有哪些音源、各自支持什么，
搜歌并用 `nextCursor` 翻页，看一首歌的详情（`describeSong`）、歌词的前几行和它所在专辑的第一页曲目，
把存下来的 `{ source, id }` 在重启之后解析回能播放的歌。

权限：

- `folium.omni` 本身**不需要权限**。但它以你在 Folia 登录的平台账号向平台发请求（读的是公开的目录数据，和你自己在界面上搜歌一样），
  启用确认窗口里不会为它多写一句，所以这里写清楚。
- `playback.control`：**只有「加入队列」那一步需要**（`folium.playback.enqueue`）。
- `filesystem.data`：**只有「存键」需要**（`folium.storage`，存的是 `{ source, id }` 和歌名，不是 `ref`）。

不用实验接口，不需要 main 入口。请求以哪个账号发出、要不要登录由平台定：平台要登录而你没登录时，页面显示对应错误码的说明（`not-signed-in`）。

## 安装

这个目录**没有签名**，开发版也**不会自动扫描** `dev/folium/`，需要手动安装（装好后在模组面板里显示为「未验证」）：

- **打 zip 拖进去**：把整个目录打成 zip，拖到模组面板上。`mod.json` 在 zip 里唯一的顶层文件夹里也可以：

  ```powershell
  Compress-Archive -Path dev/folium/sample-omni-console -DestinationPath sample-omni-console.zip
  ```

- **复制到用户模组目录**：模组面板右上角「打开模组目录」，把 `sample-omni-console` 目录复制进去，再点「重载」。
- 开发时也可以临时复制到仓库的 `mods/` 下，享受开发目录「改了文件不用重新确认」的豁免；但不要提交到那里：`mods/` 里的模组必须带官方签名，
  `test/unit/mod-system/sampleMods.test.ts` 会失败。

然后在模组面板里启用「在线音源（样例）」并确认。

## 试用

1. 在 Grid 或 Bravais 首页的导航里选「在线音源」，或在命令面板里运行「打开在线音源」。
2. **音源**：卡片列出 `listProviders()` 的每一项：名字、`providerId`、是不是宿主选中的、是不是模组注册的（`origin: 'mod'`）、
   有没有配好（`configured`），以及 `supports` 里的五个标志（划掉的是不支持）。它是同步的、不问平台，所以每次重画都读一遍：
   在宿主里换一个选中的音源，再动一下页面，「宿主选中」的标记就跟着挪。
   上面一排按钮选搜索哪个音源：「当前选中的」不传 `providerId`，跟着宿主走；点一个具体的音源就固定传它的 `providerId`。
3. **搜索**：输入歌名回车。第一页按「每页」选的条数读（`limit` 只在第一页传）；「下一页」只传 `cursor`（和第一页一样的搜索词、音源），
   接在后面。翻页途中改「每页」不影响这一串结果，下一次新的搜索才按新的页长。
   - 搜「当前选中的」时，翻页途中在宿主里换了选中的音源，「下一页」回 `account-changed`：这串结果属于原来那个音源，重新搜即可。
   - 游标只在这次运行里有效，太久不用会失效（`stale-ref`），页面提示后从第一页重新搜。
   - 每一行有「正在放」的标记：比的是 `source` 和 `id`，不是 `ref`。同一首歌从队列里读和从搜索里读，`ref` 可能不同。
4. **歌曲**：点一行的「详情」。
   - `describeSong` 是同步的，不问平台：时长（平台没给时写「平台没给」，不当成 0 秒）、可用性、平台网页地址、封面。
     可用性的 `playable` 只表示平台没标什么，不保证放得了。
   - 歌词：先看这个音源的 `supports.lyrics`，不支持就不请求；支持就 `getLyrics` 读平台原样的歌词，列出前 6 行，副歌行前面有「♪」（`isChorus`）。
     模组的 `omni.lyricsResolved` 钩子不改它；要看屏幕上那一份，用 `folium.lyrics.getLines()`。
   - 「专辑曲目（第一页）」：`getAlbum` 拿到这首歌的专辑（从歌上取的摘要），再 `getTracks` 读第一页 10 首，写出专辑的键
     `source:album:id`（存它，下次用 `resolveCollection` 找回来）。音源的 `supports.albums` 为 `false` 时按钮不可用。
5. **存键与重启**：点几首歌的「存键」，存进 `folium.storage` 的只有 `{ source, id }` 和当时的歌名、歌手。重启 Folia（或在模组面板重载这个模组），
   再打开页面：第一次打开时把存下的键一次交给 `resolveSongs`，每个键一种结果：
   - `found`：解析回宿主的歌，带着新的 `ref`，可以「详情」「加入队列」；
   - `not-found`：平台回答了没有这首（比如没和曲库匹配上的云盘上传）；
   - `unsupported`：这台宿主现在查不了（这个音源的模组没启用、不是在线音源、或者它不能按 id 查歌）。**键留着**，不删：音源回来之后就又能解析；
   - `failed`：没拿到回答，写出错误码的说明（`rate-limited`、`network` 等），「重新解析」再试。
   解析只在打开页面时做，不在模组启动时做：只解析马上要显示的。
6. **手动解析一个键**：填音源 id（不填就用宿主选中的）和歌曲 id，点「解析」。填一个不存在的音源 id（如 `nope`）会看到 `unsupported`，
   填 `local` 也是：本地文件、Navidrome、外部 Stage 不是在线音源。
7. **加入队列**：任何一行的「加入队列」调 `folium.playback.enqueue(song)`。它和宿主自己的「加入队列」一样按你的「加入队列方式」设置加
   （下一首或最后），已经在队列里的歌挪过去、不加第二遍，提示由宿主弹出。`ref` 已经失效时返回 `false`，页面提示重新搜或重新解析。
   用它一首一首重建整张队列会走样（设为「下一首」时顺序整个反过来），整表替换队列不在 Folium 1.7 里。

## 演示了哪些 1.7 接口

| 接口 | 在哪 |
| --- | --- |
| `folium.omni.listProviders()` | 「在线音源」卡片，每次重画都读；`supports` 决定搜哪些、歌词和专辑按钮能不能用 |
| `searchSongs(query, { providerId, limit, signal })` 与 `{ cursor }` | `createDesk` 的 `search` / `more`：第一页定页长，之后只传游标；新的搜索中止旧的 |
| `describeSong(song)` | `pick`：同步，`null` 时写「宿主不知道这首歌了」 |
| `getLyrics(song, { signal })` | `pick`：先看 `supports.lyrics`，前 6 行，`isChorus`、`isWordByWord`、`isPureMusic` |
| `getAlbum(song)` → `getTracks(album, { limit })` | `loadAlbum`：专辑的键和第一页曲目 |
| `resolveSongs(keys, { signal })` | `resolveSaved`（存下的键，每次启动后第一次打开页面时）、`lookup`（手动填的键） |
| 错误码 | `TEXT.errors`：每个 `FoliumOmniErrorCode` 一句说明，不认识的按 `network`；不认识的解析结果按 `failed` |
| `folium.playback.enqueue`（需要 `playback.control`） | 每一行的「加入队列」 |
| `folium.storage`（需要 `filesystem.data`） | 存下的键 |

旧宿主（Folium 1.6，没有 `folium.omni`）上 `activate` 只记一行警告、什么也不注册；导出窗口里什么也不做（那里 `folium.omni` 的每个方法都会报错）。

`test/unit/mod-system/devFoliumSamples.test.ts` 校验清单，并在 jsdom 里用一个替身 `folium` 跑 client：旧宿主和导出窗口里不调用 `folium.omni`，
搜索翻页、歌曲详情、专辑曲目、存键，以及「重启」之后用 `resolveSongs` 把存下的键解析回来。
