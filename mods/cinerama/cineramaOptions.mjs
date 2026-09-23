// mods/cinerama/cineramaOptions.mjs
// 旋钮解析。值有两个来源，按优先级合并（后者盖前者）：
//   1. 巨幕自带面板的值 —— cineramaSettings.mjs 的共享单例（settingsPanel.mjs 写），
//      落盘用模组自己的 localStorage，与宿主的存储互不干扰；
//   2. modulation —— k3panel 同款实时通道，宿主用 props.getModulation() 暴露给贡献方，
//      拖动即写，盖在持久化值上。
// 两个来源都缺席（导出窗口、旧宿主）时全部回落到缺省，画面恒等于静态常量。
//
// 旋钮分三类：
//   - 样式：排版本体，大字报 / 小字报 / 斜切丝带各一个 0~1 的**概率权重**；
//   - 跑马灯带（marquee）：**叠加**元素的档位，关 / 自动 / 具体形态，不属于样式；
//   - 数值：结构性的（条数、角度、字号、块长）建层时读一次，改完下一行生效；
//     连续性的（带速、漂移）在 update 里每帧读。
//
// 印前故障（套版错位）整条轴已移除：档位与两个强度旋钮都不再存在。
//
// 注意 mod.json **不要**声明 `visualizers[].settings`：那是宿主会照着渲染一份表单的
// 声明式 schema，声明了就会和模组自带面板（settingsPanel.mjs）在界面上并排出现两组
// 同样的旋钮，而宿主那份写的是巨幕不读的 store（表现为「上面那组拖了没反应」）。

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/*
 * 样式 kind → 权重旋钮名。**样式的唯一清单**就在这里：面板、解析层、结构签名、
 * 编译期重编、解算层的抽样顺序全部从这张表派生，所以「加一种样式」只在这里加一项，
 * 不会出现「旋钮有、解算层不认」或反过来。
 *
 * 样式**不是多选一**（没有「自动」这一档）：三种样式各有自己的 0~1 权重，每一句按三者的
 * 比例抽一个——归一化在解算层做，所以加起来不必是 1；某项拖到 0 就是整首不再出现它。
 */
export const CINERAMA_STYLE_WEIGHT_FIELDS = {
    'hero-type': 'heroWeight',
    'small-type': 'smallWeight',
    'ribbon-collage': 'ribbonWeight',
};
export const CINERAMA_STYLE_WEIGHT_KEYS = Object.values(CINERAMA_STYLE_WEIGHT_FIELDS);

/*
 * 排版权重（`plan.layout`）的**旋钮开关**。排版权自始至终都是编译期按行种子抽的，
 * 而且**相邻行不重复**（见 cineramaProgram）。这里给它的不是「档位」，而是三个开关：
 *
 *   - `layoutWeights.early`：上三分之一 / 下三分之一 / 左右两栏这几个**偏置落点**的权重；
 *   - `layoutWeights.letterbox`：宽银幕字幕条（`letterbox-wide`：更窄的字号、更宽的字距、
 *     压在屏体下缘）的权重。
 *
 * **居中落点（center-stage）不进权重表**：它是排版轴的兜底（与样式轴的小字报同一条规矩），
 * 永远留在池子里。另两组的权重都是 0 时，全部行都排成居中的那一档——这也是「关闭偏置落点」
 * 的表达方式（没有单独的开关了：开关就是「拖到 0」）。三项之比才是分布，所以不必归一。
 *
 * `plan.layout` 是**编译期**抽的，所以这一组变化时要**重编 program**
 * （与样式权重同一条路，见 cineramaProgram / visualizer 的权重签名判定）。
 */
export const CINERAMA_LAYOUT_WEIGHT_FIELDS = {
    early: 'layoutEarlyWeight',
    letterbox: 'layoutLetterboxWeight',
};
export const CINERAMA_LAYOUT_WEIGHT_KEYS = Object.values(CINERAMA_LAYOUT_WEIGHT_FIELDS);

/*
 * 排版分组：kind → 它归哪一组权重管。**每一种排版都要在这张表里出现一次**
 * （缺席的按居中处理）。清单与 cineramaLayout 的 CINERAMA_LAYOUT_KINDS 同源，
 * 那边加一种落点时这里必须跟着加，否则新落点会落进「居中」那一组、永远抽到。
 */
