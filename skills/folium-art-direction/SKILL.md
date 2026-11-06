---
name: folium-art-direction
description: Create or critique Folium lyric visualizer mods using Folia's public mod API and built-in visual grammar. Use for wallpaper/video reconstruction, character-linked lyric emission, natural trajectories, typography and continuous visual acceptance with the folium-authoring MCP.
---

# Folium 风格导演

用现有 Folium 模组体系交付可随任意歌词成立的设计。先读官方契约再动手：`docs/folium/quickstart.md`、`docs/folium/contributing.md`、`mods/README.md`；具体 API 以 `src/mods/folium/contract.ts` 及其生成的 `mods/folium.d.ts` 为准。不要因为要做复杂逐字、运镜或特效，就再造播放器加载器、清单或注册表。

## 开始时加载

- 调用 `folium_brief`；已经通过 brief 得到本段就不递归调用。没有 MCP 时直接读取仓库文档。
- 先读[个性与样式](references/taxonomy.md)，用 `folium_catalog` 选参考。这些是制作标签，不是 Folium 清单字段。
- 用 `folium_reference` 看真实内置实现与 `folium-aurora`、`folium-52hz` 模组。内置设计供提炼视觉原则；成品只使用公开 Folium API 和自己携带的相对模块。
- 决定字如何出现前读[三种歌词释放语法](references/lyric-release.md)；人物、壁纸或视频输入再读[重建经验](references/reconstruction.md)。
- 编排前读[动态与验收](references/motion-and-acceptance.md)，需要内置视觉依据时读[builtins](references/builtins.md)。
- tools-only 客户端用 `folium_read_guide` 获取 quickstart、api、types、specification 和上述指导；若返回 nextLine，继续分页，不把首页当完整契约。Codex、Claude、DeepSeek Harness、WorkBuddy 共用这些内容。

## 制作顺序

1. **判断素材的艺术关系。** 记录主体、光色、笔触、空间、视线、呼吸与歌词的因果；视频区分观察、推测和缺失证据。不能把铺底视频称为效果重建。
2. **选择释放语法。** glyph 是按字词节奏逐字出生；line 是整句作为一个乐句事件释放；assemble 是字词独立出现并形成可读句子。依据素材作决定，不按行号轮播，不把“逐字点亮一行字幕”当成三种形式。
3. **先设计句子空间与生命周期。** 写清出生点、输送段、固定驻留点、局部浮动范围、N+2 退场。为完整句子和同时驻留的前句预留空间；不能截掉旧字来避免碰撞。空白行不推进 N+2，最后两句保留到场景结束。
4. **复用宿主。** 用 `folium:new` 生成标准模组，`folium.registries.visualizers.register` 注册。读取 `ctx.lines` 与歌词时钟 `ctx.lyricTime`；`ctx.audio` 只给音频分析，不等于精确 BPM、旋律音高或口型。输入不可用时明确降级。
5. **编译后求值。** 挂载时编译语义和时序；用 `ctx.onLyricTime`、`ctx.onChange`、`ctx.onResize` 更新。必要动画用 `ctx.onFrame`，暂停和 staticMode 停住；稳定 seed 与绝对歌词时间支持任意跳转。布局缓存包含尺寸、dpr、文字、字体/字重/缩放和字幕参数。用 `folium.theme` 解析宿主字体，`getDisplay().showText` 为 false 时隐藏歌词。清理由宿主 helpers 和返回 disposer 管理。
6. **先看连续片段，再看截图。** 静态 `folium_check_mod` / `folium:check` 只查文件，不执行模组。真实桌面宿主中重载、由用户确认启用、选择视觉模式；验证播放/暂停/跳转/切歌/改字号/横竖屏与无歌词状态。预览器只能验证其声明支持的接口，不能替代桌面验收。
7. **分开报告。** 格式、运行、视觉、适配分别写已测与未测。`folium_review_motion` 只诊断输入的轨迹，不读取视频，不给审美认证。

## 人物轻哼与移动发射者

夜莺的字必须在女孩附近以真实可辨字形出生，连续运动到冻结的驻留点，减速落定后局部轻浮，到下下句真正开始放字才渐隐。装饰光点不能代替字形输送，弯曲字幕在远处依次亮起仍不合格。跟踪同一个字的出生、途中、落定与留声；运输走廊和驻留文字分别检查。

猫蜂沿自然飞行编排发射，速度随字词节奏平滑变化，间奏慢游。旧字留在出生邻域轻浮，不继续跟蜂移动。逐字、整句和组句共享正确的驻留与退场规则，但不能共享一个假装三种形式的入场。

## 兼容与交付边界

- 只交付标准 Folium 模组；第三方库使用相对模块并带许可证。权限、版本和依赖依照官方清单，不新增 `kind`、`lyricTemplate` 等未定义字段。
- Folium 仅桌面版、运行可信代码，并非沙箱；预览器的额外隔离不改变这个事实。安装、信任确认、签名和启用都复用宿主，不代替用户确认。
- 连写语言、组合字、混合方向优先保持塑形与阅读顺序；减少动态效果保留可读结构。
- 本地素材只读分析，未获分发权的原图/视频/字体不随工具、skill 或公开模组分发。
