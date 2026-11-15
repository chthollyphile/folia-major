import type { LatticeSongTile, LatticeTile } from '../latticeModel';

// src/components/app/lattice/radio/radioWallModel.ts
// 电台墙（私人 FM 下的 Lattice）摆哪几张卡、每张摆在哪：一圈带轻微弧度的卡牌，正在播放的那张在弧顶揭开，
// 左边是刚听过的几张，右边是已经拉到的接下来几首（背面朝上）；越往两边越低、顺着弧倾斜。纯函数，不碰 React 和 store。

export type RadioCardRole = 'played' | 'now' | 'upcoming';

export type RadioCard = {
    tile: LatticeSongTile;
    role: RadioCardRole;
    /** 相对正在播放那张的位置：负数在左（听过的），正数在右（接下来的），0 是正在播放。 */
    offset: number;
};

/** 左边留几张听过的；再往前的翻面销毁。 */
export const RADIO_PLAYED_CARDS = 2;
/** 右边摆几张接下来的；电台拉回来的更多的先不发，轮到时再补。 */
export const RADIO_UPCOMING_CARDS = 3;

/**
 * 从队列墙的磁贴（buildLatticeTiles，按队列顺序、标好了 played / now / upcoming）里挑出这一行卡。
 * 正在播放的不在队列里时（FM 刚开、还没对上）没有中间那张，右边从队首起摆。
 */
export const buildRadioCards = (
    tiles: readonly LatticeTile[],
    {
        played = RADIO_PLAYED_CARDS,
        upcoming = RADIO_UPCOMING_CARDS,
    }: { played?: number; upcoming?: number } = {},
): RadioCard[] => {
    const songs = tiles.filter((tile): tile is LatticeSongTile => tile.kind === 'song');
    const currentIndex = songs.findIndex(tile => tile.section === 'now');
    // 不在队列里时把「正在播放」放在队首之前，右边从第一首起算。
    const anchor = currentIndex >= 0 ? currentIndex : -1;
    const cards: RadioCard[] = [];
    const from = Math.max(0, anchor - played);
    const to = Math.min(songs.length - 1, anchor + upcoming);
    for (let index = from; index <= to; index += 1) {
        const offset = index - anchor;
        cards.push({
            tile: songs[index],
            role: offset < 0 ? 'played' : offset === 0 ? 'now' : 'upcoming',
            offset,
        });
    }
    return cards;
};

/** 卡的外框（容器坐标，未旋转时的位置）和顺着弧的倾斜角（度）。 */
export type RadioRect = { x: number; y: number; width: number; height: number; rotate: number };

export type RadioMetrics = {
    /** 正在播放那张的边长。 */
    nowSize: number;
    /** 紧挨着正在播放那张的卡的边长；再往外每一张按 RADIO_CARD_TAPER 缩小。 */
    cardSize: number;
    gap: number;
    centerX: number;
    centerY: number;
    width: number;
    /** 两边弧的半径：越大越平。 */
    radius: number;
};

/** 窄屏（手机）：正在播放那张占满宽度，两边的卡只从边上露出一点。 */
export const RADIO_COMPACT_WIDTH = 640;

/** 往外每一张卡比里面那张缩小到这个比例：从大卡到小卡一路渐变，接缝处不跳一大截。 */
export const RADIO_CARD_TAPER = 0.86;

/** 由容器大小算出卡的尺寸。只在容器尺寸变时算一次。 */
export const resolveRadioMetrics = (width: number, height: number): RadioMetrics => {
    const compact = width < RADIO_COMPACT_WIDTH;
    const nowSize = Math.max(160, Math.round(compact
        ? Math.min(width - 48, height * 0.62)
        : Math.min(height * 0.7, width * 0.46, 760)));
    const cardSize = Math.max(88, Math.round(nowSize * (compact ? 0.4 : 0.52)));
    const gap = compact ? 12 : Math.round(Math.min(32, Math.max(14, nowSize * 0.035)));
    const radius = Math.max(900, width * (compact ? 1.6 : 1.1));
    return { nowSize, cardSize, gap, centerX: width / 2, centerY: height / 2, width, radius };
};

/** 离正在播放那张第 steps 张卡的边长（steps ≥ 1）。 */
const sideCardSize = (steps: number, metrics: RadioMetrics) => (
    Math.max(56, Math.round(metrics.cardSize * RADIO_CARD_TAPER ** (steps - 1)))
);

/**
 * 一张卡在这一圈里的位置。正在播放那张直立在中间；两边的弧从它的左右边缘起弯（起点处切线水平），
 * 所以紧挨着它的卡只斜一点、几乎不下沉，越往外越斜、越低。卡与卡之间沿弧隔一个间距。
 * offset 可以超出这一行（发牌和销毁时卡在弧上更外面的位置）。
 */
export const radioCardRect = (offset: number, metrics: RadioMetrics): RadioRect => {
    const { nowSize, gap, centerX, centerY, radius } = metrics;
    if (offset === 0) {
        return { x: centerX - nowSize / 2, y: centerY - nowSize / 2, width: nowSize, height: nowSize, rotate: 0 };
    }
    const steps = Math.abs(offset);
    const sign = Math.sign(offset);
    // 沿弧从大卡边缘走到这张卡的中心。
    let along = 0;
    let size = 0;
    for (let step = 1; step <= steps; step += 1) {
        const next = sideCardSize(step, metrics);
        along += size / 2 + gap + next / 2;
        size = next;
    }
    const angle = along / radius;
    const cardCenterX = centerX + sign * (nowSize / 2 + radius * Math.sin(angle));
    const cardCenterY = centerY + radius * (1 - Math.cos(angle));
    return {
        x: cardCenterX - size / 2,
        y: cardCenterY - size / 2,
        width: size,
        height: size,
        rotate: sign * angle * 180 / Math.PI,
    };
};

/**
 * 这张卡在不在窗口里（左右各留半张小卡的余量，倾斜的卡外框会比 rect 稍宽）。整张在窗口外的卡不挂：
 * 窄窗口（手机）上两边远处的卡看不见，挂着只占封面解码和图层。走进窗口时再从弧上发进来。
 */
export const radioCardInView = (rect: RadioRect, metrics: RadioMetrics): boolean => {
    const margin = metrics.cardSize / 2;
    return rect.x + rect.width > -margin && rect.x < metrics.width + margin;
};
