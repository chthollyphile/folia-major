// Copyright (c) 2026 chthollyphile
import type { Mood } from './hanabiKernel';
import type {
    BlockStyle,
    BurstKind,
    BurstSpec,
    EnterFx,
    ExitFx,
    HanabiProfile,
    OrnamentKind,
    OrnamentPlacement,
    OrnamentSpec,
    PaletteRole,
    SingFx,
    TextLayout,
    TextSpec,
} from './types';

// src/components/visualizer/hanabi/catalog.ts
// 花火的预设目录：10 族 × 5 = 50 个镜头风格（docs/HANABI.md「10 族」），全是数据，由同一个 scene.ts 解释。

export const HANABI_FAMILY_LABELS: Record<string, string> = {
    uchiage: '打上',
    kiku: '菊',
    botan: '牡丹',
    yanagi: '柳',
    senrin: '千輪',
    hoshikuzu: '星屑',
    obi: '帯',
    senko: '閃光',
    senkohanabi: '線香',
    shakudama: '尺玉',
};

/** 各族的画面，一句话（AI 编排与 agent 的风格目录里用）。 */
export const HANABI_FAMILY_DESCRIPTIONS: Record<string, string> = {
    uchiage: '升空尾迹从画面底边升起，开花的一瞬字从下往上升入，镜头跟着往上走，最典型的上升感，哪段都能用',
    kiku: '居中的大字，背后开带尾迹的菊花，集中线与扩散圆环，正面、有冲击力',
    botan: '饱满的大色块（整条色带、方块、双层错位），字弹出或砸下，圆润的色点烟花，明快热闹',
    yanagi: '竖排、慢，柳火与金冠长长地垂落，字像柳枝一样落下退场，安静、抒情',
    senrin: '每个被唱到的字各开一朵小花，字散落或错落，节奏快，适合密集的歌词与副歌',
    hoshikuzu: '四角星、光点与点线，字发着光、碎成星屑退场，梦幻、轻盈',
    obi: '日式 PV 的色带排字：斜块、票据、荧光笔、错落的阶梯，擦出、打字、滑动，干净利落',
    senko: '点滅、故障、乱码翻动、频闪与速度线，硬切，最躁动，适合电子感与高能段落',
    senkohanabi: '线香花火：小而密的火花贴着字噼啪作响，暗色调，温柔、私密，适合主歌与尾声',
    shakudama: '一两个字的超大显示，巨大的冠与双层烟花、旭日放射，副歌高潮与全曲最高点',
};

// ─── 零件 ──────────────────────────────────────────────────────────────

/** 各种烟花的基准参数（组件槽换烟花种类时也用它）。 */
const BURST_PRESETS: Record<BurstKind, Omit<BurstSpec, 'kind' | 'colors'>> = {
    kiku: { count: 96, radius: 0.3, duration: 1.9, trail: 0.65, twinkle: 0.2 },
    botan: { count: 84, radius: 0.26, duration: 1.4, trail: 0.1, twinkle: 0.1 },
    yanagi: { count: 64, radius: 0.3, duration: 3.2, trail: 0.9, twinkle: 0.3 },
    kamuro: { count: 110, radius: 0.36, duration: 3.6, trail: 0.95, twinkle: 0.55 },
    senrin: { count: 72, radius: 0.22, duration: 1.7, trail: 0.3, twinkle: 0.45 },
    ring: { count: 60, radius: 0.26, duration: 1.4, trail: 0.3, twinkle: 0.1 },
    heart: { count: 60, radius: 0.2, duration: 1.6, trail: 0.2, twinkle: 0.2 },
    star: { count: 55, radius: 0.2, duration: 1.6, trail: 0.2, twinkle: 0.3 },
    palm: { count: 36, radius: 0.32, duration: 2.3, trail: 0.8, twinkle: 0.1 },
    crossette: { count: 40, radius: 0.26, duration: 1.9, trail: 0.4, twinkle: 0.2 },
    strobe: { count: 72, radius: 0.28, duration: 2.3, trail: 0.15, twinkle: 1 },
    hachi: { count: 50, radius: 0.24, duration: 1.6, trail: 0.6, twinkle: 0.5 },
    'willow-ring': { count: 100, radius: 0.34, duration: 2.8, trail: 0.7, twinkle: 0.3 },
    mine: { count: 84, radius: 0.5, duration: 1.8, trail: 0.7, twinkle: 0.3 },
};

export const BURST_KINDS = Object.keys(BURST_PRESETS) as BurstKind[];

/** 某种烟花的基准 spec（colors 取调色板 sparks 的下标）。 */
export const burstPreset = (kind: BurstKind, colors: number[] = [0, 1, 2]): BurstSpec => ({ kind, colors, ...BURST_PRESETS[kind] });

const burst = (kind: BurstKind, colors: number[], patch: Partial<BurstSpec> = {}): BurstSpec => ({ ...burstPreset(kind, colors), ...patch });

/** 被唱到的字放的小烟花。 */
const small = (kind: BurstKind, colors: number[], patch: Partial<BurstSpec> = {}): BurstSpec => ({
    ...burstPreset(kind, colors),
    count: 14,
    radius: 0.05,
    duration: 0.8,
    ...patch,
});

const orn = (
    kind: OrnamentKind,
    placement: OrnamentPlacement,
    layer: 'back' | 'front',
    patch: Partial<Omit<OrnamentSpec, 'kind' | 'placement' | 'layer'>> = {},
): OrnamentSpec => ({ kind, placement, layer, density: 0.6, scale: 1, color: 'accent', delay: 0, ...patch });

type Region = HanabiProfile['region'];

