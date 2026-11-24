# 契约测试音源（sample-source-full）

Folium 2.0 的示范模组和契约测试：一个音源类模组（`mod.json` 里声明了 `sources`），在 client 入口里用
`folium.sources.register` 注册两个音源：

- `fixture`：实现了每个标准能力族，`search@1`、`songs@1`、`playback.audio@1`、`reports@1`、`lyrics@1`
  （带 `crossSource`，能给别的歌配歌词）、`auth@1`（假的扫码登录：再检查两次就算登录成功）、`library@1`、
  `catalog@1`、`recommendations@1`、`explore@1`、`mutations@1`、`covers@1`（图床 `covers.sample-source.invalid`
  的尺寸规则）、`raw@1`，外加一个自定义能力 `x.sample-source-full.stats@1`。
- `fixture-external`：歌在它自己的“外部播放器”里放（`playback.external@1`，一个时钟），声音不进宿主。

数据都是写在 `client.mjs` 里的假数据，歌曲的声音是模组自己生成的 6 秒音调（8 位 WAV，`data:` 地址），
不连任何真实平台。名字和说明一部分来自模组自己的语言表（`locales/`，经 `folium.i18n.key`），一部分是按语言写的
标签。main 入口 `index.cjs` 只演示 `folium.rpc` 和音源类模组的 `api.seal`、`api.onBeforeUnload`。

它不声明 `net.fetch`、`filesystem.data`：音源类模组不需要（方案 §5.2）。

检查：

```bash
npm run folium:check dev/folium/sample-source-full
```

单测 `test/unit/mod-system/foliumSampleSourceFull.test.ts` 经 omni 逐个能力族走一遍。桌面上试：把这个文件夹拷进
隔离 profile 的 `userData/mods/`，在设置的模组面板里启用（第三方音源类模组要确认一次）。
