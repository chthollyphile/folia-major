# 给 Agent 的风格包制作任务

先明确交付范围：个性（personality）是完整视觉设计；样式（lyric-template）是可复用歌词模板。调用 `folia_style_catalog` 选参考，阅读 `taxonomy`；把 `kind` 和可选 `lyricTemplate` 写入新包。内置源码需要转译到 API 2，不是 Worker 的直接依赖。详见 [分类规范](../skills/folia-style-art-direction/references/taxonomy.md)。

请基于 `renderer-pack.schema.json`、`renderer-api.d.ts`、`prism.renderer.js`、规范与内置设计分析，制作 Folia API 2 独立渲染器包。可以编写完整 Canvas 2D / WebGL / WebGL2 程序，不修改播放器源码。

1. 先读 `skills/folia-style-art-direction/SKILL.md`（仓库根目录或离线包根目录），再读 DESIGN.md。有 Folia MCP 时调用 `folia_style_brief`，会直接加载 skill、内置设计与验收规则；[MCP 接入说明](style-pack-mcp.md)。先写乐句 motion plan：真实输入、变化原因、人物锚点、文字安全区、停留和跨句衔接。不能以固定弧线加随机抖动冒充整首歌的编排。
2. 用户给了视频时：观看原视频，读取参考 ZIP 的 `reference.json`、全部帧与标注。按时间列出排版、遮罩、镜头、光效/粒子、曲线及声音关系，区分“观察到”和“推测实现”。均匀帧不足以判断运动时补看视频，不声称恢复原始源码，也不用视频铺底冒充实现。
3. 编写 `renderer.js`，调用 `FoliaStyle.define(context => ({update, render, dispose}))`。依赖编进单一脚本；Worker 没有 DOM 或网络。可独立实现着色器、粒子、图集、镜头与排版。
4. `update(scene)` 编译语义和时序并使布局缓存失效；尺寸/字体只在 frame 中，`render(frame)` 按画幅、字体/字重/缩放、相关文字与字幕参数的缓存键变化重测排版，其余帧按绝对 time 求姿态。resize/改字号不会自动触发 update。使用 words/glyphs 的时间，不以系统时间、未播种随机数、自己的 RAF 或积分式进度替代宿主时钟。译文使用字幕字体/缩放，横竖屏分别设计。
5. 使用新的 id（保留 folia.prism/folia.nocturne），素材放 assets。`style:pack -- <源目录> <输出.json>` 打包，`style:check` 校验；格式有效不等于代码能运行。
6. 在 Studio 导入或编辑 JavaScript。检查四种歌词场景、横竖屏、明暗、减少动态效果、暂停与前后跳转。还要观看包含短句、快速句、长词、长音与休止的连续片段；记录时间、观察、证据和未观看项。用 `folia_style_review_motion` 检查实际轨迹重复只提供诊断，不能代替审美验收。导出连续预览、截图与报告。
7. 有视频时给出带时间点的对照表和剩余差距，用户指定效果逐条验收。为新歌词重新排版，不固化视频中的文字和时间点。规范 P06–P12 未测项明确列出，不能把冒烟通过冒充完整验收。
8. 交付 `.folia-style.json`、源码、报告、横竖屏与不同镜头截图、README（说明、版本、作者、依赖许可证、已测环境、未测项）。

宿主只提供视觉数据。控制音源、账户、文件系统和替换整个应用界面属于 Folium 范围；不要为视觉效果申请这些额外权限。
