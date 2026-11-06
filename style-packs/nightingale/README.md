# 夜莺 · 窗边轻哼 v1.3

依据用户本地 Wallpaper Engine 场景 `3448877775` 制作的 Folia API 2 独立风格包。沿用原画的夜蓝城市、阳台栏杆、窗帘和背影女孩，以歌词驱动轻哼动作和文字音符。不会生成、替换或叠加人声。

## 使用

- 播放器：命令面板搜索“风格包”，导入 `nightingale.folia-style.json`，选择“应用”。播放自己的歌曲，实际歌词由播放器提供。
- 调试：用 Chrome 打开 `Nightingale-StyleStudio.html`。已自动载入本包，点击播放即可预览；支持 JavaScript 修改、横竖屏、时间跳转、长文本、多语言、减少动态效果和 PNG/验收报告导出。调试器的示例歌词不带声音。
- `preview.mp4` 是 45 秒无声演示，使用原创示例歌词；它是预览，不是播放器所播放的视频背景。

包只使用现有的 `FoliaStyle.define / update(scene) / render(frame) / dispose()`。无需添加播放器内置模式，也无需更改加载器、接口或存储上限。

## 原壁纸分析与重建对应

本地 `project.json` 标题为「【Time Variation 时间变化】Alone 孤独の少女——夜莺Night【原画：Rella]」。包为 PKGV0022，包含 134 个文件；场景为 3840×2160、103 个对象。分析读取了场景、原始贴图、人物 MDL、材质和 6.58 秒缩略动图。

| 原场景证据 | 本次实现 |
| --- | --- |
| `scene.json` 的背景、建筑、栏杆、左右窗帘、包、椅子是独立图层 | 提取并压缩为 8 个包内 WebP；按原世界坐标重建 |
| `Rella 部件.tex` 是拆分图集，`Rella 部件_puppet.mdl` 为 MDLV0023 | 读取原始 144 个顶点、142 个三角形与 UV，WebGL 重新拼合人物，保留原画形状 |
| 人物配置包含骨骼动画、waterwaves、foliagesway | 使用原始静态网格，重新编写肩颈呼吸、点头和发梢摆动；歌词发声期间幅度增强 |
| 左窗帘是青色键控视频，右窗帘有 waterwaves | 左帘从本地视频解码并键控一帧，两个窗帘再以歌曲时间驱动轻摆 |
| 场景包含昼夜切换、星点、流星、烟花、时钟和频谱选项 | 本包选择固定夜蓝暮色与轻微星点；未移植时钟、烟花、鼠标跟随及完整昼夜系统 |
| 原壁纸没有播放器逐字歌词流 | 新增歌词轻哼：字词独立浮现、聚成句后在附近驻留，N+2出现时渐隐；仅入场有短暂音符提示 |

人物背对观众，因此用肩颈与头发表现轻哼，不声称复原了正面口型。原 Wallpaper Engine 动画曲线和专有着色器没有逐一翻译；这是使用原素材、原网格和自定义动效的重建。

## 歌词行为（本次MCP重制）

默认auto + atmospheric-light选择“出字→输送→留声”的组句形式：每个真实字形先在女孩附近出现，随轻哼沿弧线流向自己的位置，逐渐减速停下。已到达的字保持位置，只在附近轻浮；后面的字继续从女孩附近流出。曲线句形只决定停留位置，不再在远处终点渐显。没有用装饰粒子代替文字运动。

第N句完整保留，到N+2句开始出现才用0.9秒渐隐。N+1出现时旧句继续保留，空白行不计句数，最后两句留至切歌；纯音乐时人物仍轻呼吸。生成前预留完整乐句与局部动画空间，横屏避开头部、竖屏安排在人物上方。大字号和长句会在生成前整体适配，不能用吞掉旧字解决空间不足。

可在manifest.settings.lyricMode明确选glyph/line/assemble：逐字按字词时值原位描显；逐句整句共享入场；组句各词独立浮现与聚拢。这三种共用驻留规则，不能只换透明度速度。减少动态效果直接显示完整句并停下局部运动，N+2规则不变。

