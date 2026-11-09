# 场景引擎：怎么加一个场景

场景是播放页变成的一个地方（影厅、天台……），和今天的「歌词样式 + 背景」并列：播放页要么放歌词样式和背景，要么放一个场景。场景可以借用户的歌词样式和背景，放到自己的表面上（影厅的荧幕）。画法随意：3D、2D、别的引擎都行，宿主只给一个盒子。

设计和决定：`claude-notes/scene-engine-design.md`（底稿）、`claude-notes/scene-engine-decision.md`（两者不一致时以它为准）。

## 文件

```text
src/components/scenes/
  definition.ts      契约：SceneManifest、SceneDefinition、SceneContext、SceneRuntime、锚点、声音接口、checkSceneManifest
  registry.ts        名单：import.meta.glob('./*/entry.ts') 发现内建场景；registerScene / unregisterScene 给模组和数据包；useChosenScene
  engine/            宿主
    SceneHost.tsx      App 里挂播放页画面的地方；没选场景时就是原来的 VisualizerRenderer
    sceneSignals.ts    VisualizerSharedProps → 场景信号；两帧之间的变化 → 事件；鼠标
    lyricPhase.ts      歌词阶段（前奏、唱着、句间、间奏、尾奏、纯音乐）
    scenePlacement.ts  借来的歌词样式、背景放哪；显示时场景接不接用户选的那一个
    surfaceQuad.ts     盒子贴到四个角上的 CSS matrix3d
    queueEnd.ts        「歌单放完」，最后一首放到结尾时由 usePlaybackQueueController 的 stopAtQueueEnd 发出
    sceneEvents.ts     场景的监听和订阅：抛错就退回，停下时一起放掉
    sceneSound.ts      声音接上来的地方：播放页上的房间声（src/services/sceneSound/），其余是空实现
    sceneTheme.ts      歌曲那对亮/暗主题（App 从 useThemeController 传进来）配上歌词字体；借到表面上的歌词样式用哪个主题
  kit/               可选工具箱（用 three.js 的场景才用）
    threeStage.ts      透明画布、尺寸、分辨率倍数、project / projectQuad
    camera.ts          viewpointRig、pathRig、phaseDirector、chooseDirectorShot
  settings/
    useSceneSettingsStore.ts  选了哪个场景、每个场景的画质 / 视点 / 设置值（键 scene_id、scene_options）
    useSoundTracingStore.ts   声线追踪开关和耳机/音箱，所有场景共用（键 scene_room_sound、scene_room_output，沿用旧名）
    SceneRow.tsx              播放面板外观区的「场景」一行，「场景设置」小浮层是 SceneSettingsPanel.tsx
    SceneWindow.tsx           设置「外观」页「场景」一行打开的窗口，照歌词样式工作台：场景卡、「场景设置」「声线追踪」两个标签
    SoundTracingGroup.tsx     场景窗口「声线追踪」标签里的一组
    SeatMap.tsx               座位图
src/types/sceneIds.ts  内建场景 id 清单和 id 规矩
src/services/sceneSound/  房间声：acousticsTypes.ts（和声学进程的约定）、acousticMaterials.ts（声学材质表）、
                          roomIr.ts（响度补偿、缓存键）、roomStage.ts（播放链里的两路卷积）、sceneSound.ts（ctx.sound）
```

接入点（删掉 `scenes/` 和这几处，功能就删干净了）：`src/App.tsx` 挂 `SceneHost`；`src/components/panelTab/controls/AppearanceSection.tsx` 的场景一行和过滤；设置 `AppearancePage.tsx` 的「场景」一行，`SettingsModal.tsx` 里打开 `SceneWindow` 的几行（子视图 `scene`）；`src/components/command-palette/commands/sceneCommands.ts` 和 `index.ts` 里的一行；`visualConfigTransfer.ts`、`appearanceCodec.ts`、`appearanceImportPlan.ts` 的场景字段；`usePlaybackQueueController.ts` 的 `announceQueueEnd()`；`src/services/sceneSound/` 和 `usePlaybackAudioBridge.ts` 里的 `registerRoomSlot` 一行；三份语言文件的 `ui.scene*`、`ui.soundTracing*` 和 `commandPalette.commands.scene-*`。

## 约定（定了就不改）