/** 文字区：离画面边缘至少 6%（内核的镜头畸变会把边缘 5% 推出画面）。 */
const REGIONS = {
    center: { cx: 0.5, cy: 0.5, w: 0.74, h: 0.34 },
    centerHigh: { cx: 0.5, cy: 0.45, w: 0.72, h: 0.32 },
    left: { cx: 0.42, cy: 0.56, w: 0.6, h: 0.34 },
    right: { cx: 0.58, cy: 0.46, w: 0.6, h: 0.34 },
    stagger: { cx: 0.5, cy: 0.5, w: 0.7, h: 0.46 },
    diagonal: { cx: 0.5, cy: 0.5, w: 0.74, h: 0.5 },
    scatter: { cx: 0.5, cy: 0.5, w: 0.78, h: 0.56 },
    vertical: { cx: 0.5, cy: 0.5, w: 0.34, h: 0.72 },
    verticalRight: { cx: 0.62, cy: 0.5, w: 0.3, h: 0.72 },
    verticalSplit: { cx: 0.5, cy: 0.5, w: 0.46, h: 0.72 },
    arc: { cx: 0.5, cy: 0.54, w: 0.74, h: 0.4 },
    giant: { cx: 0.5, cy: 0.5, w: 0.8, h: 0.52 },
    giantLeft: { cx: 0.44, cy: 0.52, w: 0.68, h: 0.5 },
} satisfies Record<string, Region>;

interface Recipe {
    kind: string;
    label: string;
    mood: Mood;
    layout: TextLayout;
    block: BlockStyle;
    enter: EnterFx;
    sing: SingFx;
    exit: ExitFx;
    palette: PaletteRole;
    burst: BurstSpec | null;
    ornaments: OrnamentSpec[];
    region?: Region;
    text?: Partial<Omit<TextSpec, 'layout' | 'block' | 'enter' | 'sing' | 'exit'>>;
    burstAt?: HanabiProfile['burstAt'];
    sungBurst?: BurstSpec | null;
    launch?: boolean;
    camera?: Partial<HanabiProfile['camera']>;
}

/** 一族的共同气质：字号、节奏、描边、镜头、主烟花开在哪。 */
interface FamilyBase {
    text: Omit<TextSpec, 'layout' | 'block' | 'enter' | 'sing' | 'exit'>;
    burstAt: HanabiProfile['burstAt'];
    sungBurst: BurstSpec | null;
    launch: boolean;
    camera: HanabiProfile['camera'];
}

const REGION_OF_LAYOUT: Record<TextLayout, Region> = {
    center: REGIONS.center,
    left: REGIONS.left,
    right: REGIONS.right,
    stagger: REGIONS.stagger,
    diagonal: REGIONS.diagonal,
    scatter: REGIONS.scatter,
    vertical: REGIONS.vertical,
    'vertical-split': REGIONS.verticalSplit,
    arc: REGIONS.arc,
};

const family = (id: string, base: FamilyBase, recipes: Recipe[]): HanabiProfile[] => recipes.map(recipe => ({
    kind: recipe.kind,
    label: recipe.label,
    family: id,
    mood: recipe.mood,
    text: {
        ...base.text,
        ...recipe.text,
        layout: recipe.layout,
        block: recipe.block,
        enter: recipe.enter,
        sing: recipe.sing,
        exit: recipe.exit,
    },
    region: recipe.region ?? REGION_OF_LAYOUT[recipe.layout],
    burst: recipe.burst,
    burstAt: recipe.burstAt ?? base.burstAt,
    sungBurst: recipe.sungBurst !== undefined ? recipe.sungBurst : base.sungBurst,
    ornaments: recipe.ornaments,
    launch: recipe.launch ?? base.launch,
    palette: recipe.palette,
    camera: { ...base.camera, ...recipe.camera },
}));

// ─── 10 族 ─────────────────────────────────────────────────────────────

/** 打上：升空尾迹 + 从下往上升入，镜头上升最多。 */
const UCHIAGE = family('uchiage', {
    text: { heroSize: 0.1, emphasis: 0.45, tilt: 0, stagger: 0.045, outline: false, hardShadow: true },
    burstAt: 'above',
    sungBurst: null,
    launch: true,
    camera: { rise: 0.72, push: 0.04, roll: 0.01, punch: 0.35 },
}, [
    {
        kind: 'uchiage-kiku', label: '打上·菊', mood: 'neutral',
        layout: 'center', block: 'band', enter: 'rise', sing: 'bounce', exit: 'ascend', palette: 'kawaii',
        burst: burst('kiku', [0, 1, 2]),
        ornaments: [
            orn('streaks', 'screen', 'back', { density: 0.5, color: 'spark', delay: -0.3 }),
            orn('sparkle', 'glyphs', 'front', { density: 0.5, color: 'glow' }),
            orn('ring', 'behind', 'back', { scale: 1.1, color: 'spark', delay: 0.05 }),
        ],
    },
    {
        kind: 'uchiage-botan', label: '打上·牡丹', mood: 'loud',
        layout: 'stagger', block: 'pill', enter: 'rise', sing: 'jump', exit: 'ascend', palette: 'festival',
        burst: burst('botan', [0, 1, 2, 3], { count: 96 }),
        sungBurst: small('botan', [0, 1, 2]),
        ornaments: [
            orn('chevrons', 'line-end', 'back', { density: 0.7, color: 'block' }),
            orn('confetti', 'screen', 'front', { density: 0.55, color: 'spark', delay: 0.1 }),
            orn('dots-line', 'glyphs', 'back', { density: 0.6, color: 'paper' }),
        ],
        camera: { rise: 0.8, punch: 0.5 },
    },
    {
        kind: 'uchiage-palm', label: '打上·椰', mood: 'neutral',
        layout: 'left', block: 'slant', enter: 'elastic', sing: 'swell', exit: 'ascend', palette: 'ocean',
        burst: burst('palm', [0, 1]), burstAt: 'sides',
        text: { tilt: -0.05 },
        ornaments: [
            orn('streaks', 'line-start', 'back', { density: 0.45, color: 'spark' }),
            orn('underline', 'glyphs', 'back', { color: 'block', scale: 1.1 }),
            orn('cross', 'around', 'front', { density: 0.4, scale: 0.8, color: 'paper' }),
        ],
    },
    {
        kind: 'uchiage-crossette', label: '打上·分裂', mood: 'neutral',
        layout: 'arc', block: 'none', enter: 'wave', sing: 'flash', exit: 'ascend', palette: 'night',
        burst: burst('crossette', [0, 2, 3]),
        text: { outline: true, hardShadow: false, heroSize: 0.095 },
        ornaments: [
            orn('dash-circle', 'behind', 'back', { scale: 1.2, color: 'glow', delay: -0.1 }),
            orn('sparkle', 'glyphs', 'front', { density: 0.7, color: 'spark' }),
            orn('streaks', 'screen', 'back', { density: 0.35, color: 'paper', delay: -0.4 }),
        ],
    },
    {
        kind: 'uchiage-double', label: '打上·锦', mood: 'neutral',
        layout: 'center', block: 'double', enter: 'drop', sing: 'bounce', exit: 'scatter', palette: 'gold',
        burst: burst('willow-ring', [0, 1, 2]), burstAt: 'behind',
        ornaments: [
            orn('rays', 'behind', 'back', { density: 0.5, scale: 1.2, color: 'glow', delay: 0.05 }),
            orn('glints', 'glyphs', 'front', { density: 0.6, color: 'paper' }),
            orn('chevrons', 'line-start', 'back', { density: 0.5, color: 'accent' }),
        ],
        camera: { rise: 0.65 },
    },
]);

