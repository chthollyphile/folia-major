// src/library/suites/grid/transitions/morphGeometry.ts
// 「移形换影」的共享词汇表：它搬运的矩形、各阶段交换的载荷，以及卡片级联入场背后的纯几何。
//
// 这个文件不碰 DOM 也不碰 store，所以可以单独单测。封面那一段飞行的关键帧在 morphFlight.ts。

export interface CollectionMorphRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The box a card draws around its picture and title. */
export interface CollectionMorphFrame {
    rect: CollectionMorphRect;
    radius: number;
    /** How it is drawn, as CSS values read off the card. */
    background: string;
    border: string;
    shadow: string;
    /** The colour its outline is lit with while it flies: the theme's text colour, as the card has it. */
    edge: string;
}

/** A card's title line. */
export interface CollectionMorphTitle {
    /** Where it is drawn. */
    rect: CollectionMorphRect;
    text: string;
    /** The size it is laid out at; against `rect`, the scale its card is drawn at. */
    width: number;
    height: number;
    /** Its font size as laid out, in pixels. */
    fontSize: number;
    /** The text styles it is drawn with, as CSS values read off the card, by React's style names. */
    style: Record<string, string>;
}

/**
 * One end of a flight: a card as it stands on the page. Its picture always (`rect`, `radius`,
 * `url` and `proportions` are the picture's); its frame and its title where it has them.
 */
export interface CollectionMorphCard {
    rect: CollectionMorphRect;
    /** Corner radius as drawn, in pixels (half the shorter side for a round picture). */
    radius: number;
    url: string | null;
    /** The picture's width over its height; 0 where it is not known (not decoded yet). */
    proportions: number;
    frame: CollectionMorphFrame | null;
    title: CollectionMorphTitle | null;
    /**
     * The layer the card draws over its whole picture, as the CSS `background` read off the card.
     * Only a card that marks one has it (the poster wall's grown tile: its shade).
     */
    shade?: string | null;
}

/** Navigation state captured when a click gesture began. */
export interface CollectionMorphNavSnapshot {
    /** Whether a collection snapshot existed when the gesture began. */
    wasOpen: boolean;
    /** Navigation stack depth when the gesture began. */
    depth: number;
}

/** The card that was clicked. */
export interface CollectionMorphPending extends CollectionMorphCard {
    /**
     * Stable DOM handle of the clicked card (`grid3d:<index>` for home slider
     * cards, `item:<id>` for detail grid cards, `source:<key>` for a card that
     * names itself, as those of the explore page do, `lattice:<tile id>` for the
     * poster wall's grown tile). On back-out the card is
     * measured again through it, so the flight back lands on the card's CURRENT
     * place even if the surface was laid out anew while hidden.
     */
    sourceKey: string | null;
    /**
     * Navigation state when this click's gesture began. The overlay starts a
     * flight only when the CURRENT navigation shows an open this gesture caused;
     * a card click that merely plays/centers never changes the signature and
     * never morphs.
     */
    navAtGestureStart: CollectionMorphNavSnapshot;
    capturedAt: number;
}

/**
 * 交给 GridView / ArtistGridView 的入场计划：
 *
 * - `morph`：一张卡片正飞向这一页。GridView 在 hero 的槽位上放一张替身卡，画着飞来的那张图
 *   （`coverUrl`）和那行标题（`title`），卡片就落在它上面；曲目到了之后替身交给 hero 卡：
 *   两张图不同就翻面换成它，相同就淡出（standInHandover.ts）。
 * - `cascade`：只有卡片级联，没有卡片飞来（从搜索/播放器进来的打开）。hero 立刻可见。
 */
export interface CollectionMorphPlan {
    kind: 'morph' | 'cascade';
    /** With `morph`: the picture that lands. */
    coverUrl?: string | null;
    /** With `morph`: the title that lands with it; null where the clicked card has none. */
    title?: string | null;
}