发声点与人物/镜头共享变换，包括头部摇曳和呼吸，但旧字不会继续跟随人物。人物背对观众，仍不声称做了精确口型或音高同步。motion控制人物与窗帘；showTranslation/showTitle分别控制译文与歌曲名。

## 源码与重新打包

`renderer.js` 组装场景，`scenery.js` 负责原画构图，`puppet.js` 负责人物网格，`timeline.js`负责人物发声包络，`coordinates.mjs`绑定发声点，`lyrics.js`选择夜景构图与配色，`flow.mjs`编译驻留字位，`journey.mjs`编译真实字形运输路径与姿态，共享`lyricImprint/`负责字体测量、缓存、三语法基础和N+2退场。

交付的 `source/` 已包含 `manifest.json` 和 `puppetData.js`，修改 JS 后可在 Folia 仓库中运行：

```powershell
npm run style:pack -- <source目录> <输出目录>/nightingale.folia-style.json
npm run style:check -- <输出目录>/nightingale.folia-style.json
```

若从原始壁纸重新准备素材，需 Python/Pillow、FFmpeg 和 [RePKG](https://github.com/notscuffed/repkg)：

```powershell
python style-packs/nightingale/prepare.py 'D:\Steam\steamapps\workshop\content\431960\3448877775' --repkg <RePKG.exe路径>
npm run style:pack -- style-packs/nightingale output/playwright/humming/nightingale.folia-style.json
node style-packs/nightingale/bundle.mjs output/playwright/humming/nightingale.folia-style.json <交付目录>
```

`bundle.mjs` 使用已经生成的 `dist-style-studio/StyleStudio.html`；没有该文件时先运行 `npm run style:build`。原 Steam 文件只读，临时转换文件自动清理。生成的原画素材、manifest 和网格数据在本目录 gitignore 中，独立交付包包含这些本地结果。

## 素材和技术来源

- 原画：Rella；壁纸项目署名：夜莺Night。来源为用户提供的本地 Steam Workshop `431960/3448877775`，对应 [Workshop 页面](https://steamcommunity.com/sharedfiles/filedetails/?id=3448877775)。本包保留署名，不改变原素材的权利归属；未将这些素材作为 Folia 的通用内置资源发布。
- TEX 解码使用 [RePKG](https://github.com/notscuffed/repkg) v0.4.0-alpha，仅为本地制作工具，未捆绑其可执行文件。
- MDL 格式布局参考原始数据和 [pkg_parser 的 mesh 格式说明](https://github.com/wqLouis/pkg_parser/blob/69fc3b17a0d21a6d6fcdc82b3f8c8366a88b095a/src/pkg_parser/mdl_parser/mesh.rs)。此处仅提取本场景的网格，未实现通用 Wallpaper Engine 播放器。
- 动作、音符流和 Folia 接入代码由本次制作新增。`VERIFICATION.md` 记录实际验证结果和未覆盖范围。

已有本地转换资产时可运行`python style-packs/nightingale/prepare.py --reuse-assets`更新生成的manifest，无需重新提取壁纸。交付source中的lyricImprint是完整可重打包的共享源码。

## 本次 motion plan

- 字形可见地从每次出发时的角色发声点附近生成，沿冻结的路径输送；可借绘光的路径和独立时序，不照搬持续漂移。
- 真实字词时序按句时长比例放出并预留运输时间，短句压缩行程；不声称准确音高或BPM。
- 到达对应位置时减速停止，再开始单轴至多2.6px微浮。后续字继续流出，已落定文字不移动让位。
- N+2触发0.9秒整句淡出，N+1出现时保留完整旧句；减少动态效果跳过运输、整句静止显示。
- 长词/密集歌词及大字号可能在运输时穿行，驻留点独立避让；以VERIFICATION.md的实际采样记录为准，不宣称任意输入全程零碰撞。
