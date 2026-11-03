import { KIT_EASE } from '../../modal/settings/kit/motion';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import type { LoginScene } from '../window/loginView';

// src/components/login/done/loginDoneFrame.ts
// 登录成功的动画，写成时间的一个函数：给出离每一件事过了多久（扫了码、手机上确认了、读到了账号），
// 回这一刻画什么。它不碰界面，也不看钟：画的人（LoginDone.tsx）每一帧来问一次，测试直接问某一刻。
// 跳过就是问「结束的那一刻」。数都照样机的那一份（u5-signin 的 paint）。
//
// 先后：扫码之后平台的颜色从那一块画的中间长满它，出现手机；确认之后手机换成人、一道弧绕着转；
// 读到账号之后那一块画收成一个圆，颜色从它铺满整个窗口，头像和两行字落下，记号作水印，一个圈和对勾；
// 站 520 毫秒；然后窗口放大着淡出，头像飞向切换器。从读到账号到回到应用 1.8 秒。

/** 离每一件事过了多少毫秒；还没有发生的是 null。没有「已扫码」这一步的登录（浏览器登录）scan 一直是 null。 */
export type LoginDoneSince = { scan: number | null; confirm: number | null; read: number | null };

/** 读到账号之后的几个时刻（毫秒）：颜色离开那一块画，全都到齐，窗口开始离开，结束。 */
export const LOGIN_DONE = { front: 110, shown: 740, leave: 1260, end: 1800 } as const;

export interface LoginDoneFrame {
    /** 那一块画里：二维码（或者浏览器的小画）和它的白底还剩多少。 */
    source: number;
    /** 颜色在那一块画上长到哪了：0 是中间一个点，1 是长满，圆角也跟着从圆到方。 */
    cover: number;
    /** 图形后面那个柔和的圆。 */
    disc: number;
    phone: number;
    person: number;
    /** 等手机确认时从图形往外走的两个圈：各自走到哪了（0 到 1）和有多显。 */
    rings: Array<{ at: number; opacity: number }>;
    /** 读账号时绕着转的那道弧：有多显，转到几度。 */
    arc: { opacity: number; turn: number };
    /** 那一块画收成圆：0 是原来的圆角，1 是一个圆。 */
    gather: number;
    /** 颜色的前沿从那一块画走到窗口最远的角：还没离开那一块画是 null。 */
    front: number | null;
    /** 紧跟在前沿后面的那一道光有多亮。 */
    light: number;
    /** 头像：有多显，离落定的位置还差多少（1 是还在那一块画的高度），多大，影子落定了多少。 */
    picture: { opacity: number; lift: number; scale: number; settle: number };
    /** 「登录成功！」和名字：各自出现了多少（还差的那一截乘上 10 和 12 像素就是它们还要升的高度）。 */
    line1: number;
    line2: number;
    /** 平台的记号作水印：有多显，离落定的位置还差多少。 */
    watermark: { opacity: number; drift: number };
    /** 从头像往外走的那一个圈。 */
    ping: { opacity: number; scale: number };
    tick: number;
    /** 窗口该离开了：它自己放大着淡出。 */
    leaving: boolean;
    /** 离开时两行字、对勾和水印先走：它们还剩多少。 */
    words: number;
    /**
     * 头像飞向切换器：横着走了多少（两头慢），往下走了多少（先落出窗口，再滑过去），还剩多显，
     * 白圈还剩多少，角上平台的记号出现了多少。窗口还没离开时是 null。
     */
    flight: { across: number; down: number; opacity: number; ring: number; mark: number } | null;
    ended: boolean;
}

type Ease = (x: number) => number;

// 把 CSS 的 cubic-bezier 算成函数：给走过的时间的比例，回走过的路的比例。
const bezier = ([x1, y1, x2, y2]: readonly number[]): Ease => {
    const curve = (t: number, a: number, b: number) => (((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t + 3 * a) * t;
    const slope = (t: number, a: number, b: number) => (3 * (1 - 3 * b + 3 * a) * t + 2 * (3 * b - 6 * a)) * t + 3 * a;
    return x => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let step = 0; step < 8; step += 1) {
            const s = slope(t, x1, x2);
            if (Math.abs(s) < 1e-4) break;
            t = Math.min(1, Math.max(0, t - (curve(t, x1, x2) - x) / s));
        }
        return curve(t, y1, y2);
    };
};

const OUT = bezier(KIT_EASE.out);
const STANDARD = bezier(KIT_EASE.standard);
const IN_OUT = bezier(KIT_EASE.inOut);
const LINEAR: Ease = x => x;

/** 一段从 `from` 走到 `to`（毫秒）的变化在 t 这一刻走了多少：之前是 0，之后是 1。 */
const part = (t: number, from: number, to: number, ease: Ease = OUT): number => ease(Math.min(1, Math.max(0, (t - from) / (to - from))));
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 两个圈一轮走多久。 */
const RING_PERIOD_MS = 1800;