- 清单是纯数据，能原样写成 JSON；内建场景 `entry.ts` 里的清单和数据包的 `scene.json` 是同一个形状，用同一个 `checkSceneManifest` 检查。
- 坐标单位米，Y 朝上，右手坐标，和 glTF 一致。
- 听者和摄像机分开：`ctx.sound` 不读摄像机，听者是视点锚点或显式位置。
- 术语：固定的观看位置叫**视点**（`viewpoint`），可以自由走动的范围叫**活动区**（`roamArea`，还没做）。影厅界面上视点显示为「座位」；影厅里真实的椅子模型仍叫 seat。
- id：内建 `cinema`（小写开头，字母数字）；模组 `mod:<模组>:<id>`；数据包 `pkg:<id>`。`engine`、`kit`、`packages`、`settings`、`editor` 不能当内建 id（它们是本目录的子目录）。
- 锚点命名（数据场景在 Blender 里给空物体起名）：`surface.*`、`viewpoint.*`、`speaker.L/R/C`、`emitter.*`、`path.*`、`slot.*`，`lyricPlace` 写在清单或代码里。
- 版本：`format` 是包格式（现在 1），`engine` 是要求的接口范围（`'^1.0'`），`version` 是场景自己的。1.x 之内接口只增不改。

## 写代码加一个内建场景

下面用 `rooftop` 代表新场景的 id。

1. `rooftop/entry.ts`：默认导出 `defineScene({ manifest, load })`。`load` 用动态 `import()` 拿运行体，第一次显示时才加载：

   ```ts
   // src/components/scenes/rooftop/entry.ts
   import { defineScene } from '../definition';

   export default defineScene({
       manifest: {
           format: 1, engine: '^1.0', id: 'rooftop', version: '1.0.0',
           name: { 'zh-CN': '天台', en: 'Rooftop' },
           lyrics: { style: 'overlay' },
           background: { host: 'none' },
           quality: { default: 'medium', presets: { low: { dpr: 1 }, medium: { dpr: 1 }, high: { dpr: 1.5 } } },
       },
       load: () => import('./rooftopRuntime').then(module => module.createRooftopRuntime),
   });
   ```

2. 把 `'rooftop'` 加进 `src/types/sceneIds.ts` 的 `BUILTIN_SCENE_IDS`。漏了或多了，名单初始化时就抛错。
3. `rooftop/rooftopRuntime.ts`：`(ctx) => ({ frame, resize?, dispose })`。
   - 画布放进 `ctx.container`，或用 `kit/threeStage.ts` 的 `createThreeStage(ctx)`。画布要透明，才能在荧幕处露出下面的背景。
   - 发布锚点：`ctx.anchors.add({ kind: 'viewpoint', ... })` 等。
   - 有表面的场景每帧调 `ctx.surfaces.place('screen', stage.projectQuad(corners))`；看不到时传 `null`。第三个参数 `{ opacity }` 让贴上去的东西变暗或消失（影厅：放映机遮光板关上时）。
   - 有视点锚点（清单写 `viewpoints: 'anchors'`）时，宿主在「场景设置」里自动给座位图；用户选的视点从 `ctx.viewpoints.chosen()` 读，工具箱的 `viewpointRig` 已经在读。
   - 第一帧画好调 `ctx.ready()`。宿主在这之前显示用户原来的歌词样式，最多等 4 秒。
   - 事件用 `ctx.on('songChange' | 'blendStart' | 'lineChange' | 'phaseChange' | 'play' | 'pause' | 'seek' | 'queueEnd', fn)`。事件只报变化，第一帧没有事件：开始时直接读 `ctx.song.current()`、`ctx.lyrics.phase()` 这些。
   - 每帧的 `dt` 是秒，暂停时为 0。不要每帧写 React state。
   - 颜色：`ctx.song.current().theme` 是歌曲的一对主题 `{ light, dark }`，app 切亮暗模式时不变。场景按自己的画面挑一个（影厅暗，用 `dark`）；app 现在的模式在 `ctx.display.isDaylight()`，场景的灯光不该跟它走。