/** 菊：居中大字、背后开菊，集中线与圆环。 */
const KIKU = family('kiku', {
    text: { heroSize: 0.13, emphasis: 0.35, tilt: 0, stagger: 0.035, outline: true, hardShadow: false },
    burstAt: 'behind',
    sungBurst: null,
    launch: true,
    camera: { rise: 0.55, push: 0.07, roll: 0, punch: 0.5 },
}, [
    {
        kind: 'kiku-center', label: '菊·正面', mood: 'loud',
        layout: 'center', block: 'none', enter: 'zoom', sing: 'glow', exit: 'shrink', palette: 'night',
        burst: burst('kiku', [0, 1, 2, 3], { count: 120, radius: 0.36 }),
        ornaments: [
            orn('spokes', 'behind', 'back', { density: 0.8, scale: 1.3, color: 'paper', delay: 0.05 }),
            orn('ring', 'behind', 'back', { density: 0.7, scale: 1.4, color: 'spark', delay: 0.1 }),
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'glow' }),
        ],
    },
    {
        kind: 'kiku-ring', label: '菊·輪', mood: 'loud',
        layout: 'center', block: 'outline', enter: 'burst', sing: 'flash', exit: 'dissolve', palette: 'neon',
        burst: burst('ring', [0, 1, 2], { count: 72 }),
        ornaments: [
            orn('ring', 'around', 'back', { density: 0.9, scale: 1.2, color: 'accent' }),
            orn('dash-circle', 'behind', 'back', { scale: 1.5, color: 'glow', delay: -0.15 }),
            orn('sparkle', 'glyphs', 'front', { density: 0.6, color: 'spark' }),
        ],
        camera: { punch: 0.65 },
    },
    {
        kind: 'kiku-spokes', label: '菊·集中线', mood: 'neutral',
        layout: 'center', block: 'circle', enter: 'pop', sing: 'bounce', exit: 'scatter', palette: 'festival',
        burst: burst('kiku', [1, 2, 0]),
        text: { heroSize: 0.11, outline: false, hardShadow: true },
        ornaments: [
            orn('spokes', 'around', 'back', { density: 0.9, scale: 1.1, color: 'block' }),
            orn('shards', 'around', 'front', { density: 0.45, color: 'spark', delay: 0.1 }),
            orn('ring', 'behind', 'back', { density: 0.5, color: 'paper', delay: 0.15 }),
        ],
    },
    {
        kind: 'kiku-halo', label: '菊·光冠', mood: 'neutral',
        layout: 'arc', block: 'tile', enter: 'spiral', sing: 'swell', exit: 'ascend', palette: 'gold',
        burst: burst('kamuro', [0, 1], { radius: 0.32 }), burstAt: 'above',
        text: { heroSize: 0.1, outline: false },
        ornaments: [
            orn('dash-circle', 'behind', 'back', { scale: 1.3, color: 'accent' }),
            orn('orbit', 'around', 'front', { density: 0.6, color: 'glow' }),
            orn('glints', 'glyphs', 'front', { density: 0.4, color: 'paper' }),
        ],
        camera: { push: 0.05, roll: 0.012 },
    },
    {
        kind: 'kiku-marker', label: '菊·荧光', mood: 'neutral',
        layout: 'right', block: 'marker', enter: 'wipe', sing: 'underline', exit: 'slide', palette: 'ocean',
        burst: burst('kiku', [0, 2]), burstAt: 'sky',
        text: { heroSize: 0.1, outline: false, stagger: 0.05 },
        ornaments: [
            orn('ring', 'line-start', 'back', { density: 0.5, color: 'spark' }),
            orn('spokes', 'corners', 'back', { density: 0.5, scale: 0.8, color: 'paper' }),
            orn('dots-line', 'glyphs', 'front', { density: 0.6, color: 'accent' }),
        ],
        camera: { push: 0.03, punch: 0.25 },
    },
]);

