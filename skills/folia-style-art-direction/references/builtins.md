# 从内置风格学什么

依据 Folia 本地源码；路径相对仓库根目录。MCP 的 `folia_style_reference` 返回当前源码，可检验以下观察。它们是设计依据，不是必须复制的模板或风格数量指标。

| 来源 | 代码中的决策 | 可迁移的原则 | 壁纸场景中的转译 |
| --- | --- | --- | --- |
| 雾笺 Nebbia：`src/components/visualizer/nebbia/nebbiaInk.ts`、`nebbiaGlyphs.ts` | 按演唱时长沿笔画累计弧长描显，字形依字体缓存，痕迹与环境相互作用 | 逐字留下痕迹；诞生、书写、可读停留与环境余波分离 | 蜜蜂在自己的真实飞行位置逐字放出白色字迹；无笔顺数据则明确是渐显，不能假称笔顺复刻 |
| 凝彩 Tempera：`src/components/visualizer/tempera/temperaProgram.ts`、`temperaShotProfiles.ts`、`temperaCamera.ts` | 先编译段落/切片/镜头，按情绪选组合，延续 flowAngle；镜头服务整组字，空隙也有 bridge | 编排先于装饰；接力方向使不同构图像一个连续动作；字的时间和镜头时间分离 | 歌词从近处轻呼转入远处风流，前句尾迹给后句方向；镜头不跟每一个字追逐 |
| 花火 Hanabi：`src/components/visualizer/hanabi/catalog.ts` | uchiage 向上、yanagi 垂落、senrin 逐字小簇、senkohanabi 贴近字的弱火；密度/半径/寿命有家族差异 | 特效必须有形态、尺度和触发方式；变化不只是颜色 | 轻快短句能形成小簇，长音延迟释放；只借字和特效的因果，不把安静夜景炸满 |
| 绘光 Lumiere：`src/components/visualizer/lumiere/catalog.ts` 与 `rigs/` | lattice 窗影、caustic 水光、stage 舞台束、motes 尘埃等选择不同光源和空间关系 | 光有来源、层级和材质；“亮一些”不是新的灯光语言 | 窗边冷光与远城暖点分层，音符在光中显现；间奏保留低对比尘埃而非继续发歌词 |
| 商籁 Sonnet：`src/components/visualizer/sonnet/sonnetProgram.ts` | 从 gap、分段元数据、chorus、密度决定段落/镜头；`chooseWithoutRepeat` 带种子避免相邻机械复用；breath 可用 quiet-tableau | 确定性与变化兼容；留白是状态；主题可复现但交接不能生硬 | 稀疏句就近低幅漂移，密集句拉开时间/空间；长休止回到人物，副歌才扩大范围 |

## 如何从代码推到画面

先查 catalog/profile，了解动作词汇；再查 program，了解选择条件；最后看 frame/camera，了解连续性。只看粒子数或几个数学函数会丢掉编排层。若路径变更，先定位相应符号，不继续引用过期文件。

从每个相关参考写出一条可检查的翻译：

> 凝彩用镜头级方向连接切片；本风格用前一乐句尾端切线决定下一乐句进入风流的方向。用连续三句检查交接，不在每句开头硬重置流场。

避免直接复制内部 `songPart` / `blockIndex` 依赖：外部 API 2 不保证提供它们。可用 lines 的时间间隔、字数/持续时间、`chorus` 做有限推断，真实可用字段以类型契约为准。

## 不是加法竞赛

不要为了“媲美内置”同时加入大字、爆炸、扫光、运镜。先定义主角和强弱峰值：人物场景里人是主体，歌词是动作，环境是支持。整段视频每一秒都满负荷，只会削弱高潮。安静风格也应在呼吸节奏、近远层次、出现/停留/离开关系上有设计。