4. 设置和画质只写在清单里（`settings` 用 Folium 的设置表格式，`quality` 三档），值从 `ctx.settings.get()`、`ctx.quality.get(key)` 读；用户改了就在 `onChange` 里就地用新值，场景不重载。
5. 文案：三份语言文件（`en.ts`、`zh-CN.ts`、`in.ts`）的 `commandPalette.commands` 加 `scene-rooftop` 的 `title`、`description`（切换命令按名单自动生成，缺了 `commandRegistryContract.test.ts` 会失败），再更新那个测试的命令顺序快照（确认只多了 `scene-rooftop`）。场景的名字写在清单的 `name` 里，不进语言文件。
6. 只有场景里有用户看不见的逻辑才写单元测试，放 `test/unit/scenes/`。

不用改的：发现、选择器、命令、导入导出、出错时的退路、借来的歌词样式和背景怎么贴，都由名单和宿主处理。

## 借用户的歌词样式和背景

清单的 `lyrics.style` / `background.host` 说能不能借、放哪：

| 写法 | 意思 |
|---|---|
| `'none'` | 不能借；场景里不显示，选择器照常 |
| `'overlay'`（歌词） | 整窗叠在场景上面，背景透明 |
| `'behind'`（背景） | 整窗放在场景下面，场景天空要透明 |
| `{ surface: 'screen' }` | 贴到这个表面上；表面要写在 `surfaces` 里 |

- 场景不自己画歌词、不带自己的背景：歌词样式和背景各是一套，永远是用户选的那个，场景只说放在哪。
  只适合某个场景的样式或背景，照样登记在歌词样式表、背景表里。
- `exclude: ['still', ...]`：贴上去不合适的样式或背景 id。场景、歌词样式、背景三个选择互不影响：选择器永远列出全部（含随机），选了场景也不改不藏；用户选的（或随机抽到的）不合适时，宿主在场景里显示第一个合适的，存着的值不改。
- 表面的 `tone`（`'dark'` 或 `'light'`）：场景在这个表面上的画面是暗还是亮。表面只贴歌词时，借来的歌词样式拿歌曲主题里对应的那一个（和对应的 `isDaylight`），文字配得上场景的画面，不跟 app 的亮暗模式；贴着用户的背景时，就是用户的播放页原样。没写 `tone` 时和播放页一样。影厅的荧幕是 `'dark'`。
- 表面盒子里是一个没改过的 `VisualizerRenderer`，盒子宽等于场景盒子宽，高按表面的 `aspect` 算，再用 CSS 3D 变形贴到四个角上。有背景的表面放在场景画布下面（场景在那里留透明的洞，前排人头能挡住它），只有歌词的放在上面。
- 已知代价：只要背景、不要歌词的表面也挂一整个歌词样式（`showText` 关掉）；借来的内容不受场景灯光影响（影厅在荧幕上另叠一层投影的光：四角暗、闪烁、颗粒、白天被厅灯冲淡）。
- 转头：按住拖动（`ctx.input.look()`，宿主统一做），左右不限，上下到正上、正下为止；不拖、只点时点击照常落到歌词上，拖过之后那一下点击被吞掉。场景自己的画布不接指针。

## 出错时

加载抛错、运行中 `frame` 或事件处理抛错：宿主记一行 `[SceneHost] scene failed`，回到用户原来的歌词样式。盒子里任何画布丢了 WebGL：重新加载一次场景，再丢就回去。

## 开发

- `npm run dev:probe` 打开 `dev-probe.html?probe=sceneHost`：一个 2D 场景（按住拖动荧幕跟着动，借来的歌词样式贴在上面，画布上写着歌词阶段和收到的事件）、一个加载就抛错的场景、「Lose WebGL」按钮；「Cinema」是影厅，右上是座位图。
- 命令面板的「Reload the scene」（`scene-reload`，只在开发版出现）：改了场景文件后重新加载，不用重启 app。

## 还没做的

- 声音：房间声只有音乐（场景清单 `sound.music: 'speakers'`，`speaker.L/R` 锚点，`ctx.sound.setAcoustics` 交房间）；`play()` 小音效、会动的几何（`moveObject`）、跟着镜头走的听者还没做；场景声音开着时「空间」混响还没由场景接管；`ctx.music.character()` 现在全是 0。
- 模组的 `registries.scenes` 和数据包加载器（第三期）。
- 影厅：「两台放映机」现在只是交接开始时换片（只换光的颜色），光束只有一道；照进厅里的光按封面的颜色估，不是荧幕上真正的画面。
- 预览窗、OBS 不挂场景（`ctx.host.kind` 现在总是 `'player'`）。