/** 牡丹：饱满的大色块、弹出与砸下、圆润的色点。 */
const BOTAN = family('botan', {
    text: { heroSize: 0.11, emphasis: 0.6, tilt: 0, stagger: 0.05, outline: false, hardShadow: true },
    burstAt: 'behind',
    sungBurst: null,
    launch: false,
    camera: { rise: 0.5, push: 0.05, roll: 0, punch: 0.6 },
}, [
    {
        kind: 'botan-band', label: '牡丹·色带', mood: 'loud',
        layout: 'center', block: 'band', enter: 'stamp', sing: 'jump', exit: 'shrink', palette: 'festival',
        burst: burst('botan', [0, 1, 2, 3], { count: 110 }),
        text: { heroSize: 0.12 },
        ornaments: [
            orn('halftone', 'behind', 'back', { density: 0.7, scale: 1.3, color: 'block' }),
            orn('confetti', 'screen', 'front', { density: 0.6, color: 'spark', delay: 0.05 }),
            orn('squares', 'around', 'back', { density: 0.5, color: 'accent' }),
        ],
        camera: { punch: 0.8 },
    },
    {
        kind: 'botan-tile', label: '牡丹·方块', mood: 'neutral',
        layout: 'stagger', block: 'tile', enter: 'pop', sing: 'color', exit: 'scatter', palette: 'pastel',
        burst: burst('botan', [1, 2, 3]),
        sungBurst: small('botan', [0, 1, 2, 3], { count: 10 }),
        ornaments: [
            orn('squares', 'corners', 'back', { density: 0.6, color: 'block' }),
            orn('confetti', 'screen', 'front', { density: 0.4, color: 'spark' }),
            orn('cross', 'around', 'front', { density: 0.5, scale: 0.8, color: 'accent' }),
        ],
        camera: { punch: 0.4 },
    },
    {
        kind: 'botan-double', label: '牡丹·心', mood: 'loud',
        layout: 'left', block: 'double', enter: 'stamp', sing: 'bounce', exit: 'blink', palette: 'sakura',
        burst: burst('heart', [0, 2]), burstAt: 'sides',
        text: { tilt: -0.04 },
        ornaments: [
            orn('halftone', 'behind', 'back', { density: 0.6, color: 'accent' }),
            orn('stamp', 'line-end', 'front', { scale: 1.1, color: 'accent', delay: 0.3 }),
            orn('sparkle', 'glyphs', 'front', { density: 0.5, color: 'paper' }),
        ],
    },
    {
        kind: 'botan-split', label: '牡丹·双色', mood: 'loud',
        layout: 'diagonal', block: 'split', enter: 'flip', sing: 'jump', exit: 'slide', palette: 'neon',
        burst: burst('botan', [0, 1]), burstAt: 'above',
        text: { tilt: -0.12 },
        ornaments: [
            orn('shards', 'around', 'front', { density: 0.55, color: 'spark' }),
            orn('chevrons', 'line-end', 'back', { density: 0.7, color: 'block' }),
            orn('zigzag', 'around', 'back', { density: 0.6, color: 'accent' }),
        ],
        camera: { roll: 0.02 },
    },
    {
        kind: 'botan-circle', label: '牡丹·丸', mood: 'neutral',
        layout: 'scatter', block: 'circle', enter: 'pop', sing: 'bounce', exit: 'shrink', palette: 'pastel',
        burst: burst('star', [0, 1, 3]), burstAt: 'sky',
        text: { heroSize: 0.09, emphasis: 0.8 },
        ornaments: [
            orn('cross', 'screen', 'back', { density: 0.5, color: 'paper' }),
            orn('confetti', 'around', 'front', { density: 0.5, color: 'block' }),
            orn('orbit', 'around', 'back', { density: 0.5, color: 'accent' }),
        ],
        camera: { punch: 0.35 },
    },
]);

/** 柳：竖排、慢，柳火与冠下垂，字落下退场。 */
const YANAGI = family('yanagi', {
    text: { heroSize: 0.085, emphasis: 0.2, tilt: 0, stagger: 0.09, outline: false, hardShadow: false },
    burstAt: 'above',
    sungBurst: null,
    launch: true,
    camera: { rise: 0.35, push: 0.025, roll: 0.006, punch: 0 },
}, [
    {
        kind: 'yanagi-shidare', label: '柳·枝垂', mood: 'quiet',
        layout: 'vertical', block: 'none', enter: 'drop', sing: 'glow', exit: 'fall', palette: 'night',
        burst: burst('yanagi', [0, 1]),
        ornaments: [
            orn('petals', 'screen', 'front', { density: 0.3, color: 'glow', delay: 0.4 }),
            orn('dots-line', 'glyphs', 'back', { density: 0.5, scale: 0.8, color: 'spark' }),
            orn('glints', 'glyphs', 'front', { density: 0.35, color: 'paper' }),
        ],
    },
    {
        kind: 'yanagi-kamuro', label: '柳·金冠', mood: 'quiet',
        layout: 'vertical-split', block: 'outline', enter: 'wipe', sing: 'glow', exit: 'fall', palette: 'gold',
        burst: burst('kamuro', [0, 1, 2], { duration: 4 }),
        ornaments: [
            orn('brackets', 'around', 'back', { scale: 1.05, color: 'accent', delay: 0.1 }),
            orn('glints', 'glyphs', 'front', { density: 0.4, color: 'glow' }),
            orn('wave', 'behind', 'back', { density: 0.35, color: 'spark' }),
        ],
    },
    {
        kind: 'yanagi-ame', label: '柳·雨', mood: 'quiet',
        layout: 'vertical', block: 'marker', enter: 'wave', sing: 'underline', exit: 'fall', palette: 'ocean',
        burst: burst('willow-ring', [0, 2], { count: 80 }),
        region: REGIONS.verticalRight,
        ornaments: [
            orn('wave', 'screen', 'back', { density: 0.4, color: 'accent' }),
            orn('streaks', 'screen', 'back', { density: 0.3, scale: 0.8, color: 'paper' }),
            orn('dots-line', 'line-end', 'front', { density: 0.5, color: 'spark' }),
        ],
    },
    {
        kind: 'yanagi-kaze', label: '柳·风', mood: 'quiet',
        layout: 'right', block: 'none', enter: 'drop', sing: 'swell', exit: 'fall', palette: 'sakura',
        burst: burst('yanagi', [0, 1, 3]), burstAt: 'sky',
        text: { heroSize: 0.08, stagger: 0.07 },
        ornaments: [
            orn('petals', 'screen', 'front', { density: 0.5, color: 'block' }),
            orn('sparkle', 'glyphs', 'front', { density: 0.35, color: 'glow' }),
            orn('wave', 'line-start', 'back', { density: 0.4, color: 'accent' }),
        ],
    },
    {
        kind: 'yanagi-palm', label: '柳·椰影', mood: 'quiet',
        layout: 'vertical-split', block: 'pill', enter: 'rise', sing: 'color', exit: 'dissolve', palette: 'kawaii',
        burst: burst('palm', [0, 2], { duration: 2.8 }), burstAt: 'sides',
        ornaments: [
            orn('brackets', 'around', 'back', { color: 'paper', delay: 0.1 }),
            orn('petals', 'screen', 'front', { density: 0.25, color: 'spark' }),
            orn('dash-circle', 'behind', 'back', { scale: 1.3, color: 'glow' }),
        ],
    },
]);

