import type { LatticeSongTile, LatticeTile } from '../latticeModel';

// src/components/app/lattice/radio/radioWallModel.ts
// 电台墙（Lattice 的第二种形态；私人 FM 下总是它）摆哪几张卡、每张摆在哪：一圈带轻微弧度的卡牌，正在播放的
// 那张在弧顶揭开，左边是刚听过的几张，右边是接下来的几首（私人 FM 时是已经拉到的、背面朝上）；越往两边越低、
// 越斜。左右浏览时这一圈整体沿弧挪动（位置可以是小数）。纯函数，不碰 React 和 store。

export type RadioCardRole = 'played' | 'now' | 'upcoming';

export type RadioCard = {
    /**
     * 这张卡的身份（React key、轨道上的位置都按它）。通常就是歌的 id；列表循环时浏览得比一圈还远，同一首歌会在
     * 另一圈再出现一张，那一张带上圈数（`id@圈`）。
     */
    key: string;
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
 * wrap（普通队列开着列表循环）：两边都按播放会走的顺序绕过去——右边放到队尾之后接上队首，左边在队首之前接上队尾
 * （「上一首」会放的就是它），和切歌时卡的移动方向一致。先排右边，左边只取右边没用到的（队列很短时右边优先；
 * prefer 为 played 时反过来，算往左最远能走到哪时用），同一首不出现两次。
 */
export const buildRadioCards = (
    tiles: readonly LatticeTile[],
    {
        played = RADIO_PLAYED_CARDS,
        upcoming = RADIO_UPCOMING_CARDS,
        wrap = false,
        prefer = 'upcoming',
    }: { played?: number; upcoming?: number; wrap?: boolean; prefer?: 'played' | 'upcoming' } = {},
): RadioCard[] => {
    const songs = tiles.filter((tile): tile is LatticeSongTile => tile.kind === 'song');
    const currentIndex = songs.findIndex(tile => tile.section === 'now');
    // 不在队列里时把「正在播放」放在队首之前，右边从第一首起算。
    const anchor = currentIndex >= 0 ? currentIndex : -1;
    const used = new Set<number>(anchor >= 0 ? [anchor] : []);

    const upcomingIndices: number[] = [];
    const takeUpcoming = () => {
        for (let step = 1; step < songs.length + 1 && upcomingIndices.length < upcoming; step += 1) {
            const raw = anchor + step;
            if (raw >= songs.length && !(wrap && anchor >= 0)) break;
            const index = raw % songs.length;
            if (used.has(index)) break;
            upcomingIndices.push(index);
            used.add(index);
        }
    };
    const playedIndices: number[] = [];
    const takePlayed = () => {
        for (let step = 1; step < songs.length + 1 && playedIndices.length < played; step += 1) {
            const raw = anchor - step;
            if (raw < 0 && !(wrap && anchor >= 0)) break;
            const index = (raw + songs.length) % songs.length;
            if (used.has(index)) break;
            playedIndices.unshift(index);
            used.add(index);
        }
    };
    if (prefer === 'played') {
        takePlayed();
        takeUpcoming();
    } else {
        takeUpcoming();
        takePlayed();
    }

    return [
        ...playedIndices.map((index, position) => ({ key: songs[index].id, tile: songs[index], role: 'played' as const, offset: position - playedIndices.length })),
        ...(anchor >= 0 ? [{ key: songs[anchor].id, tile: songs[anchor], role: 'now' as const, offset: 0 }] : []),
        ...upcomingIndices.map((index, position) => ({ key: songs[index].id, tile: songs[index], role: 'upcoming' as const, offset: position + 1 })),
    ];
};

/**
 * 这一行卡在一条连续轨道上的位置：anchor 是正在播放那张所在的格，每张卡在 anchor + offset。
 * 切歌时还在这一行里的卡位置不变，只是 anchor 挪过去，于是整行沿弧滑过去，而不是每张卡各自跳到新位置。
 */
export type RadioRowPlacement = {
    anchor: number;
    positions: ReadonlyMap<string, number>;
};

/**
 * 按上一次的位置摆这一行：先找正在播放那张（往回点过、往前走过时它原来就在这一行里），没有就找任何一张
 * 还在的卡，由它的旧位置推出 anchor；一张都不在（换了队列、换了模式）就在原地重新摆。
 */
export const placeRadioRow = (cards: readonly RadioCard[], previous: RadioRowPlacement | null): RadioRowPlacement => {
    const reference = previous
        ? cards.find(card => card.role === 'now' && previous.positions.has(card.key))
            ?? cards.find(card => previous.positions.has(card.key))
        : undefined;
    const anchor = reference && previous
        ? (previous.positions.get(reference.key) ?? 0) - reference.offset
        : previous?.anchor ?? 0;
    return { anchor, positions: new Map(cards.map(card => [card.key, anchor + card.offset])) };
};

/** 一段文字大约占几个全角字：中日韩字算一个，其余（拉丁字母、数字、空格）算半个多一点。 */
const textUnits = (text: string) => {
    let units = 0;
    for (const char of text) units += /[⺀-鿿가-힯豈-﫿＀-￯]/u.test(char) ? 1 : 0.55;
    return units;
};

/**
 * 背面朝上的卡上那两道打码条的长度（占卡宽的百分比）：按曲名、歌手的字数，长歌名长一点，但不超出卡面，
 * 也不短到看不出是一行字。
 */
export const radioRedactionWidths = (title: string, artist: string) => ({
    title: Math.round(Math.min(72, Math.max(24, 12 + textUnits(title) * 6.5))),
    artist: Math.round(Math.min(46, Math.max(14, 8 + textUnits(artist) * 4))),
});

/** 浏览时视野两边各多摆几张卡（正中那张之外）：再宽的窗口也够看到两边的边。 */
const BROWSE_REACH = 3;

/**
 * 左右浏览能走到哪（相对正在播放那张的格数）：队列里已有的歌都能看（列表循环时往两边都能绕整整一圈），
 * 但只是队列里已有的——私人 FM 不为浏览去向电台要新歌。
 */
export const radioBrowseRange = (tiles: readonly LatticeTile[], { wrap = false }: { wrap?: boolean } = {}) => {
    const right = buildRadioCards(tiles, { wrap, played: 0, upcoming: Number.POSITIVE_INFINITY });
    const left = buildRadioCards(tiles, { wrap, played: Number.POSITIVE_INFINITY, upcoming: 0, prefer: 'played' });
    // 两边的偏移都是按顺序排的：最左一张、最右一张就是两头（不用展开求最值，很长的队列会撑爆参数）。
    return {
        min: Math.min(0, left[0]?.offset ?? 0),
        max: Math.max(0, right.at(-1)?.offset ?? 0),
    };
};

/**
 * 浏览到 from..to 之间（相对正在播放那张的格数，拖动时轨道可能横跨几格）时这一行要摆哪些卡：平时左边两张听过的、
 * 右边三张接下来的；往哪边看，哪边就多摆到视野之外 BROWSE_REACH 张。
 * 浏览时平常那一行的卡一张都不动（同一张卡不换位置、不换角色），只在浏览的那一边往外接。列表循环时按播放顺序
 * 一格一格往外接（第 k 格是队列里 current + k 那首，绕过队头队尾），比一圈还远时同一首歌会再出现一张，带上圈数
 * 作 key。圈数按「平常那一行右端往左数一整圈」那一段算：这一段里每首歌各一张（就是平常那一行，以及往左接的、
 * 平常没摆的那些），段外的是别的圈。另一圈里那张的角色跟着它在这一段里的那张走：右边接下来的歌在左边再出现时
 * 仍算「接下来的」，盖着的不会因为往左浏览而揭开。
 */
export const buildRadioBrowseCards = (
    tiles: readonly LatticeTile[],
    { from, to, wrap = false }: { from: number; to: number; wrap?: boolean },
): RadioCard[] => {
    const played = from < 0 ? Math.max(RADIO_PLAYED_CARDS, BROWSE_REACH - from) : RADIO_PLAYED_CARDS;
    const upcoming = to > 0 ? Math.max(RADIO_UPCOMING_CARDS, BROWSE_REACH + to) : RADIO_UPCOMING_CARDS;
    const row = buildRadioCards(tiles, { wrap });
    const now = row.find(card => card.role === 'now');
    // 不循环时两边各是队列的一头，不会撞上：直接多取。
    if (!wrap || !now) return buildRadioCards(tiles, { wrap, played, upcoming });

    const songs = tiles.filter((tile): tile is LatticeSongTile => tile.kind === 'song');
    const count = songs.length;
    const current = songs.indexOf(now.tile);
    const low = row[0].offset;
    const high = row[row.length - 1].offset;
    const first = from < 0 ? Math.min(low, -played) : low;
    const last = to > 0 ? Math.max(high, upcoming) : high;
    const firstOfLap = high - count + 1;
    const byOffset = new Map(row.map(card => [card.offset, card]));
    const cards: RadioCard[] = [];
    for (let offset = first; offset <= last; offset += 1) {
        const kept = byOffset.get(offset);
        if (kept) {
            cards.push(kept);
            continue;
        }
        const tile = songs[(((current + offset) % count) + count) % count];
        const lap = Math.floor((offset - firstOfLap) / count);
        const home = offset - lap * count;
        cards.push({
            key: lap === 0 ? tile.id : `${tile.id}@${lap}`,
            tile,
            role: offset > 0 || home > 0 ? 'upcoming' : 'played',
            offset,
        });
    }
    return cards;
};

/** 卡的外框（容器坐标，未旋转时的位置）和顺着弧的倾斜角（度）。 */
export type RadioRect = { x: number; y: number; width: number; height: number; rotate: number };

export type RadioMetrics = {
    /** 正中那张（通常是正在播放的）的边长。 */
    nowSize: number;
    /** 紧挨着正中那张的卡的边长；再往外每一张按 RADIO_CARD_TAPER 缩小。 */
    cardSize: number;
    gap: number;
    centerX: number;
    /** 正中那张的中心高度：画面偏下（RADIO_CENTER_HEIGHT），上方留给发射点和刻度。 */
    centerY: number;
    width: number;
    /** 两边弧的半径：越大越平。 */
    radius: number;
    /** 两边的卡比弧再沉下去多少：从紧挨着正中那张起整排一起沉，不和大卡齐平。 */
    sideDrop: number;
};

/** 窄屏（手机）：正在播放那张占满宽度，两边的卡只从边上露出一点。 */
export const RADIO_COMPACT_WIDTH = 640;

/** 往外每一张卡比里面那张缩小到这个比例：从大卡到小卡一路渐变，接缝处不跳一大截。 */
export const RADIO_CARD_TAPER = 0.9;

/** 往外每一张卡多斜的角度（度）。不跟着弧的切线：相邻两张的角度差一大，卡缝就成了尖角。 */
export const RADIO_CARD_TILT_DEG = 1.6;

/** 正中那张的中心在窗口高度的哪里。 */
export const RADIO_CENTER_HEIGHT = 0.55;

/** 由容器大小算出卡的尺寸。只在容器尺寸变时算一次。 */
export const resolveRadioMetrics = (width: number, height: number): RadioMetrics => {
    const compact = width < RADIO_COMPACT_WIDTH;
    const nowSize = Math.max(160, Math.round(compact
        ? Math.min(width - 48, height * 0.62)
        : Math.min(height * 0.56, width * 0.46, 760)));
    const cardSize = Math.max(88, Math.round(nowSize * (compact ? 0.4 : 0.58)));
    const gap = compact ? 12 : Math.round(Math.min(36, Math.max(16, nowSize * 0.06)));
    const radius = Math.max(900, width * (compact ? 1.6 : 1.5));
    const sideDrop = Math.round(nowSize * 0.12);
    return { nowSize, cardSize, gap, centerX: width / 2, centerY: height * RADIO_CENTER_HEIGHT, width, radius, sideDrop };
};

/** 离正中那张第 steps 张卡的边长（steps ≥ 1）。 */
const sideCardSize = (steps: number, metrics: RadioMetrics) => (
    Math.max(56, Math.round(metrics.cardSize * RADIO_CARD_TAPER ** (steps - 1)))
);

/** 整数位置上的卡（offset 为整数）。 */
const slotRect = (offset: number, metrics: RadioMetrics): RadioRect => {
    const { nowSize, gap, centerX, centerY, radius, sideDrop } = metrics;
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
    const cardCenterY = centerY + radius * (1 - Math.cos(angle)) + sideDrop;
    return {
        x: cardCenterX - size / 2,
        y: cardCenterY - size / 2,
        width: size,
        height: size,
        rotate: sign * steps * RADIO_CARD_TILT_DEG,
    };
};

/** 弧上最远算到第几张：再往外的位置按这一张算（离场、浏览越界时不会飞到很远的地方）。 */
const MAX_SLOT = 6;

/**
 * 一张卡在这一圈里的位置。正中那张直立；两边的弧从它的左右边缘起弯，整排比弧再沉 sideDrop，
 * 越往外越低、越小，每张多斜 RADIO_CARD_TILT_DEG。卡与卡之间沿弧隔一个间距。
 * offset 可以是小数（拖动浏览、切歌途中）：取两边整数位置之间按比例插值，卡沿弧连续地变大变小。
 */
export const radioCardRect = (offset: number, metrics: RadioMetrics): RadioRect => {
    const clamped = Math.max(-MAX_SLOT, Math.min(MAX_SLOT, offset));
    const low = Math.floor(clamped);
    const t = clamped - low;
    const from = slotRect(low, metrics);
    if (t === 0) return from;
    const to = slotRect(low + 1, metrics);
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
        x: mix(from.x, to.x),
        y: mix(from.y, to.y),
        width: mix(from.width, to.width),
        height: mix(from.height, to.height),
        rotate: mix(from.rotate, to.rotate),
    };
};

