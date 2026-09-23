# Folia Mods

> **实验性功能，默认关闭。** 需先在「设置 → 实验室 → 模组系统」中开启，命令面板的「模组」命令与模组
> 管理面板才会出现，加载器也才会扫描目录。开关关闭时**不加载任何模组代码**——不是隐藏 UI，而是已启用
> 的模组也会被停用（执行其 deactivate），相关 IPC 一律拒绝。开关本身不替代单个模组的启用确认。
>
> `apiVersion 1` 尚未定稿：API 形状、权限集合与加载器行为都可能在后续版本中变更，届时已安装的模组可能
> 需要跟随更新。请勿在此基础上做对外分发的长期承诺。

Folia 模组（Mod）目录。桌面端启动时，加载器会扫描此目录（以及打包后的用户数据目录），
将每个含 `mod.json` 的子目录作为一个模组加载。

## 安全声明（重要）

模组是**可信代码，不是沙箱**：加载后运行在应用主进程中，拥有完整 Node.js 运行时权限，可访问
文件系统、进程与应用设置（包括 AI 服务地址等）。`mod.json` 的 `permissions` 字段是功能开关约定
（fail-closed 拒绝未声明的 API 调用），**不构成安全边界**。

- **两道开关**：实验室总开关决定加载器是否工作；总开关开启后，单个模组仍默认禁用，需逐个确认启用。
- **默认禁用**：所有模组发现/安装后均处于禁用状态，需用户手动启用。
- **启用需二次确认**：点击启用会弹出**主进程原生确认窗口**，列出模组 id、安装位置、声明权限与内容指纹，
  默认按钮为「取消」。确认窗口刻意不在渲染进程绘制——已加载模组的 visualizer 与主界面同处一个渲染进程，
  渲染端弹窗可被模组代码伪造或自动点击。
- **信任绑定到内容**：确认结果与模组目录的内容摘要（sha256）一并保存。任何文件变化（拖入新版 zip、
  手动改文件）都会使摘要失配，加载器随即**撤销授权并保持禁用**，面板提示需重新确认。因此"覆盖升级已启用
  的模组"不会绕过确认。
- 仅安装并启用可信来源的模组；启用前请审阅其 `index.cjs` 与 `visualizer.mjs`。

## 依赖 ffmpeg（导出类模组）

- 查找顺序：`FOLIA_FFMPEG_PATH` 环境变量 → 应用目录下 `ffmpeg-8.1.2/ffmpeg(.exe)` → 打包资源目录下 `ffmpeg/ffmpeg(.exe)` → 系统 PATH。
- 导出类模组需要**完整** ffmpeg（`rawvideo` demuxer、`prores_ks` 或 `libvpx-vp9`、MOV/WebM 封装）。
  应用自带的 `ffmpeg-audio/` 是只含 FLAC/WAV 的音频转码运行时，不在上面的查找顺序里，也无法用于导出。
- 输出目录：`视频/Folia Exports`。
- 透明通道：Windows 完整支持；Linux/macOS 下捕获帧可能不含 Alpha，导出会在返回值中给出警告。

## 目录结构

扫描目录的顺序见 `electron/modSystem/modSystem.cjs` 的 `getModsDirectories`：开发版先扫仓库
`mods/`，打包版先扫 `userData/mods`，再是 `resources/mods`；**同 id 只认先扫到的那一份**，
后面目录里的同名模组会被静默跳过。所以「改了仓库里的文件却没生效」时，先确认 `userData/mods`
下没有同 id 的旧副本——面板显示的版本号是唯一可靠的判据。

```
mods/
  your-mod-id/            # 目录名任意，模组身份以 mod.json 的 id 为准
    mod.json              # 必填：manifest
    index.cjs             # 默认入口（可在 manifest 中改）
```

## 从 UI 安装与管理

- **打开模组目录**：模组面板右上角「打开模组目录」按钮，在文件管理器中打开用户模组目录 `userData/mods`。
- **拖放 zip 安装**：把模组 `.zip` 拖到模组面板即可自动安装；支持 `mod.json` 位于根目录或唯一顶层文件夹两种结构。
  - 安装包须为 `.zip`；内含安全校验（拒绝路径穿越/绝对路径），写入前校验 manifest。
  - 体积限制：压缩包 ≤ 64 MB，解压后总计 ≤ 64 MB，单文件 ≤ 32 MB，条目数 ≤ 2000。超限直接拒绝，
    压缩炸弹在解压前即被拦下。
  - **原子安装**：先解压到 `userData/mods/.staging/` 临时目录并校验（入口文件、声明的 visualizer 文件都
    必须存在），通过后才换入正式目录；失败则回滚，旧版本原样保留。
  - 已安装同 id 模组时自动覆盖（拖包即升级）；升级后内容摘要改变，模组会保持禁用直到你重新确认。
  - 安装后自动重载并刷新列表。