export const CINERAMA_LAYOUT_WEIGHT_GROUPS = {
    'center-stage': 'center',
    'upper-third': 'early',
    'lower-third': 'early',
    'left-band': 'early',
    'right-band': 'early',
    'letterbox-wide': 'letterbox',
};
// 抽样顺序（解算层用）：与 cineramaLayout 的清单同序，避免两处排序漂移。
export const CINERAMA_LAYOUT_KIND_ORDER = Object.keys(CINERAMA_LAYOUT_WEIGHT_GROUPS);
// 抽样顺序（解算层用）：与上面同一份清单，避免两处排序漂移。
export const CINERAMA_STYLE_KINDS = Object.keys(CINERAMA_STYLE_WEIGHT_FIELDS);

// 跑马灯带是叠加元素，不是样式：关 / 自动（按句抽形态）/ 双带 / 四边。
export const CINERAMA_MARQUEE_VALUES = ['off', 'auto', 'bands', 'frame'];
/*
 * 跑马灯带的**填色**：带子占的那块区域着不着色。**只管填色**——边线是另一条轴
 * （`marqueeEdge`），从前这两件事混在一档里，于是「实线 + 底色」这种组合表达不出来。
 *   - 无：区域全透明，只有字压在屏面上；
 *   - 淡色底：一层带**色相**的极淡底，把字从样式层里托起来。
 *   底色取哪个色轴由**另一条轴** `marqueeFillColor` 决定（强调色 / 辅助色），见下。
 */
export const CINERAMA_MARQUEE_FILL_VALUES = ['none', 'tint'];

/*
 * **填色的色轴**（面板的「带身填色」旁边那一档色）：淡色底取哪个颜色。
 *   - accent：主题**强调色**，与带上的字同一个光源（缺省）；
 *   - secondary：主题**辅助色**，带子因此分成「字 accent、底 secondary」两层。
 * 只影响**填色**，不动边线——边线的色轴是 `marqueeEdgeColor`，两条轴各自独立。
 */
export const CINERAMA_MARQUEE_FILL_COLOR_VALUES = ['accent', 'secondary'];

/*
 * 跑马灯带的**边线**：带子这块区域的内沿怎么画。
 *   - 无：不画边；
 *   - 实线：一道 1px 实线（**辅助色**），读作「勾出这是一条带」，与字分两条色轴；
 *   - 辉光：**只有光，没有实线**——两圈向内扩散 + 一圈向外溢出，取**强调色**
 *     （与带上的字同一个光源）。带沿由扩散最浓的一端定，不是由一条线定；
 *     要那条 1px 硬边就选「实线」，两者互斥。
 * 实现见 cineramaRender 的 bandEdgeDeclarations。
 */
export const CINERAMA_MARQUEE_EDGE_VALUES = ['none', 'solid', 'glow'];

/*
 * **边线的色轴**（面板的「边线」旁边那一档色）。
 *   - auto：**按档位配**——实线取辅助色（它勾的是范围，与字分两条色轴）、
 *     辉光取强调色（边与字同一个光源）。缺省，等于从前写死的那套；
 *   - accent / secondary：不论哪一档都强制用这一个色轴。
 * 亮色主题下「辉光」那一档本来就不取彩色（浅底上发光等于没画，改成压进屏面的一道暗槽，
 * 见 cineramaRender 的 bandEdgeDeclarations）：色轴选项在那条分支上不生效。
 */
export const CINERAMA_MARQUEE_EDGE_COLOR_VALUES = ['auto', 'accent', 'secondary'];

/*
 * **边线画在哪几条边上**（面板的「边线范围」）。
 *
 * 带子占的那块区域有两条长边：靠**屏幕中心**的那条（内侧）与靠**屏幕边缘**的那条（外侧）。
 *   - inner（缺省）：只画**内侧**——双带是上下两条各自朝屏心的那条长边，
 *     四边是环上朝屏心的那四条边。带子因此读作「从屏沿往中间发光的一条灯带」；
 *   - both：**两侧都画**——连同贴着屏幕边缘的那条长边。
 *
 * 两条短边（双带最左 / 最右那两端）**一律不画**：那两处正好落在屏幕的左沿与右沿上，
 * 给它们上边会把「带子在这里结束」写进画面，而带上的字是循环的、根本没有端点
 * （从前全四周一圈 `inset` 阴影就带上了这两条，读出来是屏沿上凭空多出两道竖棱）。
 *
 * 空行 / 丝带那一档没有带子，选项自然不生效。
 */