/** 拖过多远算走一格（px）：大约是正中那张和旁边一张的中心距。 */
export const radioStepPx = (metrics: RadioMetrics) => metrics.nowSize / 2 + metrics.gap + metrics.cardSize / 2;

/** 电波同心圆（和卡牌那一圈弧同心）的圆心：在正中下方一个半径处，跟着两边的卡一起沉。 */
export const radioWaveCenter = (metrics: RadioMetrics) => ({
    x: metrics.centerX,
    y: metrics.centerY + metrics.radius + metrics.sideDrop,
});

/** 电台带（radioStationRadius）落在紧挨着正中那张的卡下沿以下多远（px）：那张卡的台线就这么长。 */
export const RADIO_STATION_TICK_PX = 14;

/** 卡的下沿中点和卡自己的「向下」方向（跟着卡的倾斜转）。 */
const cardBottom = (rect: RadioRect) => {
    const theta = rect.rotate * Math.PI / 180;
    const down = { x: -Math.sin(theta), y: Math.cos(theta) };
    return {
        x: rect.x + rect.width / 2 + down.x * rect.height / 2,
        y: rect.y + rect.height / 2 + down.y * rect.height / 2,
        down,
    };
};

/**
 * 电台带：和电波同心的一道弧，从两边卡牌的下面穿过（正中那张大，弧在它背后穿过），每张卡垂一根台线落在上面，
 * 卡就像刻度盘上的一个个台。半径按紧挨着正中那张的卡定：它的下沿往下 RADIO_STATION_TICK_PX。
 */
