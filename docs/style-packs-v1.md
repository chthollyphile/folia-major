# 播放器风格包 v1（基础图层兼容格式）

新作品请使用 [v2 独立渲染器协议](style-packs.md)。本文仅说明仍可导入的旧图层格式；当前默认示例为 PRISM。

风格包是可分享的 `.folia-style.json` 文件。Folia 提供协议、校验器和渲染器，用户可把本文、JSON Schema 和模板交给 Agent，生成自己的播放舞台。风格包支持 Web 和 Electron；不要求打开 Folium 模组开关。

本版改变播放舞台的排版、背景、封面、信息、歌词和音频响应图形。播放、队列、音源、快捷键和应用导航继续由 Folia 管理。任意 JavaScript、自定义着色器、第三方插件和整个应用的控件替换属于现有 Folium 扩展范围，不属于本协议。

## 使用

1. 打开命令面板，搜索“风格包” / `style-packs`，导入文件（也可拖入管理面板）。
2. 点击包旁的“应用”。这会保存当前包并切换到“播放器风格包”歌词样式。
3. 歌词样式窗口中选“播放器风格包”也可管理包；该窗口保持原有预览/保存行为。
4. “导出当前风格包”产生可分享的 JSON。安装库上限 12 个；同 ID 导入替换库中版本，但不会自动替换当前正在使用的外观，需再点应用。
5. 当前包作为 `visualizerTunings.stylePack.pack` 跟随外观配置的备份、导入和 OBS 配置；安装库是本机收藏，不随外观配置整体迁移。删除库中副本不会改变已应用的包。恢复默认使用内置 Nocturne。

## 调试软件

提供独立的 **StyleStudio.html**。双击后在浏览器打开即可离线使用，无需安装 Node、登录音乐平台或启动 Folia。它与播放器复用 `src/stylePacks/render.ts`、`canvasHost.ts` 和 `validate.ts`。

- 左侧可播放、暂停、拖动时间轴，切换横竖屏、明暗主题和减少动态效果。
- 内置示例、无歌词、长文本、多语言测试场景；可加载本地 PNG/JPEG/WebP 封面（最多 8 MiB），它只作为测试媒体，不会打进风格包。
- 右侧编辑 JSON，250 ms 防抖校验后刷新。无效草稿保留最后一份有效预览，禁止导出包和验收报告。
- 导出当前包、PNG 截图和 JSON 验收报告。报告不会把机器渲染成功冒充为视觉验收通过：`accepted` 始终为 `false`，人工完成下表后再确认。
- 时间轴使用原创测试文字和合成分析器值，不播放声音；这是视觉调试器。真实歌曲及暂停/跳转行为在 Folia 中验证。

开发者生成交付目录：

```sh
npm ci
npm run style:build
# dist-style-studio/StyleStudio.html，可将整个目录压缩后分发
npm run style:studio
# 开发时带热更新的调试器；如已有 Vite，用 /style-studio.html
npm run style:new -- my-room.folia-style.json my.room
npm run style:check -- my-room.folia-style.json
```

`style:check` 输出 JSON，成功退出 0，失败退出 1。`style:build` 同时导出 Schema、参考包、本文、Agent 指南和许可证。产物不提交到 Git，发布时应把生成的工具目录作为附件提供。软件源代码仍在项目中。

## 包协议

UTF-8 JSON，自包含，最多 **65,536 字节**。不解析 ZIP、不加载外部资源、不执行代码。无需附带播放器源代码、依赖安装文件或音乐文件。入口是整个 JSON 文件；`schemaVersion: 1` 表示本版协议，未知版本和未知字段全部拒绝。

Schema 的源头是 `src/stylePacks/schema.ts`，由 `style:build` 生成 `style-pack.schema.json`。`src/stylePacks/example.ts` 是完整参考包。运行时与命令行使用同一份 Schema，再补充唯一 ID 和布局边界检查。