export const CINERAMA_MARQUEE_EDGE_SIDES_VALUES = ['inner', 'both'];

/*
 * 跑马灯带的两档**速度通道**（各自独立）：
 *   - `speed`：带上的字横向滚动的速度（整条带的行程）；
 *   - `drift`：带子本身的**亮边对流速**——边线那道灯（辉光/实线）沿带子的移动速度，
 *     0 = 完全静止（灯是一道固定的边），拖大就读作「带子边缘有一道在跑的灯」。
 * 后者从前是**代码级常量**（`CINERAMA_TUNING.band.edgeDriftSpeed`），现在提上来的原因：
 * 它和带速是**两件事**（字在动、灯在动），绑在一起时没法只要其中一样。
 */
export const CINERAMA_MARQUEE_SPEED_KEYS = ['marqueeSpeed', 'marqueeEdgeDrift'];

/*
 * 旧档位 → 新档位的迁移表。`marqueeFill` 以前同时管「描不描边」和「填不填色」
 * （无背景 / 内侧描边 / 着色+描边），存下来的 'stroke' / 'fill' 不在新枚举里——
 * 直接丢给 `enumOr` 会静默回默认，等于升一次级就把用户选的外观换掉。
 * 所以先把旧值翻成一组新值再解析，老用户看到的东西保持原样。
 */
const LEGACY_MARQUEE_FILL = {
    none: { fill: 'none', edge: 'none' },
    stroke: { fill: 'none', edge: 'solid' },
    fill: { fill: 'tint', edge: 'solid' },
};

/*
 * 大字报填色的**方向**（歌词处理组的「填色方向」）。
 *   - both（缺省）：按块抽，水平（左 → 右）/ 竖直（上 → 下），且**相邻不重复**；
 *   - x / y：整首统一一个方向。
 * 「相邻不重复」是缺省档的性质，不是这一项的性质，所以这里不需要第三个显式档位。
 */
export const CINERAMA_HERO_FILL_AXIS_VALUES = ['both', 'x', 'y'];