export const radioStationRadius = (metrics: RadioMetrics) => {
    const center = radioWaveCenter(metrics);
    const bottom = cardBottom(slotRect(1, metrics));
    return Math.hypot(bottom.x - center.x, bottom.y - center.y) - RADIO_STATION_TICK_PX;
};

/**
 * 一张卡的台线有多长（px）：从卡的下沿中点顺着卡自己的「向下」走到电台带上。卡的下沿已经在电台带以下（正中那张）
 * 时为 0，那张卡不画台线。rect 可以是轨道上任意位置（拖动、切歌途中），台线的端点始终落在电台带上。
 */
export const radioStationDrop = (rect: RadioRect, metrics: RadioMetrics) => {
    const center = radioWaveCenter(metrics);
    const radius = radioStationRadius(metrics);
    const { x, y, down } = cardBottom(rect);
    // |bottom + t·down − center| = radius，取最小的正根：从卡下沿往下第一次碰到电台带。
    const px = x - center.x;
    const py = y - center.y;
    const b = down.x * px + down.y * py;
    const c = px * px + py * py - radius * radius;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (disc < 0) return 0;
    return Math.max(0, -b - Math.sqrt(disc));
};

/** 卡牌每走一格，同心圆、刻度、上部轨道跟着转的角度（度）。 */
export const RADIO_WAVE_TURN_DEG = 3;