/** 千輪：每个被唱到的字各开一朵小花，散落与错落，快节奏。 */
const SENRIN = family('senrin', {
    text: { heroSize: 0.09, emphasis: 0.7, tilt: 0, stagger: 0.03, outline: false, hardShadow: true },
    burstAt: 'behind',
    sungBurst: small('senrin', [0, 1, 2, 3], { count: 16, radius: 0.06 }),
    launch: false,
    camera: { rise: 0.45, push: 0.04, roll: 0.012, punch: 0.4 },
}, [
    {
        kind: 'senrin-scatter', label: '千輪·散', mood: 'loud',
        layout: 'scatter', block: 'pill', enter: 'pop', sing: 'jump', exit: 'scatter', palette: 'festival',
        burst: burst('senrin', [0, 1, 2, 3]),
        ornaments: [
            orn('confetti', 'screen', 'front', { density: 0.6, color: 'spark' }),
            orn('cross', 'around', 'back', { density: 0.6, color: 'accent' }),
            orn('sparkle', 'glyphs', 'front', { density: 0.5, color: 'paper' }),
        ],
    },
    {
        kind: 'senrin-stagger', label: '千輪·阶', mood: 'neutral',
        layout: 'stagger', block: 'tile', enter: 'burst', sing: 'bounce', exit: 'shrink', palette: 'neon',
        burst: burst('senrin', [1, 2, 3]),
        ornaments: [
            orn('squares', 'around', 'back', { density: 0.5, color: 'block' }),
            orn('shards', 'around', 'front', { density: 0.45, color: 'spark' }),
            orn('sparkle', 'glyphs', 'front', { density: 0.4, color: 'glow' }),
        ],
    },
    {
        kind: 'senrin-strobe', label: '千輪·点滅', mood: 'neutral',
        layout: 'scatter', block: 'circle', enter: 'spin', sing: 'flash', exit: 'blink', palette: 'pastel',
        burst: burst('strobe', [0, 1, 2, 3]), burstAt: 'sky',
        sungBurst: small('strobe', [0, 1, 2, 3], { twinkle: 1 }),
        ornaments: [
            orn('cross', 'screen', 'back', { density: 0.5, color: 'paper' }),
            orn('orbit', 'around', 'front', { density: 0.5, color: 'spark' }),
            orn('dots-line', 'glyphs', 'back', { density: 0.5, color: 'accent' }),
        ],
    },
    {
        kind: 'senrin-hachi', label: '千輪·蜂', mood: 'loud',
        layout: 'diagonal', block: 'stair', enter: 'spin', sing: 'shake', exit: 'scatter', palette: 'festival',
        burst: burst('hachi', [0, 1, 2]),
        sungBurst: small('hachi', [0, 1, 2], { count: 12 }),
        text: { tilt: -0.1 },
        ornaments: [
            orn('zigzag', 'around', 'back', { density: 0.7, color: 'block' }),
            orn('confetti', 'screen', 'front', { density: 0.5, color: 'spark' }),
            orn('chevrons', 'line-end', 'front', { density: 0.5, color: 'paper' }),
        ],
        camera: { roll: 0.02, punch: 0.55 },
    },
    {
        kind: 'senrin-heart', label: '千輪·心', mood: 'neutral',
        layout: 'arc', block: 'pill', enter: 'pop', sing: 'bounce', exit: 'shrink', palette: 'sakura',
        burst: burst('heart', [0, 1]), burstAt: 'above',
        sungBurst: small('heart', [0, 2], { count: 12 }),
        ornaments: [
            orn('petals', 'screen', 'front', { density: 0.45, color: 'block' }),
            orn('confetti', 'around', 'front', { density: 0.35, color: 'spark' }),
            orn('sparkle', 'glyphs', 'front', { density: 0.4, color: 'paper' }),
        ],
    },
]);

/** 星屑：四角星、光点、点线，发光强调、碎成星屑退场。 */
const HOSHIKUZU = family('hoshikuzu', {
    text: { heroSize: 0.085, emphasis: 0.3, tilt: 0, stagger: 0.07, outline: false, hardShadow: false },
    burstAt: 'sky',
    sungBurst: small('star', [0, 1, 2], { count: 10, radius: 0.04, duration: 1 }),
    launch: false,
    camera: { rise: 0.4, push: 0.03, roll: 0.008, punch: 0 },
}, [
    {
        kind: 'hoshikuzu-star', label: '星屑·星', mood: 'quiet',
        layout: 'center', block: 'none', enter: 'spiral', sing: 'glow', exit: 'dissolve', palette: 'night',
        burst: burst('star', [0, 2]), burstAt: 'above',
        ornaments: [
            orn('sparkle', 'glyphs', 'front', { density: 0.7, color: 'glow' }),
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'paper' }),
            orn('orbit', 'around', 'back', { density: 0.4, scale: 1.2, color: 'spark' }),
        ],
    },
    {
        kind: 'hoshikuzu-orbit', label: '星屑·轨道', mood: 'quiet',
        layout: 'arc', block: 'outline', enter: 'zoom', sing: 'glow', exit: 'dissolve', palette: 'ocean',
        burst: burst('strobe', [0, 1, 2], { count: 56 }),
        ornaments: [
            orn('orbit', 'around', 'front', { density: 0.7, color: 'glow' }),
            orn('dash-circle', 'behind', 'back', { scale: 1.4, color: 'accent' }),
            orn('sparkle', 'around', 'front', { density: 0.4, color: 'paper' }),
        ],
    },
    {
        kind: 'hoshikuzu-dust', label: '星屑·尘', mood: 'quiet',
        layout: 'vertical', block: 'circle', enter: 'wave', sing: 'glow', exit: 'dissolve', palette: 'pastel',
        burst: burst('ring', [0, 1], { count: 48, radius: 0.2 }), burstAt: 'behind',
        ornaments: [
            orn('dots-line', 'glyphs', 'back', { density: 0.6, color: 'spark' }),
            orn('sparkle', 'screen', 'front', { density: 0.45, color: 'glow' }),
            orn('petals', 'screen', 'front', { density: 0.2, scale: 0.7, color: 'paper' }),
        ],
    },
    {
        kind: 'hoshikuzu-line', label: '星屑·点线', mood: 'quiet',
        layout: 'left', block: 'pill', enter: 'zoom', sing: 'none', exit: 'dissolve', palette: 'neon',
        burst: burst('crossette', [0, 1]),
        ornaments: [
            orn('dots-line', 'line-end', 'back', { density: 0.7, color: 'accent' }),
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'glow' }),
            orn('cross', 'corners', 'back', { density: 0.4, color: 'paper' }),
        ],
    },
    {
        kind: 'hoshikuzu-veil', label: '星屑·纱', mood: 'quiet',
        layout: 'stagger', block: 'none', enter: 'spiral', sing: 'color', exit: 'ascend', palette: 'sakura',
        burst: burst('kamuro', [0, 1, 3], { count: 90 }),
        ornaments: [
            orn('sparkle', 'glyphs', 'front', { density: 0.6, color: 'glow' }),
            orn('wave', 'behind', 'back', { density: 0.4, color: 'accent' }),
            orn('orbit', 'around', 'back', { density: 0.35, color: 'spark' }),
        ],
    },
]);