/**
 * 这一刻画什么。`clock` 是一只一直走的钟（毫秒），只管转着的东西：圈走到哪、弧转到几度。
 * 没有「已扫码」这一步的登录，颜色在确认的那一刻长出来，手机和圈不出现。
 */
export const loginDoneFrame = (since: LoginDoneSince, clock: number): LoginDoneFrame => {
    // 还没有发生的事当它在很久以后：所有跟着它的变化都还是 0。没有「已扫码」的登录，扫码和确认是同一刻：
    // 手机和圈要到扫码之后 200 毫秒才出来，而确认之后 200 毫秒它们已经走完了，所以一直是 0。
    const s = since.scan ?? since.confirm ?? -Infinity;
    const c = since.confirm ?? -Infinity;
    const g = since.read ?? -Infinity;
    const l = g - LOGIN_DONE.leave;

    // 读到账号之后，那一块画里的东西 140 毫秒走掉。
    const gone = 1 - part(g, 0, 140, STANDARD);
    const ringStrength = part(s, 450, 650) * (1 - part(c, 0, 150, STANDARD));
    const landed = part(g, 200, 640);
    const pinged = part(g, 520, 960);
    const words = 1 - part(l, 0, 140, STANDARD);
    const flown = Math.min(1, Math.max(0, (l - 40) / 480));

    return {
        source: 1 - part(s, 0, 110, STANDARD),
        // 颜色自己长满要 420 毫秒；账号读到得早，就在它离开那一块画之前的这一段里长满。
        cover: Math.max(part(s, 0, 420), part(g, 0, LOGIN_DONE.front)),
        disc: part(s, 180, 460) * gone,
        phone: part(s, 200, 460) * (1 - part(c, 0, 200, STANDARD)),
        person: part(c, 120, 400) * gone,
        rings: [0, 0.5].map(offset => {
            const at = (((clock / RING_PERIOD_MS + offset) % 1) + 1) % 1;
            return { at: OUT(at), opacity: ringStrength * (1 - at) * 0.5 };
        }),
        arc: { opacity: part(c, 100, 350) * gone, turn: (clock * 0.3) % 360 },
        gather: part(g, 0, LOGIN_DONE.front, IN_OUT),
        front: g >= LOGIN_DONE.front ? part(g, LOGIN_DONE.front, 570, IN_OUT) : null,
        light: 0.16 * part(g, 110, 220, STANDARD) * (1 - part(g, 430, 570, STANDARD)),
        picture: { opacity: part(g, 200, 340, STANDARD), lift: 1 - part(g, 200, 640, IN_OUT), scale: mix(1.2, 1, landed), settle: landed },
        line1: part(g, 250, 530),
        line2: part(g, 290, 610),
        watermark: { opacity: part(g, 220, 620, STANDARD), drift: 1 - part(g, 140, 940) },
        ping: { opacity: pinged > 0 && pinged < 1 ? (1 - pinged) * 0.5 : 0, scale: mix(1, 1.7, pinged) },
        tick: part(g, 560, LOGIN_DONE.shown),
        leaving: l >= 0,
        words,
        flight: l >= 0 ? {
            across: IN_OUT(flown),
            down: STANDARD(flown),
            opacity: 1 - part(l, 510, 540, LINEAR),
            ring: 1 - IN_OUT(flown),
            mark: part(l, 180, 380, STANDARD),
        } : null,
        ended: g >= LOGIN_DONE.end,
    };
};

/** 动效关着的时候没有这段动画：读到账号就是结束，窗口照常关掉。开着的时候窗口留到动画让它走。 */
export const loginDonePlays = (reducedMotion: boolean): boolean => !reducedMotion;

/**
 * 这一刻动画放不放，也就是画它的那个循环转不转。动效关着（`still`）不放。读到账号之后（`done`）一直放到
 * 它自己说结束：窗口在那之前就走了，头像还在路上。读到账号之前，只在窗口开着、扫了码或者正在读账号的
 * 时候放：窗口一关那一次登录就停了，可登录的状态要留到下一次打开才清（画面留到窗口淡出），只看状态
 * 会一直放下去。
 */
export const loginDonePlaying = ({ open, still, scene, done }: { open: boolean; still: boolean; scene: LoginScene; done: boolean }): boolean => (
    !still && (done || (open && (scene === 'scanned' || scene === 'reading')))
);

/**
 * 谁的头像正要从窗口飞向切换器（没有就是 null）：选中的那个平台的，从确认之后读账号起（账号读到的那一刻
 * 切换器就认得它了，要赶在那之前说），到动画放完。动效关着没有；窗口在读账号的时候关了也没有。
 */
export const loginDoneLanding = ({ open, still, confirmed, done, providerId }: {
    open: boolean; still: boolean; confirmed: boolean; done: boolean; providerId: OnlineProviderId | null;
}): OnlineProviderId | null => (!still && (done || (open && confirmed)) ? providerId : null);
