# Folia 独立渲染器风格包 · API 2

## 个性与样式

- **个性（personality）**：商籁、凝彩、绘光、花火、町景、雾笺这类完整视觉设计，组织主体、场景、运镜、材质与歌词。
- **样式（lyric-template）**：流光、心象、云阶、浮名、倾诉、回环、莫奈、时计、群唱、镜台、静止这类歌词呈现模板，可用于构建个性。分类按用途，不按代码量或画面元素数量。
- 随机是播放选择，风格包入口是容器，两者不属于上述内置设计。

API 1/2 新包可写 `kind: "personality" | "lyric-template"`；建议新交付明确填写。可选 `lyricTemplate` 记录十一种样式之一的 ID（例如 `classic`），仅表示参考来源，不自动加载或混合内置渲染器。未知类别和将 `hanabi`、`random` 等非样式 ID 作为模板都会拒绝。

缺省 kind 的旧包继续接受，按个性兼容显示，不修改其内容、版本、ID 或存储键。旧版 validator 不一定认识新元数据，使用新增字段的包需要本次更新后的播放器/Studio。类别不代表格式或审美已验收。

MCP `folia_style_catalog` 列出分类与真实源码；完整准则见 [个性与样式](../skills/folia-style-art-direction/references/taxonomy.md)。逐字、逐句、字词组句是另一条歌词释放轴，不能和个性/样式混淆。Studio 提供纯歌词起点；CLI：`style:new <新目录> <id> lyric-template`。

风格包包含完整渲染代码、设置和内嵌素材。作者可用 Agent 生成逐字排版、运镜、转场、粒子与 WebGL 着色器；Folia 提供歌词/播放数据、装载、运行边界和验收工具。独立的 **StyleStudio.html** 与实际播放器使用相同的 Worker 运行时。

参考 [内置风格分析](style-pack-design-reference.md) 与 [Agent 指南](style-pack-agent.md)。旧图层格式仍可导入，见 [v1](style-packs-v1.md)。默认示例 **PRISM** 是可全部替换的独立程序，不是作者必须沿用的模板。

## 使用与工具

在命令面板搜索“风格包”，导入 `.folia-style.json` 后点“应用”。Web / Electron 均支持，无需开启 Folium。当前包随 `visualizerTunings.stylePack.pack` 进入外观备份、同步和 OBS 配置。安装库是本机收藏，最多 12 个；浏览器存储配额也可能先用尽。写入失败保留原库。删除收藏不改变已应用内容；同 ID 导入替换收藏，需再次应用才改变舞台。

```sh
npm ci
npm run style:studio
# 已有 Vite 时直接打开 /style-studio.html
npm run style:new -- my-stage my.stage
# 修改 my-stage/renderer.js、manifest.json，可导入本地模块
npm run style:pack -- my-stage my-stage.folia-style.json
npm run style:check -- my-stage.folia-style.json
npm run style:build
```

`style:pack` 把本地 JS 依赖编译成单个 IIFE。`style:check` 只校验格式，不执行程序。`style:build` 生成 `dist-style-studio/StyleStudio.html`，连同 Schema、API 类型、参考程序、文档和许可证分发。支持 OffscreenCanvas/Worker 的现代 Chromium 浏览器可双击离线运行，无需 Node、登录平台或启动 Folia。

Studio 提供 JavaScript 编辑、包清单 JSON、播放/暂停/跳转、横竖屏、明暗、减少动态效果、四种歌词场景、封面加载、PNG 和验收报告。代码错误显示堆栈。测试数据是原创文字与合成分析信号，不播放声音。显示的 Worker CPU p95 不是实际帧率。

### 视频 → Agent → 风格包

打开“视频效果参考”，载入本地视频（浏览器可解码、最多 250 MiB），选择最多 60 秒片段，提取 8 个等距帧。在任意视频时刻添加效果说明，导出含 JPEG、准确时间点、视频元数据、标注和 Agent 任务说明的 ZIP。视频留在本机，不上传服务端。

将原视频、参考 ZIP、规范和 API 类型交给 Agent。Agent 分析视觉规则并编写渲染代码，再导回工具对照视频。取帧是辅助证据，**不是自动镜头检测，也不是从视频恢复源码**；快速转场仍需观看原视频。视频可独立播放，舞台时间轴用于调试生成程序。

## 文件协议

UTF-8 JSON，总大小 ≤ **4 MiB**，未知字段拒绝。机器规范为 `renderer-pack.schema.json`（源头 `src/stylePacks/code/schema.ts`）。

| 字段 | 内容 |
| --- | --- |
| `format` / `schemaVersion` | `folia-style` / `2` |
| `id`, `name`, `version`, `author`, `description?` | id 为小写字母起首的 3–64 位字母/数字/点/短横线；版本三段数字；名称与作者各 1–80 字符，描述最多 400 字符 |
| `palette` | background / primary / secondary / accent；六位十六进制或 `@background` 等主题引用；代码自行解析 token |
| `renderer` | `{apiVersion:2, code:string}`；代码最多 1,048,576 字符，无顶层 import/export；调用 `FoliaStyle.define` 一次 |
| `settings?` | 最多 64 个字符串/有限数字/布尔值；字符串最多 2,000 字符 |
| `assets?` | 最多 32 项 `{id,mime,data}`；唯一 id，PNG/JPEG/WebP/WOFF2，纯 Base64；单项 Base64 最多 3 MiB 字符且受包总限制 |