/** 帯：色带排字，斜块、票据、荧光笔、阶梯，擦出、打字、滑动。 */
const OBI = family('obi', {
    text: { heroSize: 0.09, emphasis: 0.4, tilt: 0, stagger: 0.04, outline: false, hardShadow: false },
    burstAt: 'sides',
    sungBurst: null,
    launch: false,
    camera: { rise: 0.5, push: 0.02, roll: 0, punch: 0.2 },
}, [
    {
        kind: 'obi-band', label: '帯·横带', mood: 'neutral',
        layout: 'left', block: 'band', enter: 'wipe', sing: 'underline', exit: 'slide', palette: 'festival',
        burst: burst('ring', [0, 1]),
        ornaments: [
            orn('zigzag', 'line-end', 'back', { density: 0.6, color: 'block' }),
            orn('chevrons', 'line-start', 'back', { density: 0.5, color: 'accent' }),
            orn('underline', 'glyphs', 'front', { color: 'paper' }),
        ],
    },
    {
        kind: 'obi-ticket', label: '帯·票据', mood: 'neutral',
        layout: 'center', block: 'ticket', enter: 'flip', sing: 'color', exit: 'slide', palette: 'pastel',
        burst: burst('botan', [0, 2], { count: 64 }), burstAt: 'above',
        ornaments: [
            orn('brackets', 'around', 'back', { color: 'accent' }),
            orn('dots-line', 'line-end', 'back', { density: 0.5, color: 'paper' }),
            orn('stamp', 'line-start', 'front', { scale: 0.9, color: 'accent', delay: 0.35 }),
        ],
    },
    {
        kind: 'obi-slant', label: '帯·斜块', mood: 'loud',
        layout: 'diagonal', block: 'slant', enter: 'wipe', sing: 'underline', exit: 'slide', palette: 'neon',
        burst: burst('palm', [0, 1, 2]),
        text: { tilt: -0.14, hardShadow: true },
        ornaments: [
            orn('chevrons', 'line-end', 'front', { density: 0.7, color: 'spark' }),
            orn('streaks', 'screen', 'back', { density: 0.5, color: 'paper' }),
            orn('zigzag', 'around', 'back', { density: 0.5, color: 'block' }),
        ],
        camera: { punch: 0.45 },
    },
    {
        kind: 'obi-marker', label: '帯·荧光笔', mood: 'neutral',
        layout: 'stagger', block: 'marker', enter: 'type', sing: 'underline', exit: 'blink', palette: 'ocean',
        burst: burst('star', [0, 1]), burstAt: 'sky',
        ornaments: [
            orn('underline', 'glyphs', 'back', { scale: 1.2, color: 'accent' }),
            orn('squares', 'corners', 'back', { density: 0.5, color: 'block' }),
            orn('brackets', 'around', 'front', { scale: 1.1, color: 'paper' }),
        ],
    },
    {
        kind: 'obi-stair', label: '帯·阶梯', mood: 'neutral',
        layout: 'right', block: 'stair', enter: 'stretch', sing: 'jump', exit: 'slide', palette: 'gold',
        burst: burst('crossette', [0, 1, 3]),
        text: { hardShadow: true },
        ornaments: [
            orn('squares', 'around', 'back', { density: 0.55, color: 'accent' }),
            orn('halftone', 'behind', 'back', { density: 0.5, color: 'block' }),
            orn('chevrons', 'line-start', 'front', { density: 0.5, color: 'paper' }),
        ],
    },
]);