/** 上部轨道的圆顶在正中那张卡上沿以上的哪里（占卡上沿到窗口顶的比例，从上往下）。 */
const UPPER_RING_TOPS = [0.2, 0.45, 0.7] as const;

/**
 * 画面上半部的几道轨道（和电波同心）：卡牌那一圈的同心圆半径都很大，落在正中那张卡上方的几乎没有，上半屏只剩
 * 两侧的弧边。这几道按卡上方的空白定半径，圆顶落在空白里。
 */
export const radioUpperRings = (metrics: RadioMetrics): number[] => {
    const center = radioWaveCenter(metrics);
    const cardTop = metrics.centerY - metrics.nowSize / 2;
    return UPPER_RING_TOPS.map(top => center.y - cardTop * top);
};

/**
 * 这张卡在不在窗口里（左右各留半张小卡的余量，倾斜的卡外框会比 rect 稍宽）。整张在窗口外的卡不挂：
 * 窄窗口（手机）上两边远处的卡看不见，挂着只占封面解码和图层。走进窗口时再从弧上发进来。
 */
export const radioCardInView = (rect: RadioRect, metrics: RadioMetrics): boolean => {
    const margin = metrics.cardSize / 2;
    return rect.x + rect.width > -margin && rect.x < metrics.width + margin;
};