| 字段 | 约束 |
| --- | --- |
| `format` / `schemaVersion` | 固定 `folia-style` / `1` |
| `id` | 3–64 位，以小写字母开头，只含小写字母、数字、点、短横线；`folia.nocturne` 是内置保留 ID |
| `name` / `author` | 必填，1–80 字符 |
| `version` | 三段数字版本，如 `1.0.0`；同 ID 显式导入允许升级或降级 |
| `description` | 可选，最多 400 字符 |
| `palette` | 必含 `background`、`primary`、`secondary`、`accent` |
| `layers` | 横屏或缺少竖屏定义时使用，1–32 个图层 |
| `portraitLayers` | 可选，宽小于高时整组替换 `layers`，1–32 个图层 |

颜色为六位十六进制 `#RRGGBB` 或 `@background`、`@primary`、`@secondary`、`@accent`。palette 中的 token 读取 Folia 当前主题；图层中的 token 读取包的 palette，然后解析到宿主主题，不做递归引用。背景色使用 `palette.background`。

### 图层

按数组先后绘制，后者覆盖前者。所有图层必含 `id`、`kind`、`x`、`y`、`width`、`height`、`color`。

- `id`：每组唯一，1–48 位小写字母、数字、短横线，以字母开头。
- `x/y`：左上角占整个画布宽/高的百分比，0–100。
- `width/height`：画布宽/高的百分比，0.1–100。静态矩形必须落在画布内，即 `x + width <= 100`、`y + height <= 100`。
- `opacity`：0–1，默认 1。`radius`：以画布短边的百分之一为单位，0–50，绘制时限制在图层半径范围内。
- `fontSize`：画布短边的百分之一，1–16，默认 4；歌词叠加用户字号缩放。译文额外叠加字幕字号，并使用字幕主题的字体和字重；其他文字使用主主题。包不覆盖用户字体。
- `align`：`left`（默认）、`center`、`right`。
- `source`：`title`、`artist`、`album`、`literal`、`current`、`previous`、`next`、`translation`。文本/歌词图层必填；`literal` 还须非空 `text`（最多 200 字符）。缺少元数据或歌词时绘制空内容。
- `kind`：`rect` 圆角矩形、`ellipse` 椭圆、`cover` 居中裁切封面（缺失时使用颜色占位）、`text`、`lyrics`、`progress`、`spectrum`（32 根柱）。`lyrics` 遵循宿主隐藏歌词设置，`translation` 遵循隐藏译文设置。`progress` 读取真实播放时间和总时长，时长未知时为 0。
- 文本采用 pretext 排版，必要时最多缩小 8 次，裁切在自己的图层内；单字段最多渲染 2,000 字符。极端长内容的可读性需人工检查，不通过缩小到任意字号来保证验收。
- v1 是整行歌词排版与动画，暂未提供逐字着色、字体资源和包内图片。`spectrum` 在有 FFT 数据时使用该数据，没有时各柱为 0；Studio 使用合成数据。

### 动画

可选 `motion` 对象包含全部四个字段：

```json
{ "kind": "float", "amount": 1.5, "period": 4, "signal": "time" }
```

`kind` 为 `float`（垂直位移）、`pulse`（缩放）、`rotate`（摆动旋转）；`amount` 0–30，分别是画布短边百分比、缩放百分比、角度；`period` 0.5–120 秒；`signal` 为 `time` 或 `audio`。time 信号为 `sin(time × 2π / period)`，audio 为夹到 0–1 的音量信号，此时 period 不参与计算。

所有连续动画由播放时间或分析器数据计算，跳转直接重算；暂停不累计自己的时钟。静态模式/减少动态效果时位移归零、缩放为 1、旋转归零，频谱为静态低柱。图层动画可能超出静态矩形，作者必须在最大振幅下验收裁切。

## 生命周期与回退

