import { getCineramaSettings, updateCineramaSettings } from './cineramaSettings.mjs';
import { createCineramaPanelKeepAlive, isCineramaModeActive, PANEL_ATTRIBUTE } from './hostPanel.mjs';
import {
    CINERAMA_HERO_FILL_AXIS_VALUES,
    CINERAMA_MARQUEE_EDGE_COLOR_VALUES,
    CINERAMA_MARQUEE_EDGE_SIDES_VALUES,
    CINERAMA_MARQUEE_EDGE_VALUES,
    CINERAMA_MARQUEE_FILL_COLOR_VALUES,
    CINERAMA_MARQUEE_FILL_VALUES,
    CINERAMA_MARQUEE_VALUES,
} from './cineramaOptions.mjs';

// mods/cinerama/settingsPanel.mjs
// 巨幕自带的设置面板。挂载点由 hostPanel.mjs 负责（挂在动画模式选择器卡片的下一个兄弟位，
// 与内置模式的设置卡片同层），这里只管两件事：
//
//   1. 表单本身——旋钮的说明、范围、取值；值写进 cineramaSettings.mjs 的共享单例
//      （落盘用模组自己的 localStorage，与宿主的任何持久化互不干扰），渲染层每帧读同一份，
//      所以拖动即时生效；
//   2. 可见性——只有当前歌词动画模式确实是巨幕时才显示。
//
// 旋钮按「两条轴」分组，与解算层一一对应：
//   屏面排版（排版本体，三个概率权重）／跑马灯带（叠加元素）／斜切丝带。
// 分组学内置模式（如凝彩的「动态与调色 / 渲染质量」）：一屏十几个旋钮不分组就分不清哪几个
// 是一伙的。
//
// 面板不碰宿主的任何 store：mod.json 刻意不声明 `visualizers[].settings`（宿主会照那份
// schema 再渲染一组同样的旋钮），所以这组旋钮是巨幕的唯一一组；实时调制通道
// （k3panel 写的那个）仍由宿主的 props.getModulation() 送进贡献层，盖在持久化值上。

const MOD_ID = 'cinerama';
// 与 mod.json 的 visualizers[0].id 拼出来的 mode id 一致：锚点用它判定「当前模式是巨幕」。
const MODE_ID = `mod:${MOD_ID}:cinerama-screen`;

/*
 * 多选一的取值来自解算层的枚举（cineramaOptions），这里只写文案：
 * 两边漂移时按钮会少一个，总比给出一个解算层不认的值强。
 * 样式不在这里——它是三个权重滑块，不是档位。
 */
const CHOICE_VALUES = {
    marquee: CINERAMA_MARQUEE_VALUES,
    marqueeFill: CINERAMA_MARQUEE_FILL_VALUES,
    marqueeFillColor: CINERAMA_MARQUEE_FILL_COLOR_VALUES,
    marqueeEdge: CINERAMA_MARQUEE_EDGE_VALUES,
    marqueeEdgeColor: CINERAMA_MARQUEE_EDGE_COLOR_VALUES,
    marqueeEdgeSides: CINERAMA_MARQUEE_EDGE_SIDES_VALUES,
    heroFillAxis: CINERAMA_HERO_FILL_AXIS_VALUES,
};

/*
 * 旋钮表：key / 类型 / 文案 / 范围 / 缺省。与 cineramaOptions.mjs 的
 * RANGES / DEFAULTS / 枚举一一对应，改一处必须改另一处。
 *
 * 分组按**用户要调什么**来分（不是按代码里的轴）：一屏二十多个旋钮不分组就分不清哪几个
 * 是一伙的。五组的顺序也照「从整体到局部」排——先决定这一幕由哪几种排版轮着来，再决定
 * 字怎么处理、长什么样，最后才是两条叠加上去的东西（跑马灯带、斜切丝带）。
 *
 * **关于「自动」**：这一档只存在于跑马灯带的带型上（关 / 自动 / 双带 / 四边），
 * 因为「这一句叠不叠带、叠双带还是四边」本来就该按句随机。**排版本体没有「自动」**：
 * 它是三个概率权重（大字报 / 小字报 / 斜切丝带），每句按三者之比抽一个——
 * 「自动」和几个显式档位说的是同一件事，而权重还能顺带表达「某档多一点」。
 * 排版落点（居中 / 偏置 / 宽银幕）同理由权重表达，居中那一档是兜底、不进旋钮。
 */
