import { cineramaHash01 } from './cineramaRandom.mjs';
import { CINERAMA_LAYOUT_KIND_ORDER, CINERAMA_LAYOUT_WEIGHT_GROUPS } from './cineramaOptions.mjs';

// mods/cinerama/cineramaLayout.mjs
// 排版层：决定整行落在巨幕安全区的哪里、多大、多疏。渲染端只把这张表翻译成
// flex / padding / font-size，不在这里碰 DOM。
//
// `lineHeight` 一律压紧（1.05~1.18）：屏体铺满之后，长句折出来的两三行会把整块
// 顶到屏沿；行距一紧，多行就收成一个居中的密块，而不是一条贴边的长带。

// 清单与权重分组同源（`cineramaOptions.CINERAMA_LAYOUT_WEIGHT_GROUPS`）：加一种排版
// 只在那里加一项，这里跟着导出，避免「加了排版但没登记分组 → 它永远抽不到」。
export const CINERAMA_LAYOUT_KINDS = CINERAMA_LAYOUT_KIND_ORDER;

const CINERAMA_LAYOUT_TABLE = {
    'center-stage': {
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padX: 0.07,
        padY: 0.08,
        fontScale: 1,
        tracking: '0.02em',
        lineHeight: 1.08,
        maxWidthRatio: 0.88,
    },
    'upper-third': {
        alignItems: 'flex-start',
        justifyContent: 'center',
        textAlign: 'center',
        padX: 0.08,
        padY: 0.10,
        fontScale: 0.9,
        tracking: '0.03em',
        lineHeight: 1.12,
        maxWidthRatio: 0.84,
    },
    'lower-third': {
        alignItems: 'flex-end',
        justifyContent: 'center',
        textAlign: 'center',
        padX: 0.08,
        padY: 0.10,
        fontScale: 0.9,
        tracking: '0.03em',
        lineHeight: 1.3,
        maxWidthRatio: 0.84,
    },
    'left-band': {
        alignItems: 'center',
        justifyContent: 'flex-start',
        textAlign: 'left',
        padX: 0.09,
        padY: 0.08,
        fontScale: 0.86,
        tracking: '0.015em',
        lineHeight: 1.16,
        maxWidthRatio: 0.72,
    },
    'right-band': {
        alignItems: 'center',
        justifyContent: 'flex-end',
        textAlign: 'right',
        padX: 0.09,
        padY: 0.08,
        fontScale: 0.86,
        tracking: '0.015em',
        lineHeight: 1.16,
        maxWidthRatio: 0.72,
    },
    // 影院宽银幕字幕条：更窄的字号区间、更宽的字距，压在屏体下缘。
    'letterbox-wide': {
        alignItems: 'flex-end',
        justifyContent: 'center',
        textAlign: 'center',
        padX: 0.06,
        padY: 0.16,
        fontScale: 1.12,
        tracking: '0.06em',
        lineHeight: 1.1,
        maxWidthRatio: 0.92,
    },
};

export const resolveCineramaLayout = (kind) => (
    CINERAMA_LAYOUT_TABLE[kind] ?? CINERAMA_LAYOUT_TABLE['center-stage']
);

/*
 * 这一行落成哪种排版。
 *
 * 从前是**等权**在六种落点里抽（`chooseCineramaWithoutRepeat`），于是「偏置落点」
 * （上/下三分之一、左右两栏、宽银幕字幕条）占了 5/6——居中的那一档反而是少数。
 * 现在按**分组权重**抽（见 options 的 CINERAMA_LAYOUT_WEIGHT_FIELDS）：
 *
 *   - 居中的 `center-stage` 是**兜底**，永远留在池子里（与样式轴的小字报同一条规矩）；
 *   - 其余两组的权重由面板给，拖到 0 就是「整首不再出现这一组落点」；
 *   - 「相邻不重复」仍然成立：撞上上一行就在剩下的档里按权重再抽一次。
 *
 * 组内保持等权：同组的那几种落点性质相同（都是偏置/都是宽银幕），再分一层权重只会
 * 让面板多出几个没人调的旋钮。权重是比例不是概率，不必归一。
 */
export const pickCineramaLayoutKind = (seed, previous, weights = null) => {
    const sameGroup = (kind) => kind === previous
        || CINERAMA_LAYOUT_WEIGHT_GROUPS[kind] === CINERAMA_LAYOUT_WEIGHT_GROUPS[previous];
    const weightOf = (kind) => {
        const group = CINERAMA_LAYOUT_WEIGHT_GROUPS[kind];
        // 居中是兜底：它不进权重表，权重恒为 1（其余两组全拖到 0 时整首都是居中）。
        if (group === 'center') return 1;
        const given = Number(weights?.[group]);
        return Number.isFinite(given) ? Math.min(1, Math.max(0, given)) : 0;
    };
    const pool = CINERAMA_LAYOUT_KINDS
        .map((kind) => ({ kind, weight: weightOf(kind) }))
        .filter((entry) => entry.weight > 0);
    if (pool.length === 0) return 'center-stage';

    // 撞上上一行（或上一行的同组）就在剩下的档里再抽一次，比例不变。
    const pick = (entries) => {
        const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
        if (!(total > 0)) return null;
        let roll = cineramaHash01(seed, 0, 401) * total;
        for (const entry of entries) {
            roll -= entry.weight;
            if (roll < 0) return entry.kind;
        }
        return entries[entries.length - 1].kind;
    };
    const picked = pick(pool);
    if (!picked || !previous || picked !== previous) return picked ?? 'center-stage';
    return pick(pool.filter((entry) => entry.kind !== previous)) ?? picked;
};