const DEFAULTS = {
    /*
     * 三个样式的**概率权重**（0~1，解算层只取它们的比例）：大字报 / 小字报 / 斜切丝带。
     *
     * 缺省 0.4 / 0.2 / 0.4：大字报与斜切丝带是两个「有戏」的本体，小字报是兜底样式
     * （任何行都排得下），份量给一半就够。某项拖到 0 = 整首不再出现该样式；
     * 三项全 0 时解算层回落到小字报——它是唯一无条件支持的样式。
     */
    heroWeight: 0.4,
    smallWeight: 0.2,
    ribbonWeight: 0.4,
    /*
     * 两个**已从面板撤下**的旧字号旋钮（`heroScale` / `smallScale`）。
     *
     * 它们在本版被合并成「文字样式 · 字号」一条（面板上只有一个 `fontScale`）。
     * 合并的理由：对用户来说「字号」就是同一个量，而两个旋钮的作用机制还不一样
     * （`heroScale` 乘在切分阈值上、`smallScale` 乘在最终字号上），说明怎么写都别扭。
     *
     * 解析层**仍然保留它们**：旧版本的安装把值写在自己的 localStorage 里，
     * 直接删键会让那台机器上的存量数据多出一个没人认的字段。现在改由
     * `heroMotion` / `fontScale` 等当前旋钮决定画面，这两个键只是「读得到、不影响画面」。
     */
    heroScale: 1,
    smallScale: 1,
    /*
     * 大字报并词概率：按词分词之后，每收进一个词就按这个概率再并下一个
     * （并的前提始终是「这一块装得下」）。0 = 每个词闪一次（最碎）；
     * 1 = 装得下就并到底（最大块）；中间值则块长自然浮动。
     * 它不是「一次出几个词」的定值：定长并块会让每块一样长，一句歌词读下来
     * 是打点而不是说话（凝彩的 shot 也是按种子抽 2~4 词收块的）。
     */
    heroChunkChance: 0.55,
    /*
     * 逐段落位窗口：一段入场要花多久（渲染层是 `0.3 × unitStagger`，再被该段自己的
     * 时长的一半钳住）。它**不改变出词的落点**（落点由词时序决定，见 cineramaSplit），
     * 只改每一段落下去的快慢。
     *
     * 默认从 1 降到 0.6：落点跟词时序之后，一段还要花 0.3s 才完全落定，
     * 相对已经提前了的起点就显得「磨」——0.6 下是 0.18s，落定跟得上唱。
     * 旋钮范围仍是 0.4~2，喜欢更缓的手感往上拖即可。
     * 面板里那份 `defaultValue` 是硬编码的（settingsPanel.mjs），改这里要同步改那边，
     * 否则「默认」按钮复位出来的数和这里的缺省对不上。
     */
    unitStagger: 0.6,
    marquee: 'auto',
    /*
     * 带的**填色**（只管填色）：默认**不填色**——实录里那条带子本身是屏体（黑场），
     * 带子读出来靠的是**边线那道灯**与带上的字，不是一块铺满的色底。
     * 铺了色底反而会把屏体压成一块有颜色的横条，与实录不符；底色是给「想让带子读成
     * 一块独立面板」的场合留的选项（见 CINERAMA_MARQUEE_FILL_VALUES）。
     */
    marqueeFill: 'none',
    /*
     * 填色的**色轴**：默认强调色——底色与带上的字共用一个光源。
     */
    marqueeFillColor: 'accent',
    /*
     * 带的**边线**（只管边线）：默认「辉光」——灯槽那一档，与带上的字同一个光源。
     */
    marqueeEdge: 'glow',
    /*
     * 边线的**色轴**：默认 auto（按档位配：实线辅助色、辉光强调色），与从前写死的那套一致。
     */
    marqueeEdgeColor: 'auto',
    /*
     * 边线画在**哪几条边**上：默认「内侧」——只画朝屏心的那一条（双带）/ 那四条（四边）。
     */
    marqueeEdgeSides: 'inner',
    /*
     * 辉光强度（**1 = 设计上限**，缺省 0.3）：缩放辉光各层的**浓度与扩散**，不缩放层数。
     * 拖到 0 = 辉光整档淡出（等于不画边），拖满则亮芯更实、光晕更厚。
     *
     * 缺省压到 0.3 是照实录定的：现场那圈灯在屏体上是**一道收得很紧的亮边**，
     * 亮芯只占带厚的一小截，不是一圈糊满整条带的雾（见 CINERAMA_TUNING.marquee.edge 的
     * coreRatio / 浓度表）。1 是「屏上只剩一圈光」的极端档，不是常态。
     * 它不动「实线」那一档——实线是勾范围，不是光。
     */
    marqueeGlow: 0.3,
    /*
     * 带上的**文字辉光**强度（0~2，缺省 0.2，1 = 设计基准 = `CINERAMA_TUNING.marquee.text`
     * 那一份弱影）。
     *
     * 从前带上字只有**一份写死的弱影**（半径按带内字号取比例、浓度 55%），
     * 理由是「带子的亮该来自边线那道灯，字本身要干净」。那条理由对**默认档**仍然成立，
     * 但它把「想要字也发光」这条路整个封掉了——用户能调带子的边线辉光，却调不了字自己的光。
     * 这一轴就是那个旋钮：缩放同色光的半径与浓度，**不动**暗投影（那是浅色画面上的可读性，
     * 不是辉光）。
     *
     * 上限 2 而不是更高：带上是一圈密排的小字，光再厚就互相糊在一起（那正是这份弱影
     * 当初被削掉的原因）。上限档能到「字自己在发光」，但读数仍然认得出来。
     */
    marqueeTextGlow: 0.2,
    marqueeSpeed: 1,
    /*
     * 带高：屏高的百分比。**固定值**——它不跟歌词走，整首歌的带宽自始至终一个尺寸。
     */
    marqueeBandPct: 12,
    /*
     * 带内字号：相对**带高**的比例（0.3~0.8）。**固定值**，与带高同一把尺子。
     *
     * 两个量都是**整屏属性**，不是**单句属性**：它们决定的是「这一屏的带子长什么样」，
     * 所以必须在样式之前定死。做到解算层才按选项钳的话，带型在 auto 档按句抽
     * （双带 / 四边交替）时，同一组旋钮会在「带高 ×1、字号 ×min(cqh,cqw)」与
     * 「带高 ×min(cqh,cqw)、字号 ×1」两种读法之间摇摆——上屏读出来就是「换句时
     * 带子的形状与位置忽然变了一下」。见 resolveCineramaBandPct / resolveCineramaBandFontCq。
     */
    marqueeFontRatio: 0.55,
    /*
     * 跑马灯带上出现**歌曲标题**的概率系数：先按歌词 seed 掷一次（同一句结论固定），
     * 命中才用歌名，否则在当前行原文 / 译文里挑。默认压得比较低——歌名是装饰，
     * 按 seed 均匀抽的话它会占掉相当一部分句数，整首看下来「歌名一直在跑」。
     */
    marqueeTitleChance: 0.25,
    // 排版权重：偏置落点与宽银幕字幕条各一档（居中是兜底，不在这里）。
    layoutEarlyWeight: 1,
    layoutLetterboxWeight: 0.5,
    // 文字样式：字形与墨色。所有样式共用一份——它们是**这块屏上的字**的属性，不是某一档的。
    italicChance: 0.35,
    fillChance: 1,
    fontScale: 1,
    letterSpacing: 1,
    lineHeight: 1,
    // 歌词处理：大字报的块级持续运动与填色方向。
    heroMotion: 1,
    heroFillAxis: 'both',
    /*
     * 跑马灯带：边线那道灯的流速，缺省 **0**（灯不动，是一条固定的边）。
     *
     * 带上的字与那条边线本来就挤在同一个纵向区间里，让这道灯沿带子走就会从字身上
     * 穿过去，屏上读成**两处错开的亮区**——稳定的那条是边线的静态落位，会跑的那条
     * 落在字身上。四边档没有这条通路（环上的字在 SVG 路径上、边线也不跟着走）。
     *
     * 这一轴**没有被删**：它仍然缩放振幅（见 CINERAMA_TUNING.marquee.edge.edgeDriftSpan），
     * 想给的人往右拖就有。
     */
    marqueeEdgeDrift: 0,
    ribbonCount: 6,
    ribbonAngle: 1,
    ribbonDrift: 1,
    /*
     * 画面宽高比是**环境量**不是旋钮：它决定大字报的横向可用宽度
     * （`usableWidthVw` 折成 vh 要乘它）。渲染层每帧按实际屏体尺寸写进来，
     * 面板不暴露它（没有可解释的语义），解析层只负责在非有限值时回落 16:9。
     */
    viewportAspect: 16 / 9,
};