/** 閃光：点滅、故障、乱码、频闪、速度线，硬切。 */
const SENKO = family('senko', {
    text: { heroSize: 0.1, emphasis: 0.5, tilt: 0, stagger: 0.025, outline: false, hardShadow: true },
    burstAt: 'behind',
    sungBurst: null,
    launch: false,
    camera: { rise: 0.6, push: 0.06, roll: 0.015, punch: 0.7 },
}, [
    {
        kind: 'senko-glitch', label: '閃光·故障', mood: 'loud',
        layout: 'center', block: 'split', enter: 'glitch', sing: 'shake', exit: 'blink', palette: 'neon',
        burst: burst('strobe', [0, 1, 2, 3]),
        ornaments: [
            orn('streaks', 'screen', 'back', { density: 0.7, color: 'spark' }),
            orn('shards', 'around', 'front', { density: 0.5, color: 'block' }),
            orn('squares', 'around', 'back', { density: 0.5, color: 'paper' }),
        ],
    },
    {
        kind: 'senko-scramble', label: '閃光·乱码', mood: 'neutral',
        layout: 'left', block: 'outline', enter: 'scramble', sing: 'flash', exit: 'blink', palette: 'mono',
        burst: burst('hachi', [0, 1]), burstAt: 'sides',
        text: { outline: true, hardShadow: false },
        ornaments: [
            orn('brackets', 'around', 'back', { color: 'paper' }),
            orn('cross', 'corners', 'front', { density: 0.5, color: 'accent' }),
            orn('streaks', 'line-end', 'back', { density: 0.5, color: 'glow' }),
        ],
        camera: { punch: 0.4 },
    },
    {
        kind: 'senko-strobe', label: '閃光·频闪', mood: 'loud',
        layout: 'scatter', block: 'tile', enter: 'glitch', sing: 'flash', exit: 'scatter', palette: 'kawaii',
        burst: burst('mine', [0, 1, 2]), burstAt: 'sky',
        sungBurst: small('strobe', [0, 1], { count: 10, twinkle: 1 }),
        ornaments: [
            orn('streaks', 'screen', 'back', { density: 0.8, color: 'paper' }),
            orn('zigzag', 'around', 'front', { density: 0.5, color: 'accent' }),
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'glow' }),
        ],
    },
    {
        kind: 'senko-stretch', label: '閃光·拉伸', mood: 'loud',
        layout: 'center', block: 'slant', enter: 'stretch', sing: 'shake', exit: 'shrink', palette: 'neon',
        burst: burst('crossette', [0, 2, 3]),
        text: { tilt: -0.06 },
        ornaments: [
            orn('spokes', 'around', 'back', { density: 0.8, color: 'paper' }),
            orn('streaks', 'screen', 'front', { density: 0.5, color: 'spark' }),
            orn('shards', 'around', 'back', { density: 0.4, color: 'block' }),
        ],
    },
    {
        kind: 'senko-type', label: '閃光·打字', mood: 'neutral',
        layout: 'right', block: 'ticket', enter: 'scramble', sing: 'none', exit: 'blink', palette: 'mono',
        burst: burst('ring', [0, 1], { count: 48 }), burstAt: 'above',
        ornaments: [
            orn('dots-line', 'line-start', 'back', { density: 0.6, color: 'paper' }),
            orn('brackets', 'around', 'front', { scale: 1.08, color: 'accent' }),
            orn('cross', 'screen', 'back', { density: 0.35, color: 'glow' }),
        ],
        camera: { punch: 0.3, roll: 0 },
    },
]);

/** 線香：小而密的火花贴着字噼啪，温柔，暗色调。 */
const SENKOHANABI = family('senkohanabi', {
    text: { heroSize: 0.08, emphasis: 0.2, tilt: 0, stagger: 0.08, outline: false, hardShadow: false },
    burstAt: 'behind',
    sungBurst: small('hachi', [0, 1], { count: 12, radius: 0.035, duration: 0.6, trail: 0.4, twinkle: 0.8 }),
    launch: false,
    camera: { rise: 0.3, push: 0.02, roll: 0.004, punch: 0 },
}, [
    {
        kind: 'senkohanabi-hachi', label: '線香·火花', mood: 'quiet',
        layout: 'vertical', block: 'none', enter: 'type', sing: 'glow', exit: 'fall', palette: 'gold',
        burst: burst('hachi', [0, 1], { count: 36, radius: 0.14 }),
        region: REGIONS.verticalRight,
        ornaments: [
            orn('glints', 'glyphs', 'front', { density: 0.6, color: 'spark' }),
            orn('sparkle', 'glyphs', 'front', { density: 0.35, scale: 0.7, color: 'glow' }),
            orn('dots-line', 'glyphs', 'back', { density: 0.4, scale: 0.7, color: 'accent' }),
        ],
    },
    {
        kind: 'senkohanabi-tama', label: '線香·火玉', mood: 'quiet',
        layout: 'center', block: 'none', enter: 'split', sing: 'glow', exit: 'dissolve', palette: 'night',
        burst: burst('botan', [0, 1], { count: 40, radius: 0.12, duration: 1.2 }), burstAt: 'above',
        text: { heroSize: 0.085 },
        ornaments: [
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'spark' }),
            orn('sparkle', 'around', 'front', { density: 0.3, scale: 0.7, color: 'glow' }),
        ],
    },
    {
        kind: 'senkohanabi-matsuba', label: '線香·松葉', mood: 'quiet',
        layout: 'left', block: 'circle', enter: 'elastic', sing: 'swell', exit: 'dissolve', palette: 'gold',
        burst: burst('crossette', [0, 1], { count: 28, radius: 0.15 }), burstAt: 'sides',
        ornaments: [
            orn('sparkle', 'glyphs', 'front', { density: 0.45, color: 'spark' }),
            orn('cross', 'around', 'back', { density: 0.35, scale: 0.7, color: 'glow' }),
        ],
    },
    {
        kind: 'senkohanabi-chiri', label: '線香·散菊', mood: 'quiet',
        layout: 'arc', block: 'marker', enter: 'flip', sing: 'underline', exit: 'fall', palette: 'sakura',
        burst: burst('yanagi', [0, 1], { count: 40, radius: 0.18 }), burstAt: 'above',
        ornaments: [
            orn('petals', 'screen', 'front', { density: 0.35, color: 'block' }),
            orn('glints', 'glyphs', 'front', { density: 0.4, color: 'paper' }),
        ],
    },
    {
        kind: 'senkohanabi-tsubomi', label: '線香·蕾', mood: 'quiet',
        layout: 'vertical-split', block: 'none', enter: 'split', sing: 'glow', exit: 'fall', palette: 'kawaii',
        burst: burst('strobe', [0, 1], { count: 30, radius: 0.14 }),
        ornaments: [
            orn('dots-line', 'glyphs', 'back', { density: 0.5, color: 'spark' }),
            orn('glints', 'glyphs', 'front', { density: 0.5, color: 'glow' }),
            orn('dash-circle', 'behind', 'back', { scale: 0.9, density: 0.4, color: 'paper' }),
        ],
    },
]);