`folia.prism`、`folia.nocturne` 为保留 ID，新作品使用自己的 ID。不要包含访问令牌、音乐文件或源站 URL。

## 渲染接口

完整字段见随软件提供的 `renderer-api.d.ts`：

```js
FoliaStyle.define(context => {
    const ctx = context.canvas.getContext('2d'); // 也可 webgl / webgl2
    let scene;
    return {
        update(next) { scene = next; /* 编译排版/字形/镜头 */ },
        render(frame) { /* 根据 frame.time 直接求当前帧 */ },
        dispose() { /* 释放自建纹理和资源 */ }
    };
});
```

- `context.canvas` 为 OffscreenCanvas，像素尺寸由宿主维护。resize 后作者负责重建投影和图集。`context.cover` 是随歌曲更新的 ImageBitmap 或 null，每次从 context 读取，不要析构后保存引用，也不要自行 close。settings、palette、assets 在初始化时提供。
- `update(scene)` 在首次渲染前及歌词/元数据变更时调用。包含 title/artist/album/duration 和整首 lines。每行提供 text/translation/start/end/chorus、原始 words 与播放器规则产生的 glyphs。词内字素时间可能由词时间等分，不应声称源歌曲具有更高精度。
- `render(frame)` 包含绝对歌曲秒数 time、index（无当前行时 -1）、paused、width/height（位图像素）、dpr、0–1 audio 与 32 项 spectrum、主题颜色、主/字幕字体及缩放、当前/前后句、translation、showText、reducedMotion。尊重隐藏歌词/译文与减少动态效果。暂停不自行推进时钟。
- 方法可返回 Promise，但一次渲染超过 **2 秒**会终止 Worker；初始化上限 **10 秒**。正常帧应远低于故障阈值。绘制最多 30 fps，最长边 1920，DPR 最大 2。后台不发送帧，暂停/静态时只在变化后重绘，每次最多一个在途请求。
- WOFF2 可用 Worker 的 FontFace；图片通过 atob → Uint8Array → Blob → createImageBitmap 解码。依赖须支持 Worker/OffscreenCanvas；直接依赖 document 的库不能原样使用，须作者适配并实测。
- 系统字体按字体栈解析；宿主上传的歌词字体由宿主读取字节并桥接至 Worker，不进入分享包，加载完成后重建排版。网页 CSS 从远端加载的字体不自动复制，作者需要在包内提供对应资源或接受字体栈回退。字体桥接允许 10 秒加载时间。

## 运行边界

程序在 `sandbox="allow-scripts"` 的不透明来源 iframe 内的专用 Worker 运行。CSP 禁止网络连接和远程脚本，仅允许本地 data/blob 素材。不提供 DOM、主进程、账户、播放器控制、存储或文件系统接口。宿主只传白名单视觉数据，不传 provider、歌曲地址或 token。

Worker 的死循环可被超时终止；这是故障隔离，不是运行任意敌对程序的完整资源配额系统。大量 GPU 分配仍会影响设备，作者必须做性能验收。语法错误、Promise rejection、运行错误和超时均停止 Worker；主播放器回退 Still，音频继续。换包可重试。卸载移除 iframe、RAF、观察器、监听与 blob URL，并停止 Worker。v1 保持 Canvas 2D 路径。

## 验收标准

| ID | 检查内容 | 通过条件 |
| --- | --- | --- |
| P01 | 格式/安装 | 校验通过；未知版本、超限、重复素材 ID、未知字段失败；无效导入不破坏已有包 |
| P02 | 持久化/迁移 | 应用→刷新保留；导出/重新导入与外观备份恢复内容；存储满保留旧库 |
| P03 | 同源运行 | Studio/播放器使用同一包、媒体、字体、时刻和运行时；差异记录环境 |
| P04 | 自动冒烟 | 3 尺寸 × 4 场景 × 5 时刻 = 60 次真实 Worker 渲染通过；报告 CPU p95 |
| P05 | 确定性 | 2 秒→18 秒→2 秒最终 PNG 相同；镜头/粒子不依赖累计历史；暂停不漂移 |
| P06 | 动态设计 | 连看至少 3 次切句和间奏；镜头、图形、逐字入场/强调/退场形成明确风格；不无故丢歌词 |
| P07 | 可读性 | 1280×720、390×844、320×568，长文本、多语、缺歌词、明暗和字号缩放；不能靠极小字号通过；译文可读 |
| P08 | 视频参考 | 用户指定关键效果逐条有时间点、实现说明与对照；区分观察/推测，列差距；换歌词也能工作 |
| P09 | 实际播放 | 播放/暂停/前后跳转/切歌及面板、进度、返回可用；画布不拦截指针 |
| P10 | 故障/隔离 | throw、语法错误、死循环可诊断并停止；外部请求被拒绝；主页面继续响应 |
| P11 | 生命周期/性能 | 切包 20 次无旧 Worker/监听增长；1280×720 连续 60 秒，30 fps 目标帧间隔 p95 ≤40 ms，记录设备；CPU 不代替帧率 |
| P12 | 工具/交付 | 断网双击 HTML 可编辑/预览/取视频帧/截图/导出；附包、源码、许可证、报告和待验项 |

自动报告始终 `accepted:false`：机器渲染成功不能判定审美、视频相似性或所有设备的表现，仍需人工验收。