const RANGES = {
    // 样式权重：0 = 关掉这一档，1 = 满权重；只有**三者之比**有意义（见 cineramaStyleWeights）。
    heroWeight: { min: 0, max: 1 },
    smallWeight: { min: 0, max: 1 },
    ribbonWeight: { min: 0, max: 1 },
    heroScale: { min: 0.6, max: 1.4 },
    smallScale: { min: 0.6, max: 1.4 },
    heroChunkChance: { min: 0, max: 1 },
    unitStagger: { min: 0.4, max: 2 },
    marqueeSpeed: { min: 0.2, max: 3 },
    marqueeGlow: { min: 0, max: 1.5 },
    marqueeTextGlow: { min: 0, max: 2 },
    marqueeBandPct: { min: 6, max: 20 },
    marqueeFontRatio: { min: 0.3, max: 0.8 },
    marqueeTitleChance: { min: 0, max: 1 },
    // 排版权重：0 = 整首不再出现该组落点（居中是兜底，不进这里）。
    layoutEarlyWeight: { min: 0, max: 1 },
    layoutLetterboxWeight: { min: 0, max: 1 },
    // 文字样式：三档都是**倍率**，1 = 设计默认。
    italicChance: { min: 0, max: 1 },
    fillChance: { min: 0, max: 1 },
    fontScale: { min: 0.8, max: 1.3 },
    letterSpacing: { min: 0.6, max: 1.6 },
    lineHeight: { min: 0.85, max: 1.25 },
    // 歌词处理：运动大类的幅度倍率（1 = 设计默认，0 = 整首不做块级持续运动）。
    heroMotion: { min: 0, max: 1.5 },
    marqueeEdgeDrift: { min: 0, max: 3 },
    ribbonCount: { min: 3, max: 9 },
    ribbonAngle: { min: 0.4, max: 1.4 },
    ribbonDrift: { min: 0, max: 3 },
};

