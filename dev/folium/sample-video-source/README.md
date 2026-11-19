# 示范视频源（sample-video-source）

Folium 2.0 `playback.surface@1` 的示范模组（方案 §4.2、§4.4）。音源类模组（`mod.json` 里声明了 `sources`），在 client
入口里注册一个音源 `clips`：

- 三段测试视频（`kind: 'video'`）在模组自己的 `<video>` 里放。宿主在播放页下面给一块容器，`mount` 把这个 `<video>`
  挂进去；播放、暂停、跳转、音量、单曲循环、切歌、结束都经 `playback.surface@1` 的成员走，宿主每半秒问一次
  `getStatus` 跟它的时钟。声音不进宿主的音频图：均衡器、频谱、automix、音频缓存、视频导出都不作用于它。
- 一首歌（`间奏（音频）`）走宿主自己的音频（`playback.audio@1`，模组生成的 WAV 音调）。`routeOf` 按条目选：
  视频走 `surface`，歌走 `audio`。
- `itemKinds.video` 写明视频没有歌词、不能喜欢、不上报听歌（宿主的 `itemTraits`）。

视频是 `media/` 里的三段 12 秒、320×180 的测试片段（ffmpeg 的 `testsrc2`、`smptebars`、`testsrc` 加正弦音），由
main 入口 `index.cjs` 经 `api.media.serve('clips', …)` 放在 `folia-mod://sample-video-source/_media/clips/<文件>`，
带 Range，`<video>` 才能跳转。它不声明 `net.fetch`、`filesystem.data`：音源类模组不需要（方案 §5.2）。不带签名：
第三方音源类模组不要求签名，`dev/folium/` 下的示范不在 `sampleMods.test.ts` 的签名检查范围里。

窗口重建（比如切换透明模式）时，`<video>` 在旧窗口的页面里，随窗口一起没了：宿主交接时先把它暂停，新窗口按交接时的
位置再调一次 `play(song, startSec)`（交接前是暂停的就停在原位，等你按播放）。

检查：

```bash
npm run folium:check dev/folium/sample-video-source
```

单测 `test/unit/mod-system/foliumSampleVideoSource.test.ts` 经 omni 和宿主的外部播放路线走一遍。桌面上试：把这个
文件夹拷进隔离 profile 的 `userData/mods/`，在设置的模组面板里启用（第三方音源类模组要确认一次），搜「测试」或
「间奏」，点一段视频，打开播放页。