- 用户模组目录在打包版为 `%APPDATA%\Folia\mods`（只读的应用安装目录不用于安装模组）。

## manifest（apiVersion 1）

```json
{
  "id": "your-mod-id",
  "name": "显示名称",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "可选",
  "description": "可选",
  "entry": "index.cjs",
  "depends": ["base-mod", "other@^1.2.0"],
  "permissions": ["render.export"]
}
```

- `id`：`^[a-z0-9][a-z0-9-]*$`，全局唯一。
- `version`：`MAJOR.MINOR.PATCH`。
- `depends`：模组 id 或 `id@^1.2.3`（仅支持 `^` 与 `*`）。缺失依赖、版本不符、依赖成环，或依赖未被启用时，
  **只有该依赖子图内的模组**不加载并标记 `dependency-failed`，其余模组不受影响；依赖解析只以已启用模组为
  起点，禁用的模组无论声明什么都不会影响加载。
- `permissions`：当前可用权限：
  - `render.export`：启动离屏渲染导出（透明背景视频）。
  - `filesystem.data`：读写模组私有数据目录（`storage.data.*`）。
  - `runtime.playback`：读取播放快照（`api.runtime.getPlaybackSnapshot()`）。
  未声明的权限调用会在**调用点**被拒绝（fail closed），抛出 `permission-denied:<权限名>`；
  命令声明的 `permissions` 另需是 manifest `permissions` 的子集，否则执行时即被拒。

## 入口契约

`entry` 文件导出单个函数，加载器在隔离错误边界内调用：

```js
module.exports = function activate(api) {
    api.log.info('loaded');

    // 清理钩子：模组被禁用、重载或应用退出前执行。activate 直接 return 一个函数
    // 等价于注册一个 onDeactivate。定时器、监听器、子进程都应在此释放——加载器
    // 不会替你回收这些闭包。
    const timer = setInterval(poll, 1000);
    api.lifecycle.onDeactivate(() => clearInterval(timer));

    api.commands.register({
        id: 'my-command',
        label: { 'zh-CN': '我的命令', en: 'My command' },
        description: { 'zh-CN': '说明', en: 'Description' },
        permissions: ['render.export'],
        params: [
            { key: 'width', label: { en: 'Width' }, type: 'number', min: 320, max: 3840, defaultValue: 1920 },
            { key: 'mode', label: { en: 'Mode' }, type: 'select', options: [{ value: 'a', label: { en: 'A' } }] },
            { key: 'enabled', label: { en: 'Enabled' }, type: 'boolean', defaultValue: true },
            { key: 'name', label: { en: 'Name' }, type: 'text' },
        ],
        run: async (params) => ({ outputPath: '...' }),
    });
};
```

- 命令自动显示在「模组」面板 tab 中并渲染为参数表单；执行经 IPC 回主进程，权限在加载器侧校验。
- `api.lifecycle.onDeactivate(fn)` 注册清理回调；禁用/重载/退出前按注册的逆序执行，单个回调抛错不影响其余。
- `api.runtime.getPlaybackSnapshot()` 返回渲染端推送的当前歌曲/歌词/主题快照；需要 `runtime.playback`。
- `api.render.exportVideo(spec)` 启动导出会话；需要 `render.export`。
- `api.storage.data.get/set/has/delete` 为模组私有键值持久化；需要 `filesystem.data`。
- 重载会清除**整个模组目录**的 `require` 缓存，因此改动 `index.cjs` 之外的辅助模块同样生效。

## 样例模组

- `sample-aurora-visualizer`：虹光——当前句居中，逐字虹光扫过，纯 DOM 无依赖。
- `sample-transparent-mov-export`：将当前歌曲的歌词动画按**当前动画模式与参数**原样渲染（仅去背景），导出带 Alpha 通道的透明视频。
- `k3panel`：商籁（sonnet）深度精调面板，暴露相机/逐字运动/视差/转场等 11 个原版设置未提供的实时倍率参数。
- `cinerama`：巨幕（Cinerama）——舞台大屏。参考商籁的确定性编排脚手架：为每句歌词随机抽取切分（`cineramaSplit`）、排版（`cineramaLayout`）、动画（`cineramaAnimation`）与视觉处理（`cineramaTreatment`：样式按概率权重抽一个 —— 大字报 / 小字报 / 斜切丝带，另有一条**叠加**轴跑马灯带）四条轴；设置面板也由模组自带，挂在歌词动画设置的模式选择器下面（宿主锚点见下）。详见 `cinerama/README.md`。