/*
 * 跑马灯带三档外观的**缺省值**，从 DEFAULTS 派生出**具名导出**。
 * 解算层（cineramaTreatment 的 resolveCineramaMarquee）在 options 里缺键时要回落缺省，
 * 回落值必须与这里的 DEFAULTS 同源——从前那边各写了一遍字面量（`'tint'` / `1`），
 * 缺省一改就漏一处，持旧 options 的调用方会停在旧观感上。
 */
export const CINERAMA_MARQUEE_FILL_DEFAULT = DEFAULTS.marqueeFill;
export const CINERAMA_MARQUEE_EDGE_DEFAULT = DEFAULTS.marqueeEdge;
export const CINERAMA_MARQUEE_GLOW_DEFAULT = DEFAULTS.marqueeGlow;
export const CINERAMA_MARQUEE_TEXT_GLOW_DEFAULT = DEFAULTS.marqueeTextGlow;

// 枚举档位：值来自面板（下拉/按钮组）与 localStorage，写坏了要能回落缺省。
// 样式不在里面：它是三个数值权重，不再有档位（见 CINERAMA_STYLE_WEIGHT_FIELDS）。
const ENUMS = {
    marquee: CINERAMA_MARQUEE_VALUES,
    marqueeFill: CINERAMA_MARQUEE_FILL_VALUES,
    marqueeFillColor: CINERAMA_MARQUEE_FILL_COLOR_VALUES,
    marqueeEdge: CINERAMA_MARQUEE_EDGE_VALUES,
    marqueeEdgeColor: CINERAMA_MARQUEE_EDGE_COLOR_VALUES,
    marqueeEdgeSides: CINERAMA_MARQUEE_EDGE_SIDES_VALUES,
    heroFillAxis: CINERAMA_HERO_FILL_AXIS_VALUES,
};

const numberOr = (value, fallback, key) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const range = RANGES[key];
    return range ? clamp(parsed, range.min, range.max) : parsed;
};

const enumOr = (value, fallback, key) => (
    typeof value === 'string' && ENUMS[key].includes(value) ? value : fallback
);

/*
 * Merges the persisted settings with the live modulation on top. Unknown or
 * NaN values fall back to the default, so a partially-written store can never
 * produce NaN geometry.
 */
export const resolveCineramaOptions = (settings, modulation) => {
    const base = settings ?? {};
    const live = modulation ?? {};
    const resolved = { ...DEFAULTS };

    // 两个档位、样式权重与数值旋钮、marqueeFill 同一条合并顺序：调制（live）盖在持久化（base）之上。
    // 以前 style / marquee 只读了 base，漏掉 live——宿主经命令通道送来的档位会
    // 被无声丢弃、回退到持久化/缺省值，是期望外的回退。现在统一走「live 优先」。
    resolved.marquee = enumOr(live.marquee !== undefined ? live.marquee : base.marquee, DEFAULTS.marquee, 'marquee');
    /*
     * 填色与边线：先认旧档位（见 LEGACY_MARQUEE_FILL），再各自过枚举。
     * 旧值翻出来的 `edge` **只在用户没显式给过 marqueeEdge 时**才用——
     * 给了就听新的，否则老用户一旦拖过新旋钮就再也回不去。
     */
    const rawFill = live.marqueeFill !== undefined ? live.marqueeFill : base.marqueeFill;
    const legacy = typeof rawFill === 'string' && rawFill in LEGACY_MARQUEE_FILL
        ? LEGACY_MARQUEE_FILL[rawFill]
        : null;
    resolved.marqueeFill = enumOr(
        legacy ? legacy.fill : rawFill,
        DEFAULTS.marqueeFill,
        'marqueeFill',
    );
    const rawEdge = [live.marqueeEdge, base.marqueeEdge].find(
        (value) => value !== undefined && value !== null && value !== '',
    );
    resolved.marqueeEdge = rawEdge === undefined
        ? (legacy ? legacy.edge : DEFAULTS.marqueeEdge)
        : enumOr(rawEdge, DEFAULTS.marqueeEdge, 'marqueeEdge');

    /*
     * 三条色 / 位置轴与 `marqueeEdge` 同一条合并顺序（live 盖 base，未知值回落缺省）。
     * 它们都是**建层时写进 CSS 的字符串**，所以没有数值范围要钳，只需要挡掉未识别的档位。
     */
    ['marqueeFillColor', 'marqueeEdgeColor', 'marqueeEdgeSides'].forEach((key) => {
        const given = [live[key], base[key]].find(
            (value) => value !== undefined && value !== null && value !== '',
        );
        resolved[key] = enumOr(given, DEFAULTS[key], key);
    });

    Object.keys(RANGES).forEach((key) => {
        /*
         * `null` / `''` 一律当成「没给」，不是 0：`Number(null) === Number('') === 0`
         * 是有限值，会被钳进 RANGES 变成合法的旋钮值——样式权重拿到 0 就是「整首不再
         * 出现这种样式」，`ribbonCount` 拿到 0 就是 3 条，都属于「拖了没反应」的静默错值。
         * 调制通道与 localStorage 里写 `null` 表示未设置是很常见的写法，这里必须挡掉。
         */
        const given = [live[key], base[key]].find(
            (value) => value !== undefined && value !== null && value !== '',
        );
        resolved[key] = numberOr(given, DEFAULTS[key], key);
    });
    resolved.ribbonCount = Math.round(resolved.ribbonCount);
    // 环境量：非有限值（NaN / 0 / 负）一律回落 16:9，几何计算不允许出现 NaN。
    resolved.viewportAspect = Number.isFinite(live.viewportAspect) && live.viewportAspect > 0.2
        ? live.viewportAspect
        : (Number.isFinite(base.viewportAspect) && base.viewportAspect > 0.2 ? base.viewportAspect : DEFAULTS.viewportAspect);
    return resolved;
};