/** The flight back, armed right before backing out. */
export interface CollectionMorphExit {
    /** The card at the centre of the page being left, as it stood when back was pressed. */
    from: CollectionMorphCard;
    /**
     * Where it lands. Top-level back: the card the collection was opened from,
     * measured once its surface is shown again. Nested back (album -> the page
     * before): null; the page before remounts with a stand-in at its hero slot,
     * and that is the landing.
     */
    sourceKey: string | null;
    /** True when this back returns to the previous collection instead of home. */
    nested: boolean;
    /** How deep the navigation was when back was pressed; the flight starts once it is shallower. */
    armedDepth: number;
    armedAt: number;
}

/** 确定性抖动的输入：一次飞入里同时给位移、旋转和延迟用。 */
export interface CollectionMorphFlyIn {
    x: number;
    y: number;
    rotate: number;
    delay: number;
}

// zIndex sits above the detail backdrop (z-[49]) so the flying cover rides in
// front of it while the backdrop fades in underneath. It is below the detail
// grids' own z-index (GridView z-[110] / ArtistGridView z-50) on purpose: the
// overlay is portalled to <body> while the whole home surface sits inside the
// home mount point's `z-10` stacking context, so the cover still paints
// above the detail view. Raising this constant past the home mount point would
// put the flight on top of the app chrome instead.
export const COLLECTION_MORPH_Z_INDEX = 50;
export const COLLECTION_MORPH_MIN_RECT_WIDTH = 48;
export const COLLECTION_MORPH_OBSERVATION_WINDOW_MS = 450;
// A plan auto-expires after the entrance window so a stale plan can never
// re-trigger entrances on later grid mounts. Generous enough to cover a
// remounting previous grid whose data restore takes a moment. Note that it only
// bounds how long a plan may START an entrance — the overlay's own lifecycle is
// deliberately independent of it.
export const COLLECTION_MORPH_PLAN_TTL_MS = 2400;

/**
 * 级联入场的推进距离。**刻意比视口对角线短得多。**
 *
 * Apple 的网格入场是「就位」，不是「从屏幕外飞进来」：短距离 + 轻微缩放 + 紧错峰，读起来是
 * 被安排好的；把几十张卡从屏幕外甩进来则是爆炸感，而且要同时喂饱几十条长距离运动。上限 260px
 * 同时压掉两件事：观感（不再是爆炸）和单帧成本（并发的动画量与总时长都下来了）。
 */
export const collectionMorphEntranceTravel = (viewport: { width: number; height: number }): number => (
    Math.min(Math.min(viewport.width, viewport.height) * 0.32, 260)
);

/** 确定性的字符串种子（0..1），跨 render 稳定，所以卡片不会每次重渲染都换一个歪角。 */
export const collectionMorphSeed = (key: string): number => {
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return (hash % 1000) / 1000;
};

/**
 * 一张卡片推进到网格槽位所需的 transform 与错峰。
 *
 * 三条都是 Apple 那套「就位」的语言：
 * - **不倾斜**：网格入场让每一格各自歪一个角度，读起来是「随机」而不是「被安排好的」；
 * - 距离越远启动越晚（ease-out 归一化），但错峰上限收在 0.32s 内，整片网格是一起到达的；
 * - 只留 0.04s 的确定性抖动做呼吸感，不给「机械横扫」留余地。
 */
export const collectionMorphFlyIn = (
    card: { x: number; y: number },
    origin: { x: number; y: number },
    spacing: number,
    reach: number,
    seed: number,
): CollectionMorphFlyIn => {
    const dx = card.x - origin.x;
    const dy = card.y - origin.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance > 1
        ? { x: dx / distance, y: dy / distance }
        : { x: 0, y: -1 };
    const normalized = Math.min(distance / (spacing * 14), 1);
    const eased = normalized * normalized * (3 - 2 * normalized);
    return {
        x: direction.x * reach,
        y: direction.y * reach,
        rotate: 0,
        delay: Math.min(0.04 + eased * 0.34 + seed * 0.04, 0.32),
    };
};