const FIELD_GROUPS = [
    {
        title: { 'zh-CN': '内容与概率', en: 'Content & odds' },
        hint: {
            'zh-CN': '屏幕上出现什么，以及各占多少。排版本体每句按三项之比抽一个，排版落点同理：只看比例，不必加起来是 1；拖到 0 就是不再出现它。',
            en: 'What appears on screen, and in what proportion. A layout body is drawn per line from the three weights, and the placement weights work the same way: only the ratio matters, and they need not add up to 1. Drag one to 0 to drop it.',
        },
        fields: [
            {
                key: 'heroWeight',
                type: 'number',
                label: { 'zh-CN': '大字报', en: 'Hero type' },
                hint: { 'zh-CN': '整行按词切块、逐块闪现，每块都在屏内。', en: 'The line is cut into word chunks and flashes chunk by chunk; every chunk stays on screen.' },
                min: 0, max: 1, step: 0.05, defaultValue: 0.4,
            },
            {
                key: 'smallWeight',
                type: 'number',
                label: { 'zh-CN': '小字报', en: 'Small type' },
                hint: { 'zh-CN': '兜底样式，任何行都排得下，整行一个字号。', en: 'The fallback: any line fits, one size for the whole line.' },
                min: 0, max: 1, step: 0.05, defaultValue: 0.2,
            },
            {
                key: 'ribbonWeight',
                type: 'number',
                label: { 'zh-CN': '斜切丝带', en: 'Ribbons' },
                hint: { 'zh-CN': '整句上带、斜切拼贴，不与跑马灯带同现。', en: 'The whole line on skewed ribbons; never shown together with the marquee.' },
                min: 0, max: 1, step: 0.05, defaultValue: 0.4,
            },
            {
                key: 'layoutEarlyWeight',
                type: 'number',
                label: { 'zh-CN': '偏置落点', en: 'Off-centre placement' },
                hint: {
                    'zh-CN': '上/下三分之一、左右两栏这几档合在一起的权重。它们都离开画面正中，给多了整屏居中的那一档就少。',
                    en: 'Weight of the upper / lower third and the left / right bands grouped together. They all leave the centre, so more of them means fewer fully-centred lines.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 1,
            },
            {
                key: 'layoutLetterboxWeight',
                type: 'number',
                label: { 'zh-CN': '宽银幕字幕条', en: 'Letterbox strip' },
                hint: {
                    'zh-CN': '电影字幕那一档：字号更小、字距更宽，压在屏体下缘。',
                    en: 'The cinema-subtitle tier: smaller type, wider tracking, pressed against the bottom edge.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 0.5,
            },
        ],
    },
    {
        title: { 'zh-CN': '歌词处理', en: 'Lyric treatment' },
        hint: {
            'zh-CN': '整首歌词怎么被切分与处理。前三项每句掷点，同一首歌每次播放结果一致。',
            en: 'How the lyrics get split and treated. The first three are drawn per line and stay identical across replays of the same song.',
        },
        fields: [
            {
                key: 'heroChunkChance',
                type: 'number',
                label: { 'zh-CN': '并词强度', en: 'Word-join' },
                hint: {
                    'zh-CN': '大字报按词分词，收一个词后按此概率再并下一个。0 最碎，一词一闪；1 装得下就并到底。',
                    en: 'Hero type segments by word: after each word it keeps joining at this chance. 0 is the most fragmented, one word per flash; 1 joins while it fits.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 0.55,
            },
            {
                key: 'unitStagger',
                type: 'number',
                label: { 'zh-CN': '逐段落位节奏', en: 'Segment cadence' },
                hint: {
                    'zh-CN': '整行各段落位的快慢。调大各段叠得多，像一道扫过去；调小一段一段点着来。不改出词的时刻。',
                    en: 'How fast the segments settle in. Higher overlaps them into one sweep, lower ticks them out one by one. The moments themselves never move.',
                },
                min: 0.4, max: 2, step: 0.05, defaultValue: 0.6,
            },
            {
                key: 'heroMotion',
                type: 'number',
                label: { 'zh-CN': '块级运动强度', en: 'Chunk motion' },
                hint: {
                    'zh-CN': '大字报每块挂住时的持续动作幅度：推近、拉远、横移、摊开一起缩。0 落定后完全不动，1 是设计默认。填色的块本来就不动。',
                    en: 'Amplitude of the sustained per-chunk motion: push, pull, slide and spread scale together. 0 freezes chunks once settled, 1 is the design default. Filled chunks never move anyway.',
                },
                min: 0, max: 1.5, step: 0.05, defaultValue: 1,
            },
            {
                key: 'heroFillAxis',
                type: 'choice',
                label: { 'zh-CN': '填色方向', en: 'Fill direction' },
                hint: {
                    'zh-CN': '大字报填色推进的方向。自动按块抽横或竖，相邻两块不重复；钉死之后整首只走一个方向。',
                    en: 'Direction the fill sweeps. Auto draws it per chunk, horizontal or vertical and never twice in a row; pinning it locks the whole song to one direction.',
                },
                defaultValue: 'both',
                options: [
                    { value: 'both', label: { 'zh-CN': '自动', en: 'Auto' } },
                    { value: 'x', label: { 'zh-CN': '水平', en: 'Horizontal' } },
                    { value: 'y', label: { 'zh-CN': '竖直', en: 'Vertical' } },
                ],
            },
            {
                key: 'fillChance',
                type: 'number',
                label: { 'zh-CN': '填色概率', en: 'Fill odds' },
                hint: {
                    'zh-CN': '填色的出现概率倍率，1 是设计默认，本来就只在长块上偶尔出现。拖到 0 整首不填色，那些块改做运动。',
                    en: 'Multiplier on the odds of the fill, which is already rare and only on longer chunks at the design default of 1. At 0 nothing fills and those chunks take a motion instead.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 1,
            },
        ],
    },
    {
        title: { 'zh-CN': '文字样式', en: 'Type style' },
        hint: {
            'zh-CN': '大字报与小字报共用的一份字形与疏密，1 就是设计默认。斜切丝带与跑马灯带上的字另有自己的尺度，不受这组影响。',
            en: 'One shared type treatment for hero and small type, where 1 is the design default. Ribbon and marquee text keep their own scales and are not affected.',
        },
        fields: [
            {
                key: 'fontScale',
                type: 'number',
                label: { 'zh-CN': '字号', en: 'Type size' },
                hint: {
                    'zh-CN': '在不把词挤出屏的安全字号上再乘一次。调大就可能出屏，大字报被裁掉、小字报顶上屏沿，这是刻意的：安全字号是保底不是上限。',
                    en: 'Multiplies the safe size that keeps every chunk on screen. Going over 1 can overflow, clipping hero chunks or pushing small type into the edge, and that is on purpose: the safe size is a floor, not a cap.',
                },
                min: 0.8, max: 1.3, step: 0.02, defaultValue: 1,
            },
            {
                key: 'letterSpacing',
                type: 'number',
                label: { 'zh-CN': '字距', en: 'Tracking' },
                hint: { 'zh-CN': '字与字之间多松。整块会跟着变宽，拖大之后字号可能要收一点。', en: 'How loose the glyphs sit. The block widens with it, so you may want to pull the type size back when raising it.' },
                min: 0.6, max: 1.6, step: 0.05, defaultValue: 1,
            },
            {
                key: 'lineHeight',
                type: 'number',
                label: { 'zh-CN': '行距', en: 'Line height' },
                hint: { 'zh-CN': '折行时两行之间多紧。调小两行贴得更近，长句折出的几行收成一块密字。', en: 'How tight wrapped lines sit. Lower pulls them together, so a long line reads as one dense block.' },
                min: 0.85, max: 1.25, step: 0.01, defaultValue: 1,
            },
            {
                key: 'italicChance',
                type: 'number',
                label: { 'zh-CN': '斜体比例', en: 'Italics' },
                hint: {
                    'zh-CN': '大字报里有多少块用斜体，按块抽，0 是一块都不斜。中文字体没有真斜体，浏览器只能合成倾斜，开高会读成渲染出错。',
                    en: 'Share of hero chunks drawn in italic, drawn per chunk. 0 means none. CJK has no true italic face, so the browser synthesises the slant, and turning this up reads as a rendering bug.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 1,
            },
        ],
    },
    {
        title: { 'zh-CN': '跑马灯带', en: 'Marquee bands' },
        hint: {
            'zh-CN': '叠加大字报与小字报的一层，斜切丝带不与它同现。可以是一条横带，也可以绕屏一圈。',
            en: 'A layer added on top of hero and small type, never combined with ribbons. Either two bands across the screen or one ring around it.',
        },
        fields: [
            {
                key: 'marquee',
                type: 'choice',
                label: { 'zh-CN': '带型', en: 'Bands' },
                hint: { 'zh-CN': '自动按句抽双带或四边，同一首歌每次一致。怀疑某一档没出现时，直接选它即可验证。', en: 'Auto draws two bands or the ring per line, stable across replays. Pick one explicitly to force it for verification.' },
                defaultValue: 'auto',
                options: [
                    { value: 'off', label: { 'zh-CN': '关', en: 'Off' } },
                    { value: 'auto', label: { 'zh-CN': '自动', en: 'Auto' } },
                    { value: 'bands', label: { 'zh-CN': '双带', en: 'Two bands' } },
                    { value: 'frame', label: { 'zh-CN': '四边', en: 'Four sides' } },
                ],
            },
            {
                key: 'marqueeSpeed',
                type: 'number',
                label: { 'zh-CN': '带速', en: 'Band speed' },
                hint: {
                    'zh-CN': '带上文字横向滚动的速度。与歌词长短无关，短句长句一样快。',
                    en: 'How fast the band text scrolls. Independent of lyric length: short and long lines move alike.',
                },
                min: 0.2, max: 3, step: 0.05, defaultValue: 1,
            },
            {
                key: 'marqueeBandPct',
                type: 'number',
                label: { 'zh-CN': '带高（屏高%）', en: 'Band height (% of screen)' },
                hint: { 'zh-CN': '固定值，不随歌词变化。双带各占这么多，四边四条边都占。', en: 'Fixed, and does not follow the lyric. Each of the two bands takes this much; the ring takes it on all four sides.' },
                min: 6, max: 20, step: 0.5, defaultValue: 12,
            },
            {
                key: 'marqueeFontRatio',
                type: 'number',
                label: { 'zh-CN': '带内字高（占带高）', en: 'Text size (of band height)' },
                hint: { 'zh-CN': '固定值，按带高的比例取字号，长短句不会忽大忽小。', en: 'Fixed as a share of the band height, so it never jumps between lines.' },
                min: 0.3, max: 0.8, step: 0.05, defaultValue: 0.55,
            },
            {
                key: 'marqueeTitleChance',
                type: 'number',
                label: { 'zh-CN': '歌名出现概率', en: 'Song-title odds' },
                hint: {
                    'zh-CN': '带上跑当前行、译文还是歌曲标题，这一项是歌名被抽中的系数。歌名是装饰，默认压得比较低。',
                    en: 'What runs on the band: the line, the translation or the song title. This is the title\'s share, and being a decoration it defaults low.',
                },
                min: 0, max: 1, step: 0.05, defaultValue: 0.25,
            },
            {
                key: 'marqueeFill',
                type: 'choice',
                label: { 'zh-CN': '带身填色', en: 'Band fill' },
                hint: {
                    'zh-CN': '带子那块区域着不着色。默认不填：带子本身就是屏体，靠边线那道灯与带上的字读出来，铺色底反而会压成一块色条。',
                    en: 'Whether the band area is tinted. Off by default: the band is the screen itself, read from its edge light and the text, while a wash flattens it into a coloured bar.',
                },
                defaultValue: 'none',
                options: [
                    { value: 'none', label: { 'zh-CN': '不填色', en: 'None' } },
                    { value: 'tint', label: { 'zh-CN': '淡色底', en: 'Tint' } },
                ],
            },
            {
                key: 'marqueeFillColor',
                type: 'choice',
                label: { 'zh-CN': '填色色彩', en: 'Fill color' },
                hint: {
                    'zh-CN': '淡色底取哪个色轴。强调色是底与带上的字同一个光源，辅助色是两层。只影响填色，不动边线。',
                    en: 'Which color axis the fill uses. Accent puts the fill and the band text under one light source, secondary splits them into two layers. Fill only; the edge is separate.',
                },
                defaultValue: 'accent',
                options: [
                    { value: 'accent', label: { 'zh-CN': '强调色', en: 'Accent' } },
                    { value: 'secondary', label: { 'zh-CN': '辅助色', en: 'Secondary' } },
                ],
            },
            {
                key: 'marqueeEdge',
                type: 'choice',
                label: { 'zh-CN': '边线', en: 'Band edge' },
                hint: {
                    'zh-CN': '带子那两条长边怎么画。实线是 1px 硬边，勾出范围；辉光只有光晕没有硬边。',
                    en: 'How the band\'s long edges are drawn. Solid is a 1px hairline that outlines the band; glow is a halo with no hairline.',
                },
                defaultValue: 'glow',
                options: [
                    { value: 'none', label: { 'zh-CN': '不画边', en: 'None' } },
                    { value: 'solid', label: { 'zh-CN': '实线', en: 'Solid' } },
                    { value: 'glow', label: { 'zh-CN': '辉光', en: 'Glow' } },
                ],
            },
            {
                key: 'marqueeGlow',
                type: 'number',
                label: { 'zh-CN': '边线辉光', en: 'Edge glow' },
                hint: {
                    'zh-CN': '边子那道灯的强度：缩放亮芯与光晕的扩散，缺省 0.3 就够浓。0 整档淡出，1 各层满扩散。不管带上的字。',
                    en: 'Strength of the lamp along the edge: how far the bright core and halo spread. 0.3 already reads; 0 fades it out, 1 is full spread. Does not touch the text.',
                },
                min: 0, max: 1.5, step: 0.05, defaultValue: 0.3,
            },
            {
                key: 'marqueeTextGlow',
                type: 'number',
                label: { 'zh-CN': '文字辉光', en: 'Text glow' },
                hint: {
                    'zh-CN': '带上的字那圈同色光的大小与浓度。缺省 0.2 只留一点弱影：带子的亮主要来自边线那道灯。拖到 2 字自己在发光。',
                    en: 'Size and density of the same-colour glow around the band text. The 0.2 default keeps only a faint halo, since the edge lamp carries the brightness; 2 makes the text glow on its own.',
                },
                min: 0, max: 2, step: 0.05, defaultValue: 0.2,
            },
            {
                key: 'marqueeEdgeColor',
                type: 'choice',
                label: { 'zh-CN': '边线色彩', en: 'Edge color' },
                hint: {
                    'zh-CN': '边线取哪个色轴。跟随是实线取辅助色、辉光取强调色，即旧观感。亮色主题下辉光是一道压进屏面的暗槽，槽色由这一轴压暗而成。',
                    en: 'Which color axis the edge uses. Auto gives the hairline the secondary color and the glow the accent, matching the previous look. On light themes the glow is a pressed groove whose colour is this axis darkened.',
                },
                defaultValue: 'auto',
                options: [
                    { value: 'auto', label: { 'zh-CN': '跟随', en: 'Auto' } },
                    { value: 'accent', label: { 'zh-CN': '强调色', en: 'Accent' } },
                    { value: 'secondary', label: { 'zh-CN': '辅助色', en: 'Secondary' } },
                ],
            },
            {
                key: 'marqueeEdgeSides',
                type: 'choice',
                label: { 'zh-CN': '边线范围', en: 'Edge sides' },
                hint: {
                    'zh-CN': '画在哪几条边上。内侧只画朝屏幕中心的那条或那几条，双侧连贴着屏沿的也画；左右两端一律不画。',
                    en: 'Which sides get the edge. Inner draws only the side facing the screen center, one for each band or four for the ring, and both also draws the side hugging the screen edge. The two short ends are never drawn.',
                },
                defaultValue: 'inner',
                options: [
                    { value: 'inner', label: { 'zh-CN': '内侧', en: 'Inner' } },
                    { value: 'both', label: { 'zh-CN': '双侧', en: 'Both' } },
                ],
            },
            {
                key: 'marqueeEdgeDrift',
                type: 'number',
                label: { 'zh-CN': '边线流动', en: 'Edge flow' },
                hint: {
                    'zh-CN': '边线那道灯沿带子流动的快慢。缺省 0：带上的字本来就贴着边线，灯一流动就会穿过字身、读成第二条线。',
                    en: 'How fast the edge light travels along the band. 0 by default: the band text sits against the edge, so a moving light crosses the glyphs and reads as a second line.',
                },
                min: 0, max: 3, step: 0.05, defaultValue: 0,
            },
        ],
    },
    {
        title: { 'zh-CN': '斜切丝带', en: 'Ribbons' },
        hint: {
            'zh-CN': '抽到斜切丝带时这一叠胶带长什么样。丝带整句上带、自己上下漂移，文字沿带滚动，两个速度互不牵动。',
            en: 'What the tape stack looks like when the ribbon body is drawn. A whole line per ribbon; the stack drifts up and down while the text scrolls along it, and the two speeds are independent.',
        },
        fields: [
            {
                key: 'ribbonCount',
                type: 'number',
                label: { 'zh-CN': '条数', en: 'Count' },
                hint: { 'zh-CN': '一叠几条。角度与位置都不重复，所以条数越多越密。', en: 'How many strips. Angles and positions never repeat, so more means a denser stack.' },
                min: 3, max: 9, step: 1, defaultValue: 6,
            },
            {
                key: 'ribbonAngle',
                type: 'number',
                label: { 'zh-CN': '倾角', en: 'Skew' },
                hint: { 'zh-CN': '整体斜切幅度，超过 1.2 接近竖排，字仍保持正交，只是落点歪了。', en: 'Overall skew, where past 1.2 it reads near-vertical; the glyphs stay upright and only the baseline tilts.' },
                min: 0.4, max: 1.4, step: 0.05, defaultValue: 1,
            },
            {
                key: 'ribbonDrift',
                type: 'number',
                label: { 'zh-CN': '上下漂移', en: 'Drift' },
                hint: { 'zh-CN': '整叠丝带上下漂移的快慢，0 是不动。文字在带上的滚动速度不受这项影响。', en: 'How fast the stack drifts up and down, with 0 for still. The text scroll speed is independent.' },
                min: 0, max: 3, step: 0.05, defaultValue: 1,
            },
        ],
    },
];

const DEFAULT_SETTINGS = FIELD_GROUPS.reduce((acc, group) => {
    group.fields.forEach((field) => { acc[field.key] = field.defaultValue; });
    return acc;
}, {});

/*
 * 导出旋钮表本身（不是面板实例）：单测拿它对**解算层的 DEFAULTS**——两处是硬编码的两份，
 * 一处改了另一处没改，表现就是「面板显示缺省、画面却是另一个数」（这一档漂移过两次）。
 * 只读导出，不参与渲染。
 */
export const CINERAMA_PANEL_FIELD_GROUPS = FIELD_GROUPS;
export const CINERAMA_PANEL_DEFAULT_SETTINGS = DEFAULT_SETTINGS;

const PANEL_TEXT = {
    'zh-CN': {
        title: '巨幕设置',
        desc: '仅当前歌词动画是巨幕时生效；拖动即时改写画面，并保存在本机。',
        // 与宿主卡片头部那颗按钮同一文案（i18n 的 ui.default）。
        default: '默认',
        empty: '宿主尚未提供模组面板挂载点，本节不可用。',
    },
    en: {
        title: 'Cinerama settings',
        desc: 'Applies while the lyrics animation is Cinerama. Drags take effect live and are saved locally.',
        default: 'Default',
        empty: 'The host exposes no mod panel slot; this section is unavailable.',
    },
};

const pickLang = () => (String(document?.documentElement?.lang ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
const pickText = (map) => map[pickLang()] ?? map.en ?? map['zh-CN'] ?? Object.values(map)[0];

const el = (tag, cssText) => {
    const node = document.createElement(tag);
    if (cssText) node.style.cssText = cssText;
    return node;
};

const formatNumber = (value) => {
    const abs = Math.abs(value);
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
};

/*
 * 读数：整数步进的旋钮（步长 ≥ 1，目前只有丝带条数）不该显示成 `6.00`——那是「条数」，
 * 不是一个小数。判据取步长而不是白名单，将来加整型旋钮不用回来改这里。
 */
const formatReadout = (value, step) => (
    Number(step) >= 1 ? String(Math.round(Number(value))) : formatNumber(Number(value))
);

/*
 * 外观全部从宿主写在根元素上的主题变量派生（--bg-color / --text-primary /
 * --text-secondary，见 src/components/app/presentation/buildAppStyle.ts），所以亮色与
 * 暗色主题自动跟手：模组既不用判断当前是白天还是夜里，也不用解析主题色字符串
 * （主题色是任意格式的 CSS，模组侧做不出可靠的 alpha 化）。
 *
 * 混色因此一律走 color-mix——让浏览器去算，变量缺席时退回后面的中性灰兜底。
 *
 * 卡片形态照抄宿主内置模式的设置卡片（`rounded-[24px] border p-4 space-y-4` +
 * controlCardBg）：巨幕这块和 Luminous / Sonnet 那些细节设置现在是同一张脸。
 */
const PANEL_STYLE_ID = 'cinerama-settings-panel-style';
const PANEL_STYLE = [
    '[data-cinerama-panel="settings"] .cinerama-range {',
    '  -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px;',
    '  cursor:pointer; background:color-mix(in srgb, var(--text-primary) 16%, transparent);',
    '}',
    '[data-cinerama-panel="settings"] .cinerama-range::-webkit-slider-thumb {',
    '  -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%;',
    '  background:var(--text-primary); transition:transform 0.15s ease;',
    '}',
    '[data-cinerama-panel="settings"] .cinerama-range::-webkit-slider-thumb:hover { transform:scale(1.25); }',
    '[data-cinerama-panel="settings"] .cinerama-range::-moz-range-thumb {',
    '  width:14px; height:14px; border:0; border-radius:50%; background:var(--text-primary);',
    '  transition:transform 0.15s ease;',
    '}',
    // 多选一的 pill 照抄宿主 VisualizerPresetGroup 的尺寸：px-3 py-2 / rounded-full / text-sm / border。
    '[data-cinerama-panel="settings"] .cinerama-choice {',
    '  padding:8px 12px; border-radius:999px; font-size:14px; line-height:1.4;',
    '  cursor:pointer; border:1px solid; box-sizing:border-box;',
    '  transition:background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;',
    '}',
    '[data-cinerama-panel="settings"] .cinerama-reset:hover { opacity:0.8; }',
].join('\n');

const ensurePanelStyle = () => {
    try {
        if (document.getElementById(PANEL_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = PANEL_STYLE_ID;
        style.textContent = PANEL_STYLE;
        document.head.append(style);
    } catch {
        // 拿不到 head 就只剩内联样式：滑块退化成系统默认外观，功能不受影响。
    }
};

const CARD_CSS = [
    'border-radius:24px', 'padding:16px', 'display:flex', 'flex-direction:column', 'gap:16px',
    'background:rgba(127,127,127,0.14)',
    'background:color-mix(in srgb, var(--bg-color) 46%, transparent)',
    'border:1px solid rgba(127,127,127,0.2)',
    'border-color:color-mix(in srgb, var(--text-primary) 12%, transparent)',
    'color:var(--text-primary)', 'font-size:13px',
].join(';');

/*
 * 一组旋钮的小节：标题走**强调色**（与内置模式的莫奈面板同一套分层——标题用 accent、
 * 分组本身是一块比卡片更暗的内衬），上端再压一条分隔线，五组因此一眼分得开。
 * 分隔线用第一条子元素的 `border-top`，而不是父元素的 gap——省一层节点。
 */
const GROUP_CSS = [
    'display:flex', 'flex-direction:column', 'gap:12px',
    'padding-top:16px',
    'border-top:1px solid rgba(127,127,127,0.16)',
    'border-color:color-mix(in srgb, var(--text-primary) 10%, transparent)',
].join(';');
const GROUP_TITLE_CSS = 'font-size:12px;font-weight:600;letter-spacing:0.02em;color:var(--text-accent, var(--text-primary));';
const FIELD_CSS = 'display:flex;flex-direction:column;gap:8px;';
const LINE_CSS = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
const NAME_CSS = 'color:var(--text-primary);';
const READOUT_CSS = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;opacity:0.7;color:var(--text-secondary);';
// 字段备注：11px 在缩放后的设置面板里读不清，提到 12px；`line-height` 给足——
// 备注要写清「什么时候会出屏」「为什么某一档是兜底」这类后果，一两行装不下。
const HINT_CSS = 'font-size:12px;line-height:1.6;opacity:0.5;color:var(--text-secondary);';
const GROUP_HINT_CSS = `font-size:12px;line-height:1.6;opacity:0.55;color:var(--text-secondary);`;

/*
 * 多选一的两种状态，照宿主 `getAccentOptionStyle`／`VisualizerPresetGroup`：
 * 选中 = **强调色**描边 + 一圈 inset 内阴影 + 强调色淡底；未选中 = 细描边 + 主题背景淡底。
 * 之前用 `--text-primary` 混色，于是在有强调色的主题里和内置模式的 pill 不是一个色系。
 *
 * 强调色取宿主的 `--text-accent`（buildAppStyle.ts 写的 accentColor），缺席才退回
 * `--text-primary`；alpha 走 color-mix——主题色是任意格式的 CSS 字符串，模组侧解析不了。
 * 宿主的选中/未选中 alpha 按亮暗取 0.1/0.16 与 0.24/0.34，模组判断不了白天黑夜，
 * 取中间值即可（0.14 / 0.28），同量级内看不出差别。
 */
const ACCENT = 'var(--text-accent, var(--text-primary))';
const choiceState = (selected) => (selected
    ? [
        'border-color:rgba(127,127,127,0.45)',
        `border-color:${ACCENT}`,
        'box-shadow:inset 0 0 0 1px var(--text-accent, var(--text-primary))',
        'background:rgba(127,127,127,0.16)',
        `background:color-mix(in srgb, ${ACCENT} 14%, transparent)`,
        'color:var(--text-primary)',
    ].join(';')
    : [
        'border-color:rgba(127,127,127,0.3)',
        'border-color:color-mix(in srgb, var(--text-secondary, var(--text-primary)) 18%, transparent)',
        'background:rgba(127,127,127,0.18)',
        'background:color-mix(in srgb, var(--bg-color, #808080) 28%, transparent)',
        'color:var(--text-primary)',
    ].join(';'));

/*
 * 「默认」按钮照宿主 `ResetSectionButton`（卡片头部右侧那颗）：
 * `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs`
 * + secondary 色文字/描边 + 主题背景淡底。宿主的按钮是 React 组件、重置的是内置模式自己的
 * tuning store，模组复用不了（也拿不到它的 onClick），所以这里复刻同样的位置与外观，
 * 行为由模组自己接。
 */
const RESET_CSS = [
    'display:inline-flex', 'align-items:center', 'gap:6px', 'flex:none',
    'padding:6px 10px', 'border-radius:999px', 'font-size:12px', 'cursor:pointer',
    'border:1px solid rgba(127,127,127,0.3)',
    'border-color:color-mix(in srgb, var(--text-secondary, var(--text-primary)) 16%, transparent)',
    'background:rgba(127,127,127,0.16)',
    'background:color-mix(in srgb, var(--bg-color, #808080) 22%, transparent)',
    'color:var(--text-secondary)',
].join(';');

// 12px 的回环箭头（对应宿主那颗按钮里的 lucide RotateCcw），自绘以免引外部图标库。
const SVG_NS = 'http://www.w3.org/2000/svg';
const buildResetIcon = () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'].forEach((d) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    });
    return svg;
};

/*
 * 平铺多选一：一排按钮，点哪个哪个生效（下拉在宿主卡片里会显得又窄又高，
 * 和上下那些滑块不是一个节奏）。返回 { row, set }，set 供「默认」按钮回写选中态。
 */
const buildChoice = ({ field, values, onPick }) => {
    // gap-2（8px）+ flex-wrap：与宿主 PresetGroup 的容器一致。
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:8px;');
    const allowed = CHOICE_VALUES[field.key] ?? values.map(option => option.value);
    const buttons = field.options
        .filter(option => allowed.includes(option.value))
        .map((option) => {
            const button = el('button', '');
            button.type = 'button';
            button.className = 'cinerama-choice';
            button.textContent = pickText(option.label);
            button.addEventListener('click', () => {
                onPick(option.value);
                sync(option.value);
            });
            row.append(button);
            return { button, value: option.value };
        });

    const sync = (current) => {
        buttons.forEach(({ button, value }) => {
            button.style.cssText = choiceState(value === current);
        });
    };
    sync(values[field.key] ?? field.defaultValue);

    return { row, set: sync };
};

const buildPanel = (values) => {
    const text = PANEL_TEXT[pickLang()] ?? PANEL_TEXT.en;
    ensurePanelStyle();

    const root = el('div', CARD_CSS);
    root.setAttribute(PANEL_ATTRIBUTE, 'settings');

    // 头部与宿主卡片一个布局：左「标题 + 描述」、右「默认」按钮（justify-between）。
    const head = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;');
    const headText = el('div', 'display:flex;flex-direction:column;gap:4px;min-width:0;');
    const title = el('div', 'font-size:14px;font-weight:500;');
    title.textContent = text.title;
    const desc = el('div', 'font-size:12px;opacity:0.5;line-height:1.5;color:var(--text-secondary);');
    desc.textContent = text.desc;
    headText.append(title, desc);

    const reset = el('button', RESET_CSS);
    reset.className = 'cinerama-reset';
    reset.type = 'button';
    reset.append(buildResetIcon());
    const resetLabel = el('span');
    resetLabel.textContent = text.default;
    reset.append(resetLabel);

    head.append(headText, reset);
    root.append(head);

    const inputs = new Map();

    FIELD_GROUPS.forEach((group, groupIndex) => {
        const box = el('div', GROUP_CSS);
        // 第一组上方不需要分隔线（紧挨着卡片头部）。
        if (groupIndex === 0) box.style.borderTop = 'none';
        const groupTitle = el('div', GROUP_TITLE_CSS);
        groupTitle.textContent = pickText(group.title);
        box.append(groupTitle);
        if (group.hint) {
            const groupHint = el('div', GROUP_HINT_CSS);
            groupHint.textContent = pickText(group.hint);
            box.append(groupHint);
        }

        group.fields.forEach((field) => {
            // 写共享单例（顺带落盘）：渲染层每帧读同一份，所以下一帧就见效。
            const apply = (value) => {
                updateCineramaSettings({ [field.key]: value });
            };

            if (field.type === 'choice') {
                const line = el('div', LINE_CSS);
                const name = el('span', NAME_CSS);
                name.textContent = pickText(field.label);
                line.append(name);
                const choice = buildChoice({
                    field,
                    values,
                    onPick: value => apply(value),
                });
                box.append(line, choice.row);
                inputs.set(field.key, { set: choice.set });
            } else {
                const row = el('div', FIELD_CSS);
                const line = el('div', LINE_CSS);
                const name = el('span', NAME_CSS);
                name.textContent = pickText(field.label);
                const readout = el('span', READOUT_CSS);
                readout.textContent = formatReadout(Number(values[field.key] ?? field.defaultValue), field.step);
                line.append(name, readout);

                const range = el('input', '');
                range.type = 'range';
                range.className = 'cinerama-range';
                range.min = String(field.min);
                range.max = String(field.max);
                range.step = String(field.step);
                range.value = String(values[field.key] ?? field.defaultValue);
                range.addEventListener('input', () => {
                    const value = Number(range.value);
                    readout.textContent = formatReadout(value, field.step);
                    apply(value);
                });
                row.append(line, range);
                box.append(row);
                inputs.set(field.key, { set: value => { range.value = String(value); readout.textContent = formatReadout(Number(value), field.step); } });
            }

            if (field.hint) {
                const hint = el('div', HINT_CSS);
                hint.textContent = pickText(field.hint);
                box.append(hint);
            }
        });

        root.append(box);
    });

    // 行为接在头部那颗「默认」上（宿主的同款按钮也是重置这一整张卡片）。
    reset.addEventListener('click', () => {
        updateCineramaSettings(DEFAULT_SETTINGS);
        Object.keys(DEFAULT_SETTINGS).forEach((key) => {
            inputs.get(key)?.set(DEFAULT_SETTINGS[key]);
        });
    });

    return root;
};

/*
 * 当前歌词动画模式是不是巨幕：判断交给 hostPanel.isCineramaModeActive ——
 * 只看锚点的 mode id，锚点缺席（旧宿主）判「不是」。判不出来时**隐藏**：
 * 面板是手动插进宿主 DOM 的非受控节点，判成显示会让它留在无关分区里。
 */
const isCineramaActive = () => isCineramaModeActive(MODE_ID);

/*
 * 装配整个面板：建 DOM、随宿主重绘补挂、按当前模式切换可见性。返回 dispose。
 * 不适用（当前模式不是巨幕、或宿主不在歌词动画这一屏）时隐藏；宿主切到别的分区时
 * hostPanel 会直接把面板摘下来，节点对象仍在，回来后自动插回原位。
 *
 * 可见性与挂载共用 keepAlive 那一个轮询（onMount 回调），不再单独起定时器：
 * 两个频率不一致时会出现「刚插上还是隐藏的」这种空白一拍。
 *
 * 单例：巨幕的 mount 会在多个地方各跑一次（播放页、设置面板里的预览），
 * 而设置卡片只有一张。第二个及以后的实例直接共用第一个的节点——
 * 多插一份面板会让同一批旋钮出现两次，改一份另一份不动。
 */
let activePanel = null;
let activeDispose = null;

export const createCineramaSettingsPanel = () => {
    if (activePanel) {
        activePanel.refCount += 1;
        // 记下这一轮拿到的实例：引用计数归零后 activePanel 会被清空，
        // 宿主再调一次 dispose（StrictMode、热重载、异常路径都会）时不能再去读它。
        const panel = activePanel;
        return () => {
            if (!panel || panel !== activePanel) return;
            panel.refCount -= 1;
            if (panel.refCount <= 0) {
                activeDispose?.();
                activeDispose = null;
                activePanel = null;
            }
        };
    }

    const values = getCineramaSettings();
    const root = buildPanel(values);

    // 可见性跟着宿主走：切模式按钮时宿主会重建选择器，切分区时锚点整块消失，
    // 每轮补挂后重新判一次即可（与 keepAlive 同一个定时器）。
    const syncVisibility = () => {
        root.style.display = isCineramaActive() ? '' : 'none';
    };
    syncVisibility();

    // modeId 交给 keepAlive：不该在这一屏时它降到慢档（见 createCineramaPanelKeepAlive）。
    const disposeKeepAlive = createCineramaPanelKeepAlive(root, { modeId: MODE_ID, onMount: syncVisibility });
    activePanel = { root, refCount: 1 };
    activeDispose = () => {
        disposeKeepAlive();
    };
    const panel = activePanel;
    return () => {
        // 同上：teardown 之后 activePanel 为 null，重复 dispose 不能崩。
        if (!panel || panel !== activePanel) return;
        panel.refCount -= 1;
        if (panel.refCount <= 0) {
            activeDispose?.();
            activeDispose = null;
            activePanel = null;
        }
    };
};