- 新文件先检查字节数、JSON、Schema 和语义边界，通过后才写安装库；无效导入不改变库和已应用包。
- 安装库写入存储成功后才更新内存状态；存储配额不足时保留原库并提示错误。坏的库记录会被跳过。
- 当前包持久化借用项目已有 tuning 机制。启动时无效当前包回退内置包；运行中渲染异常回退 Still 并记录 `[StylePacks]` 日志。选择另一个包可重试。
- 画布最多 30 fps，并遵守宿主更低帧率限制；DPR 最大 2，最长边最大 1920 像素。暂停/静态模式通过变化事件重绘，后台标签不绘制。
- 卸载清理 RAF、ResizeObserver、时钟订阅和封面事件；每个 renderer 的文字布局缓存最多 128 条。样式切换不触碰音频、队列或平台凭据。

## 验收标准

以下为发布门槛，不是本次所有平台都已经通过的声明。

| ID | 检查方式 | 通过条件 |
| --- | --- | --- |
| P01 格式 | `style:check` | 退出 0；未知版本、未知字段、超限、重复 ID、越界和缺字段全部拒绝并给出路径 |
| P02 安装 | Folia 导入/拖入、重启、替换同 ID | 包可选择；重启保留；替换须显式应用；失败导入保持旧包 |
| P03 迁移 | 导出包后重新导入；外观 JSON/短码导出再导入 | 包内容和所选外观恢复；缺少安装库副本仍能画；小包短码适用，分发优先 JSON |
| P04 同源渲染 | Studio 与 Folia 使用同一包、主题、媒体、时刻和分辨率 | 以同一 Canvas 核心渲染；不同字体/缩放/系统栅格差异需记录，禁止仅凭截图不同判失败 |
| P05 自动场景 | Studio 运行验收 | 3 尺寸 × 4 场景 × 5 时刻 = 60 次渲染无异常；报告包含环境、CPU 渲染耗时及人工待验项目 |
| P06 视觉 | 1280×720、390×844、320×568，明暗、缺封面、长标题、混合语言 | 歌词和元数据能读清；无意外重叠/裁切；不能只靠缩成微小文字通过 |
| P07 时序 | 播放→暂停→拖到句首/句尾→向后跳→切歌 | 暂停后 time 动画不继续；进度和歌词对应宿主；向后跳无旧画面残留 |
| P08 可操作 | 实际播放器 | 播放/暂停、返回、进度、面板和键盘控制可用；canvas 不拦截指针 |
| P09 回退 | 无效文件、无效存储、故障注入 | 旧包保留或内置回退，音频继续；调试器明确显示无效草稿，不导出旧包冒充新草稿 |
| P10 性能 | 参考机器 1280×720 连续播放 60 秒，记录浏览器/设备 | 30 fps 目标下帧间隔 p95 ≤ 40 ms；持续超标则减少图层/字体重排。Studio 的 CPU p95 只是诊断，不等同实际帧率 |
| P11 生命周期 | 连续切换包 20 次并离开播放器 | 无遗留监听/持续增长的画布；后台不绘制；无包触发的网络/脚本执行 |
| P12 工具 | 断网后双击交付的 HTML | 编辑、横竖屏、时间轴、PNG、报告和包导出可用；无需服务器 |

包作者须随作品提交：风格包、Studio 验收报告、横竖屏截图、手工检查结果与测试环境。Agent 只需这些公开契约，不应修改 Folia 内部模块。

## 代码接入点

- `src/stylePacks/`：协议、校验、渲染、管理和独立工具。
- `src/components/visualizer/stylePack/entry.tsx` / `tuning.ts`：统一歌词样式注册、设置和外观导入导出；固定路径是 registry 自动发现的要求。
- `src/types/visualizerModes.ts`：登记内置承载模式 `stylePack`。
- `src/components/command-palette/commands/stylePackCommands.ts`：管理入口。
- `dev/stylePacks/`：生成工具、脚手架、命令行校验；`test/unit/stylePacks/`：协议和状态测试。

不改 `App.tsx` 的播放流程，不新增 Electron 权限。