/*
 * 带高（屏高的百分比）与带内字号（同尺度的屏高百分比）的**唯一解析入口**。
 *
 * 两处必须从这里取，不能各自钳一遍旋钮：带高与字号都不是「建层时才读」的几何量，
 * 而是**样式层要提前知道的环境量**。原因见 DEFAULTS.marqueeFontRatio 那条注释——
 * 排版本体要先知道带子占了屏沿多厚（大字报收窄可用框、小字报加内边距），
 * 带高就必须在样式解算之前定死；而渲染层写 CSS 时若各自再按带型钳一次，
 * 同一组旋钮在两句之间就会有**两种读法**，上屏就是带宽与带宽位置跳了一下。
 *
 * 返回的是**解析后的数**（不是比例）：`bandPct` 是屏高百分比，`bandFontCq` 是与它同尺度的
 * 字号百分比（渲染层 `min(cqh, cqw)` 里的那个数）。两个值都来自同一份 options，
 * 所以只要旋钮不动，整首歌的带子就是同一个尺寸。
 */
export const resolveCineramaBandPct = (options) => clamp(
    numberOr(options?.marqueeBandPct, DEFAULTS.marqueeBandPct, 'marqueeBandPct'),
    6,
    20,
);

export const resolveCineramaBandFontCq = (options) => resolveCineramaBandPct(options) * clamp(
    numberOr(options?.marqueeFontRatio, DEFAULTS.marqueeFontRatio, 'marqueeFontRatio'),
    0.3,
    0.8,
);

/*
 * 三个样式的权重（kind → 0~1 的数）。解算层只拿它做**比例**，所以不必归一：
 * 三项都拖到 1 也是各 1/3；三项全 0 时由解算层回落到小字报。
 * 值坏了（NaN / 缺项）一律回落到缺省权重，抽样里不允许出现 NaN。
 */
export const cineramaStyleWeights = (options) => Object.fromEntries(
    Object.entries(CINERAMA_STYLE_WEIGHT_FIELDS).map(([kind, key]) => {
        const value = Number(options?.[key]);
        return [kind, Number.isFinite(value) ? clamp(value, 0, 1) : DEFAULTS[key]];
    }),
);

/*
 * 排版两组的权重（group → 0~1 的数）。与样式权重同一套规矩：只做**比例**，不必归一；
 * 「居中」不进这张表（它是兜底，见 CINERAMA_LAYOUT_WEIGHT_FIELDS）。
 * 值坏了（NaN / 缺项）一律回落到缺省。
 */
export const cineramaLayoutWeights = (options) => Object.fromEntries(
    Object.entries(CINERAMA_LAYOUT_WEIGHT_FIELDS).map(([group, key]) => {
        const value = Number(options?.[key]);
        return [group, Number.isFinite(value) ? clamp(value, 0, 1) : DEFAULTS[key]];
    }),
);