## 渲染端实时调制（modulate 参数）

命令参数可声明 `modulate: { mode: 'sonnet' }`，使其成为**渲染端实时调制旋钮**：拖动滑块直接写入渲染进程的共享调制 store（`src/mods/visualizerModulation.ts`），动画下一帧即生效，不经 IPC、不重建渲染上下文。任何 visualizer 模式都可接入该通道（内置模式已接入：sonnet）。

写入是通用的，`mode` 填哪个模式就写进哪个键。模组模式同样可以**读**这个通道：`mount` 的 props 带
`getModulation()`，返回本模式当前的调制值（`src/mods/modVisualizers.tsx` 订阅后经 ref 暴露，稳定的
getter，拖滑块不会重建贡献层）。**要每帧读，不要在 mount 时缓存结果**——缓存住的就永远是挂载那一刻的
值。导出窗口没有命令面板，调制值恒为空对象，所以模组必须能在缺省下正常工作（各旋钮取恒等值）。
面板滑块初值由命令的 `defaultValue` 给出，调制值不持久化，重启应用回到默认。

模组想在自己的 UI 上读写这个通道时注意：宿主**没有**把 store 挂到全局，能拿到的是 props 上的
`getModulation()`（只读本模式）。需要独立持久化的模组设置，自己写自己的 localStorage key 即可
（例如 `cinerama/settingsPanel.mjs`）。

## 稳定性约束

- 单模组加载失败不影响宿主应用与其他模组；依赖图损坏只波及相关子图。
- 每次加载周期先对当前已激活模组执行 deactivate，再重新激活，避免重载叠加出多代定时器与监听器。
- 导出会话全局互斥（`export-already-running`）；上限 3840×2160、60fps、15 分钟。
- 取消/失败时清理 ffmpeg 进程、离屏窗口与半成品文件。

## 自定义歌词动画（visualizer 贡献）

> 开发新特效前先读 `cinerama/mod-visualizer-effects-playbook.md`：需求要一次给全什么、结构怎么分层、
> 交付前怎么自检、常见症状的根因表，都是从巨幕模组的开发过程里抽出来的经验。

模组可向播放器贡献**新的全屏歌词动画模式**，与内置模式并排出现在动画选择器中，可用于播放、预览与透明视频导出。需要权限 `visualizer.register`。

manifest 声明：

```json
{
  "permissions": ["visualizer.register"],
  "visualizers": [
    { "id": "aurora-text", "entry": "visualizer.mjs", "label": { "zh-CN": "虹光", "en": "Aurora" }, "order": 420 }
  ]
}
```

### 模组模式的设置面板

宿主**不提供**把模组 UI 塞进设置界面的接口：`renderSettingsPanel` 是内置模式在源码里注册的
React 组件，模组拿不到。想要设置界面，有两条路：

- **自带面板 + 宿主锚点**（`cinerama` 走这条）：宿主在歌词动画的模式选择器卡片里渲染
  `<div data-mod-visualizer-settings-slot="<当前 mode id>">`，模组把自己的 DOM 面板插进去。
  这是宿主对模组唯一承诺的 DOM 契约：属性值就是当前模式 id，所以模式判定不必猜文案。
  锚点缺席（旧宿主）时模组应安全退化（面板不出现）；
- **只用命令参数**（`commands` + `modulate`）：完全进宿主界面，但滑块只出现在模组面板里。

`visualizers[].settings` 是声明式 schema（与命令参数同形，number / text / boolean / select，
无 `run` / `modulate`）。宿主**会**照它渲染一组表单（`src/mods/ModVisualizerSettingsPanel.tsx`，
在模式选择器卡片下面，和内置模式的设置卡片同一层），值存在 `modVisualizerSettings`，
经 `props.getSettings()` 逐帧送进贡献层（同样要每帧读、不要在 mount 时缓存）。

宿主侧的读取入口只有一个：**贡献层的 `props.getSettings()`**。
`src/mods/modVisualizerSettings.ts` 里的 `useModVisualizerSettings`（React 钩子）是**给宿主界面用的**
（`ModVisualizerSettingsPanel` 与 `modVisualizers.tsx` 消费它），模组拿不到这个 store ——
模组要值就走 `props.getSettings()`，别去 import 它。同理 `ModParamFields` 的
`formatModParamNumber` 是表单自己的数字格式化，不是模组侧的 API。