/** 尺玉：一两个字的超大显示，巨大的冠与双层烟花、旭日放射。 */
const SHAKUDAMA = family('shakudama', {
    text: { heroSize: 0.19, emphasis: 0.25, tilt: 0, stagger: 0.06, outline: true, hardShadow: true },
    burstAt: 'behind',
    sungBurst: null,
    launch: true,
    camera: { rise: 0.85, push: 0.09, roll: 0, punch: 0.9 },
}, [
    {
        kind: 'shakudama-kamuro', label: '尺玉·金冠', mood: 'loud',
        layout: 'center', block: 'none', enter: 'stamp', sing: 'none', exit: 'shrink', palette: 'gold',
        burst: burst('kamuro', [0, 1, 2], { count: 160, radius: 0.48, duration: 4.2 }),
        region: REGIONS.giant,
        ornaments: [
            orn('rays', 'behind', 'back', { density: 0.8, scale: 1.5, color: 'glow' }),
            orn('ring', 'behind', 'back', { density: 0.6, scale: 1.6, color: 'accent', delay: 0.1 }),
            orn('spokes', 'around', 'front', { density: 0.5, scale: 1.3, color: 'paper' }),
        ],
    },
    {
        kind: 'shakudama-nishiki', label: '尺玉·锦', mood: 'loud',
        layout: 'center', block: 'double', enter: 'zoom', sing: 'swell', exit: 'scatter', palette: 'festival',
        burst: burst('willow-ring', [0, 1, 2, 3], { count: 150, radius: 0.46 }),
        region: REGIONS.giant,
        text: { heroSize: 0.17 },
        ornaments: [
            orn('rays', 'behind', 'back', { density: 0.6, scale: 1.4, color: 'block' }),
            orn('stamp', 'line-end', 'front', { scale: 1.2, color: 'accent', delay: 0.4 }),
            orn('ring', 'around', 'back', { density: 0.7, scale: 1.3, color: 'spark' }),
        ],
    },
    {
        kind: 'shakudama-asahi', label: '尺玉·旭日', mood: 'loud',
        layout: 'center', block: 'circle', enter: 'burst', sing: 'flash', exit: 'shrink', palette: 'festival',
        burst: burst('kamuro', [1, 0], { count: 140, radius: 0.44 }),
        region: REGIONS.giant,
        ornaments: [
            orn('rays', 'behind', 'back', { density: 0.9, scale: 1.6, color: 'block' }),
            orn('spokes', 'behind', 'back', { density: 0.6, scale: 1.4, color: 'paper' }),
            orn('confetti', 'screen', 'front', { density: 0.5, color: 'spark', delay: 0.2 }),
        ],
    },
    {
        kind: 'shakudama-heart', label: '尺玉·心', mood: 'loud',
        layout: 'center', block: 'tile', enter: 'stretch', sing: 'jump', exit: 'scatter', palette: 'sakura',
        burst: burst('heart', [0, 1, 3], { count: 110, radius: 0.36 }),
        region: REGIONS.giant,
        text: { heroSize: 0.17 },
        ornaments: [
            orn('stamp', 'line-start', 'front', { scale: 1.3, color: 'accent', delay: 0.3 }),
            orn('rays', 'behind', 'back', { density: 0.5, scale: 1.3, color: 'glow' }),
            orn('confetti', 'screen', 'front', { density: 0.55, color: 'block' }),
        ],
    },
    {
        kind: 'shakudama-mine', label: '尺玉·速射', mood: 'loud',
        layout: 'left', block: 'split', enter: 'stamp', sing: 'shake', exit: 'scatter', palette: 'neon',
        burst: burst('mine', [0, 1, 2, 3], { count: 120 }), burstAt: 'sky',
        region: REGIONS.giantLeft,
        text: { heroSize: 0.16, tilt: -0.05 },
        ornaments: [
            orn('streaks', 'screen', 'back', { density: 0.8, color: 'spark' }),
            orn('shards', 'around', 'front', { density: 0.6, color: 'block' }),
            orn('rays', 'behind', 'back', { density: 0.5, scale: 1.3, color: 'accent' }),
        ],
    },
]);

export const HANABI_PROFILES: HanabiProfile[] = [
    ...UCHIAGE,
    ...KIKU,
    ...BOTAN,
    ...YANAGI,
    ...SENRIN,
    ...HOSHIKUZU,
    ...OBI,
    ...SENKO,
    ...SENKOHANABI,
    ...SHAKUDAMA,
];

const BY_KIND = new Map(HANABI_PROFILES.map(profile => [profile.kind, profile]));

export const HANABI_KINDS = HANABI_PROFILES.map(profile => profile.kind);

/** 未知的 kind 退回「打上·菊」。 */
export const profileOf = (kind: string): HanabiProfile => BY_KIND.get(kind) ?? HANABI_PROFILES[0]!;

export const hasProfile = (kind: string) => BY_KIND.has(kind);

// ─── 组件槽的选项（中文名） ─────────────────────────────────────────────

export const BLOCK_LABELS: Record<BlockStyle, string> = {
    none: '无色块',
    tile: '方块',
    band: '色带',
    slant: '斜块',
    double: '双层',
    pill: '胶囊',
    split: '上下双色',
    ticket: '票据',
    marker: '荧光笔',
    outline: '描边框',
    circle: '圆底',
    stair: '阶梯',
};

export const ENTER_LABELS: Record<EnterFx, string> = {
    pop: '弹出',
    drop: '落下',
    rise: '升起',
    spin: '旋入',
    wipe: '擦出',
    type: '打字',
    scramble: '乱码',
    stretch: '拉伸',
    elastic: '弹簧',
    split: '拼合',
    spiral: '螺旋',
    flip: '翻牌',
    glitch: '故障',
    stamp: '砸下',
    wave: '波浪',
    zoom: '拉近',
    burst: '炸开',
};

export const BURST_LABELS: Record<BurstKind, string> = {
    kiku: '菊',
    botan: '牡丹',
    yanagi: '柳',
    kamuro: '冠',
    senrin: '千輪',
    ring: '輪',
    heart: '心',
    star: '星',
    palm: '椰',
    crossette: '分裂',
    strobe: '点滅',
    hachi: '蜂',
    'willow-ring': '双层',
    mine: 'スターマイン',
};
