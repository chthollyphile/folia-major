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

- 查找顺序：`FOLIA_FFMPEG_PATH` 环境变量 → 应用目录下 `ffmpeg-8.1.2/ffmpeg(.exe)` → 系统 PATH。
- 输出目录：`视频/Folia Exports`。
- 透明通道：Windows 完整支持；Linux/macOS 下捕获帧可能不含 Alpha，导出会在返回值中给出警告。

## 目录结构

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

## 渲染端实时调制（modulate 参数）

命令参数可声明 `modulate: { mode: 'sonnet' }`，使其成为**渲染端实时调制旋钮**：拖动滑块直接写入渲染进程的共享调制 store（`src/mods/visualizerModulation.ts`），动画下一帧即生效，不经 IPC、不重建渲染上下文。任何 visualizer 模式都可接入该通道（内置模式已接入：sonnet）。

## 稳定性约束

- 单模组加载失败不影响宿主应用与其他模组；依赖图损坏只波及相关子图。
- 每次加载周期先对当前已激活模组执行 deactivate，再重新激活，避免重载叠加出多代定时器与监听器。
- 导出会话全局互斥（`export-already-running`）；上限 3840×2160、60fps、15 分钟。
- 取消/失败时清理 ffmpeg 进程、离屏窗口与半成品文件。

## 自定义歌词动画（visualizer 贡献）

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

`entry` 是**浏览器 ESM 模块**（经白名单协议 `folia-mod://` 由渲染端动态加载，仅在渲染进程执行，不在 Node 中运行），契约：

```js
export default {
  mount(element, props) {
    // element: 宿主 div，自行构建 DOM
    // props: { lines, currentLineIndex, currentTime(MotionValue), theme, songTitle, ... }
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