所以两条路**只能选一条**：自带面板的模组不要声明 `settings`，否则界面上会出现两组同样的旋钮，
而宿主那份写的是自带面板不读的 store——表现为「多出来那组拖了没反应」（`cinerama` 走自带面板，
`mod.json` 里因此不声明 `settings`）。自带面板的值由模组自己持久化，并且要保证 `mount` 里
每帧读得到，只写不读等于面板无效。

`entry` 是**浏览器 ESM 模块**（经白名单协议 `folia-mod://` 由渲染端动态加载，仅在渲染进程执行，不在 Node 中运行），契约：

```js
export default {
  mount(element, props) {
    // element: 宿主 div，自行构建 DOM
    // props: { lines, currentLineIndex, currentTime(MotionValue), theme, songTitle,
    //          transparentSurface?: boolean,               // 宿主给的是透明表面
    //          background?: VisualizerBackgroundConfig,    // 「背景类型」配置，宿主已渲染
    //          getModulation?(): Record<string, number>,
    //          getSettings?(): Record<string, unknown>, ... }
    // 连续时间通过 props.currentTime.on('change', cb) 订阅，返回取消函数
    paint(props.currentTime.get());
    const off = props.currentTime.on('change', paint);
    return () => { off(); element.replaceChildren(); }; // 可选 disposer
  },
};
```

规则：

- 模式 id 自动加前缀 `mod:<modId>:<id>`，绝不可能覆盖内置模式（流光/心象/云阶/浮名/莫奈/群唱/倾诉/回环/镜台/时计/商籁）。
- 协议只读、只放行 `.js/.mjs`、只服务已启用且加载成功的模组目录；路径穿越一律 403。
- URL 带内容摘要版本号（`?v=<digest>`）：模组代码变化后即视为新模块，规避浏览器 ESM module map 的缓存，
  "重新加载"才真正加载新代码。
- 透明视频导出窗口没有 preload（无法访问 `window.electron`），其可用的模组 visualizer 由主进程随渲染配置
  一并注入，因此 `mod:` 模式在导出中同样可用。
- 显示名取 label 映射（`zh-CN` → `en` 兜底），无需触碰应用 i18n 文件。
- 单个贡献加载失败仅跳过自身，不影响内置模式与其他模组。

样例：`sample-aurora-visualizer`（虹光——当前句居中，逐字虹光扫过，纯 DOM 无依赖）。

### 宿主替模组模式渲染的两层

模组模式套的是和内置模式**同一个外壳**（`VisualizerShell`），所以有两层由宿主渲染、纯 DOM 的贡献层拿不到：

| 层 | 宿主实现 | 模组侧要做什么 |
| --- | --- | --- |
| 「背景类型」定义的背景 | `VisualizerBackgroundRenderer`，外壳缺省就挂（`renderBackground`） | 画满整屏且不透明的贡献层必须**自己让位**（配置见下），否则用户选的背景永远被盖住；巨幕就是这么做的（屏面填充让位，扫描线/暗角仍在） |
| 底部字幕（翻译 / 下一句预览） | `VisualizerSubtitleOverlay`，字号缩放、透明度、底栏偏移、模糊、内容口径全走宿主的字幕设置 | 什么都不用做。底部自己有内容的贡献层要往上让——这一层盖在模组画面之上 |

背景配置有**两个形态**，别混着用：

| 形态 | 是什么 | 什么时候用 |
| --- | --- | --- |
| 快照 | `props.background`（整份配置）与 `props.transparentSurface`（= `background.transparent`） | 只在 `mount` 那一刻读；旧宿主只给这两个 |
| 通道 | `props.getBackground()` / `props.getTheme()` | **每帧**读；mount 之后要跟随用户设置就只有这一条 |

- `mount` **不会**因为用户改了背景/主题而重跑，所以「每帧读 `props.background`」是读不到新值的——
  它始终是挂载那一刻那份快照。要跟随用户设置必须走 getter（巨幕用的就是这条，
  见 `cinerama/visualizer.mjs` 的 `readBackground`：`getBackground()` 缺席时退回快照）。
- **透明表面下没有可透出的背景**（背景渲染器直接返回 null），所以透明导出不会因为多垫这一层而丢掉
  Alpha 通道。
- 旧宿主不传 `background`（只有 `transparentSurface`），也不传 getter：按「宿主没有背景」处理，
  贡献层维持自己画背板的行为。