/*
 * 权重签名。**样式与排版都是编译期抽的**（见 cineramaProgram：逐行 pre-plan，且相邻不重复），
 * 所以权重一变，每一行的结论都可能变——光重建当前层不够，渲染层拿这个签名判断
 * 要不要连带重编 program。
 *
 * 两组权重共用**一个**签名（而不是各一个）：它们都会触发同一次重编，分成两个签名只是让
 * 调用方多写一次判断，还得小心「两个都变了只重编一次」这类顺序问题。
 */
export const cineramaStyleWeightSignature = (options) => [
    ...Object.values(cineramaStyleWeights(options)),
    ...Object.values(cineramaLayoutWeights(options)),
].map((weight) => weight.toFixed(3))
    .join('|');

/*
 * 结构旋钮的签名：变化时渲染层立即重建（不用等下一行），连续旋钮不参与——
 * 它们每帧现读，参与签名只会造成无意义的重建。
 *
 * 档位与三个样式权重都在签名里：叠加元素是「建不建这一层」级别的改动，
 * 样式决定了这一层排成什么样，不进签名的话都要等下一行才看得到。
 */
export const cineramaStructureSignature = (options) => [
    // 样式权重：拖了要立刻重建当前层（这一句的样式可能就换了）。
    ...CINERAMA_STYLE_WEIGHT_KEYS.map((key) => options[key]),
    /*
     * 排版权重不在这里：它是**编译期**抽的，重编 program 就够（见 cineramaStyleWeightSignature）。
     * 把它塞进结构签名只会让每一次拖动都额外重建一遍当前层，白付一次建层成本。
     */
    options.marquee,
    /*
     * 文字样式与歌词处理两组：都是建层时写进 CSS（字号/字距/行距倍率）或读一次（斜体、
     * 填色方向、运动幅度）的量，所以都要立刻重建当前层才看得到变化。
     * 斜体与填色是**按 seed 掷点**的，倍率一变就得重掷——它们不是每帧现读的连续量。
     */
    options.italicChance,
    options.fillChance,
    options.fontScale,
    options.letterSpacing,
    options.lineHeight,
    options.heroMotion,
    options.heroFillAxis,
    // 带的填色与边线都是建层时写在带层上的 CSS（辉光是静态 box-shadow，不逐帧改），
    // 改了要立刻重建。
    options.marqueeFill,
    // 填色 / 边线各自的色轴、边线画在哪几条边上：都是建层时写进 CSS 的字符串，改了要重建。
    options.marqueeFillColor,
    options.marqueeEdge,
    options.marqueeEdgeColor,
    options.marqueeEdgeSides,
    Number(options.marqueeGlow ?? 0).toFixed(2),
    /*
     * 带上的**文字辉光**也是建层时写进 CSS 的（text-shadow 是静态的，不逐帧改），
     * 同样要立刻重建——漏掉它的表现就是「拖了要等下一行才变」，
     * 与两类边线旋钮共一条判据（见 playbook 第 3 节第 8 条）。
     */
    Number(options.marqueeTextGlow ?? 0).toFixed(2),
    // 带高与带内字号都是建层时读的几何量，改了要立刻重建当前层。
    options.marqueeBandPct,
    options.marqueeFontRatio,
    // 带上的文本由它决定（歌名 / 原文 / 译文），改了要立刻重建当前层。
    options.marqueeTitleChance,
    options.heroScale,
    // 小字报的字号是建层时写进 CSS 的，改了要立刻重建当前层（与大字报字号同一条理由）。
    options.smallScale,
    options.heroChunkChance,
    options.ribbonCount,
    options.ribbonAngle,
    /*
     * 宽高比也是**建层时读**的几何量（大字报的横向安全字号 = 可用 vw × aspect ÷ 当量宽度，
     * 四边环的左右带厚 = 带高 ÷ aspect）。首帧容器还没布局时量到 0，解析层回落 16:9，
     * 不进签名的话这一层就按 1.78 建死：窄画面 / 竖屏下大字报会横向出屏，一直错到下一行。
     *
     * 量化到两位小数：**拖拽窗口时尺寸每变一像素就重建整层太贵**，而 0.01 的宽高比差
     * 对字号的影响远小于一档字号差，取舍是划算的。
     */
    (Number(options.viewportAspect) || 0).toFixed(2),
].join('|');
