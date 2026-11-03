import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Smartphone, User } from 'lucide-react';
import type { OnlineProviderId, ProviderUser } from '../../../types/onlineMusic';
import { settingsTokens, useSettingsKitTheme } from '../../modal/settings/kit/kitTheme';
import { AccountPicture, PlatformMark, platformMarkOf } from '../PlatformMark';
import { loginDoneFrame, type LoginDoneFrame } from './loginDoneFrame';
import { platformShades } from './platformShades';

// src/components/login/done/LoginDone.tsx
// 登录成功的动画画出来的三样：那一块画里的一层（颜色长满它，手机，人，圈和弧），铺满窗口的那一面
// 颜色（头像、两行字、水印、圈和对勾），和飞向切换器的头像。每一帧画什么不在这里定：一个 rAF 循环
// 拿「离扫码、确认、读到账号各过了多久」去问 loginDoneFrame，把回来的数写到这些元素的 style 上
// （不经 React 的 state，一帧不重画一次组件）。动效关着的时候这三样都不挂。

/** 画的人要写 style 的那些元素，按名字记着。 */
export type LoginDoneParts = Record<string, HTMLElement | SVGElement | null>;

const TILE = 200;
const PICTURE = 88;
/** 切换器上头像的大小：飞过去的头像缩到这么大。 */
const PILL_PICTURE = 40;
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

type Geometry = {
    /** 窗口的大小，和那一块画的中心在窗口里的位置。 */
    width: number; height: number; x: number; y: number;
    /** 飞的那一段：头像在屏幕上从哪到哪。切换器不在屏幕上、或者它画的是别的平台，就是 null，头像不飞。 */
    flight: { fromX: number; fromY: number; toX: number; toY: number } | null;
};

/**
 * 头像要飞去的地方：切换器上画头像的那一格，只在它画的就是这个平台的时候（它在 data-login-pill 上写着自己
 * 画的是谁）。登录了却没有切过去（切换被拒了），切换器上还是原来那个平台的账号：没有地方可去。
 */
export const loginDonePill = (providerId: OnlineProviderId): HTMLElement | null => {
    const pill = document.querySelector<HTMLElement>('[data-login-pill]');
    return pill?.dataset.loginPill === providerId ? pill : null;
};

const style = (parts: LoginDoneParts, name: string, values: Record<string, string | number>): void => {
    const element = parts[name];
    if (element) Object.assign(element.style, values);
};

/** 把一帧写到元素上。 */
const paint = (parts: LoginDoneParts, frame: LoginDoneFrame, at: Geometry | null): void => {
    // 那一块画里。
    const grown = TILE / 2 * frame.cover;
    style(parts, 'source', { opacity: frame.source });
    style(parts, 'colour', { clipPath: `inset(${TILE / 2 - grown}px round ${mix(grown, 12, frame.cover)}px)` });
    style(parts, 'tile', { background: frame.cover >= 1 ? 'var(--login-pc)' : '', borderRadius: frame.gather > 0 ? `${mix(12, TILE / 2, frame.gather)}px` : '' });
    style(parts, 'disc', { opacity: frame.disc, transform: `scale(${mix(0.8, 1, frame.disc)})` });
    style(parts, 'phone', { opacity: frame.phone, transform: `scale(${mix(0.86, 1, frame.phone)})` });
    style(parts, 'person', { opacity: frame.person, transform: `scale(${mix(0.86, 1, frame.person)})` });
    frame.rings.forEach((ring, index) => {
        parts[`ring${index}`]?.setAttribute('r', String(mix(44, 94, ring.at)));
        style(parts, `ring${index}`, { opacity: ring.opacity });
    });
    style(parts, 'arc', { opacity: frame.arc.opacity, transform: `rotate(${frame.arc.turn}deg)` });

    // 铺满窗口的那一面。
    const flooding = frame.front !== null && at !== null;
    style(parts, 'flood', { visibility: flooding ? 'visible' : 'hidden' });
    if (!flooding || frame.front === null || !at) return;
    const reach = Math.hypot(Math.max(at.x, at.width - at.x), Math.max(at.y, at.height - at.y)) + 8;
    const radius = mix(TILE / 2, reach, frame.front);
    const centre = `circle at ${at.x}px ${at.y}px`;
    const mask = frame.front < 1 ? `radial-gradient(${centre}, #000 ${radius - 3}px, transparent ${radius}px)` : '';
    style(parts, 'surface', { maskImage: mask, webkitMaskImage: mask });
    style(parts, 'light', {
        opacity: frame.front < 1 ? 1 : 0,
        background: `radial-gradient(${centre}, transparent ${radius - 30}px, rgba(255, 255, 255, ${frame.light}) ${radius - 11}px, transparent ${radius - 1}px)`,
    });
    const { picture } = frame;
    // 飞向切换器的头像：量到了那一段路才飞。切换器不在屏幕上就不飞，窗口里的那一个留着，跟窗口一起淡出。
    const path = at.flight;
    const flying = frame.flight !== null && path !== null;
    style(parts, 'picture', {
        opacity: flying ? 0 : picture.opacity,
        transform: `translateY(${(at.y - at.height / 2) * picture.lift}px) scale(${picture.scale})`,
        boxShadow: `0 0 0 3px #fff, 0 ${mix(30, 14, picture.settle)}px ${mix(56, 30, picture.settle)}px -8px rgba(0, 0, 0, ${mix(0.2, 0.4, picture.settle)})`,
    });
    style(parts, 'ping', { opacity: frame.ping.opacity, transform: `scale(${frame.ping.scale})` });
    style(parts, 'tick', { opacity: frame.tick * frame.words, transform: `scale(${mix(0.5, 1, frame.tick)})` });
    style(parts, 'line1', { opacity: frame.line1 * frame.words, transform: `translateY(${10 * (1 - frame.line1)}px)` });
    style(parts, 'line2', { opacity: frame.line2 * frame.words, transform: `translateY(${12 * (1 - frame.line2)}px)` });
    style(parts, 'watermark', {
        opacity: frame.watermark.opacity * frame.words,
        transform: `translateX(${30 * frame.watermark.drift}px) scale(${mix(1, 1.08, frame.watermark.drift)})`,
    });

    style(parts, 'flight', { visibility: flying ? 'visible' : 'hidden' });
    if (!frame.flight || !path) return;
    style(parts, 'flight', {
        opacity: frame.flight.opacity,
        transform: `translate(${mix(path.fromX, path.toX, frame.flight.across)}px, ${mix(path.fromY, path.toY, frame.flight.down)}px) scale(${mix(1, PILL_PICTURE / PICTURE, frame.flight.across)})`,
    });
    style(parts, 'flightRing', { boxShadow: `0 0 0 3px rgba(255, 255, 255, ${frame.flight.ring}), 0 14px 30px -8px rgba(0, 0, 0, ${0.4 * frame.flight.ring})` });
    style(parts, 'flightMark', { opacity: frame.flight.mark });
};

/** 屏幕上一个元素的框；没有这个元素、或者它没有大小（没画出来）是 null。 */
const boxOf = (element: Element | null | undefined): DOMRect | null => {
    const box = element?.getBoundingClientRect();
    return box && box.width > 0 && box.height > 0 ? box : null;
};

/**
 * 放动画：`playing` 的时候每一帧问一次 loginDoneFrame 并画出来。三个时刻从 `scanned`、`confirmed`、`read`
 * 第一次变成 true 的那一刻记起。动画说窗口该走了调 `onLeave`，放完了调 `onEnd`。`providerId` 是登录的
 * 那个平台：头像只飞向画着它的切换器。回的 `parts` 交给下面三个部件，它们把自己的元素记进去。
 */
export const useLoginDone = ({ playing, providerId, scanned, confirmed, read, onLeave, onEnd }: {
    playing: boolean;
    providerId: OnlineProviderId | null;
    scanned: boolean;
    confirmed: boolean;
    read: boolean;
    onLeave: () => void;
    onEnd: () => void;
}): React.RefObject<LoginDoneParts> => {
    const parts = useRef<LoginDoneParts>({});
    const moments = useRef<{ scan: number | null; confirm: number | null; read: number | null }>({ scan: null, confirm: null, read: null });
    const ends = useRef({ onLeave, onEnd, providerId });
    ends.current = { onLeave, onEnd, providerId };

    useLayoutEffect(() => {
        const now = performance.now();
        const at = moments.current;
        if (!playing) {
            moments.current = { scan: null, confirm: null, read: null };
            return;
        }
        if (scanned && at.scan === null) at.scan = now;
        if ((confirmed || read) && at.confirm === null) at.confirm = now;
        if (read && at.read === null) at.read = now;
    }, [playing, scanned, confirmed, read]);

    useEffect(() => {
        if (!playing) return undefined;
        let request = 0;
        let geometry: Geometry | null = null;
        let left = false;
        const step = (now: number): void => {
            const at = moments.current;
            const since = (moment: number | null) => (moment === null ? null : Math.max(0, now - moment));
            const frame = loginDoneFrame({ scan: since(at.scan), confirm: since(at.confirm), read: since(at.read) }, now);
            const { tile, flood, picture } = parts.current;
            // 颜色离开那一块画的那一刻量一次：窗口多大，那一块画的中心在哪。
            if (frame.front !== null && !geometry) {
                const frameBox = boxOf(flood);
                const tileBox = boxOf(tile);
                if (frameBox && tileBox) {
                    geometry = { width: frameBox.width, height: frameBox.height, x: tileBox.left + tileBox.width / 2 - frameBox.left, y: tileBox.top + tileBox.height / 2 - frameBox.top, flight: null };
                }
            }
            // 窗口要走的那一刻、它还没有放大之前量一次：头像在哪，切换器在哪。然后让窗口走。
            if (frame.leaving && !left) {
                left = true;
                const from = boxOf(picture);
                const to = boxOf(ends.current.providerId ? loginDonePill(ends.current.providerId) : null);
                if (geometry && from && to) {
                    geometry.flight = { fromX: from.left, fromY: from.top, toX: to.left + to.width / 2 - PICTURE / 2, toY: to.top + to.height / 2 - PICTURE / 2 };
                }
                ends.current.onLeave();
            }
            paint(parts.current, frame, geometry);
            if (frame.ended) {
                ends.current.onEnd();
                return;
            }
            request = requestAnimationFrame(step);
        };
        request = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(request);
            // 那一块画是窗口自己的，动画只是借它：还回去时把写在它上面的颜色和圆角拿掉。
            style(parts.current, 'tile', { background: '', borderRadius: '' });
        };
    }, [playing]);

    return parts;
};

const keep = (parts: React.RefObject<LoginDoneParts>, name: string) => (element: HTMLElement | SVGElement | null): void => {
    parts.current[name] = element;
};

type TileLayerProps = {
    parts: React.RefObject<LoginDoneParts>;
    /** 这一面颜色（platformShades 的 surface）。 */
    surface: string;
    /** 颜色长出来之前那一块画里的东西：二维码，或者浏览器的小画。 */
    source: React.ReactNode;
    /** 底下是二维码：它有一张白底，和它一起淡掉。 */
    onPaper: boolean;
};

/** 那一块画里的一层。颜色和窗口上铺的那一面是同一幅画的同一处，所以颜色离开这一块时什么都不跳。 */
export const LoginDoneTile: React.FC<TileLayerProps> = ({ parts, surface, source, onPaper }) => {
    const root = useRef<HTMLDivElement>(null);
    // 这一块画在窗口里的位置，量出来给那一面颜色对齐用。
    useLayoutEffect(() => {
        const layer = root.current;
        const frame = boxOf(parts.current.flood);
        const box = boxOf(layer);
        if (!layer || !frame || !box) return;
        layer.style.setProperty('--login-done-size', `${frame.width}px ${frame.height}px`);
        layer.style.setProperty('--login-done-at', `${frame.left - box.left}px ${frame.top - box.top}px`);
    }, [parts]);

    return (
        <div ref={root} className="absolute inset-0 text-[color:var(--login-on-pc)]">
            <div ref={keep(parts, 'source')} className="absolute inset-0">
                {onPaper && <i className="absolute inset-0 bg-white" />}
                <div className="absolute inset-0 grid place-items-center">{source}</div>
            </div>
            <i
                ref={keep(parts, 'colour')}
                className="absolute inset-0"
                style={{ background: surface, backgroundRepeat: 'no-repeat', backgroundSize: 'var(--login-done-size, 100% 100%)', backgroundPosition: 'var(--login-done-at, 0 0)', clipPath: `inset(${TILE / 2}px)` }}
            />
            <svg className="absolute inset-0" width={TILE} height={TILE} viewBox={`0 0 ${TILE} ${TILE}`} fill="none" stroke="currentColor">
                <circle ref={keep(parts, 'ring0')} cx="100" cy="100" r="44" strokeWidth="1.25" style={{ opacity: 0 }} />
                <circle ref={keep(parts, 'ring1')} cx="100" cy="100" r="44" strokeWidth="1.25" style={{ opacity: 0 }} />
                <circle ref={keep(parts, 'arc')} cx="100" cy="100" r="52" pathLength="1" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.7 0.3" style={{ opacity: 0, transformOrigin: '100px 100px' }} />
            </svg>
            <i ref={keep(parts, 'disc')} className="absolute left-[56px] top-[56px] h-[88px] w-[88px] rounded-full bg-[color-mix(in_srgb,var(--login-on-pc)_13%,transparent)]" style={{ opacity: 0 }} />
            <span ref={keep(parts, 'phone')} className="absolute inset-0 grid place-items-center" style={{ opacity: 0 }}><Smartphone size={36} strokeWidth={1.6} /></span>
            <span ref={keep(parts, 'person')} className="absolute inset-0 grid place-items-center" style={{ opacity: 0 }}><User size={36} strokeWidth={1.6} /></span>
        </div>
    );
};

type DoneProps = {
    parts: React.RefObject<LoginDoneParts>;
    providerId: OnlineProviderId;
    /** 平台的名字：读到的账号没有资料时写它。 */
    label: string;
    /** 读到的账号。 */
    user: ProviderUser | null;
};

// 头像外面的圈和对勾的底在每一种平台的颜色上都是白的（样机定的），只有字跟着「深色还是白色」的规则走。
const WHITE_RING = '0 0 0 3px #fff, 0 14px 30px -8px rgba(0, 0, 0, 0.4)';

const DonePicture: React.FC<Pick<DoneProps, 'providerId' | 'label' | 'user'> & { cornerRef?: React.Ref<HTMLSpanElement> }> = ({ providerId, label, user, cornerRef }) => (
    user
        ? <AccountPicture user={user} size={PICTURE} providerId={cornerRef ? providerId : undefined} cornerRef={cornerRef} />
        : <PlatformMark providerId={providerId} label={label} size={PICTURE} />
);

type FloodProps = DoneProps & {
    surface: string;
    tickColour: string;
    /** 读到了账号：这一面的内容挂上。之前只有一个空框，给画的人量窗口用。 */
    shown: boolean;
    title: string;
    /** 头像那一行离窗口左边多远。 */
    left: number;
};

/** 铺满窗口的那一面颜色：它带着自己的头像、两行字和水印，底下的东西不用跟着变色。 */
export const LoginDoneFlood: React.FC<FloodProps> = ({ parts, providerId, label, user, surface, tickColour, shown, title, left }) => (
    <div ref={keep(parts, 'flood')} className="absolute inset-0 overflow-hidden text-[color:var(--login-on-pc)]" style={{ visibility: 'hidden' }}>
        {shown && (
            <div ref={keep(parts, 'surface')} className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.2)]" style={{ background: surface }}>
                <i ref={keep(parts, 'light')} className="absolute inset-0" style={{ opacity: 0 }} />
                <span
                    ref={keep(parts, 'watermark')}
                    className="login-done-watermark absolute -right-[92px] top-1/2 -mt-[170px] grid h-[340px] w-[340px] place-items-center rounded-full text-[196px] font-extrabold leading-none"
                    style={{ opacity: 0 }}
                >
                    {platformMarkOf(providerId, label).letter}
                </span>
                <div className="absolute top-1/2 flex -translate-y-1/2 items-center gap-[22px]" style={{ left }}>
                    <span ref={keep(parts, 'picture')} className="relative flex shrink-0 rounded-full" style={{ opacity: 0, boxShadow: WHITE_RING }}>
                        <DonePicture providerId={providerId} label={label} user={user} />
                        <i ref={keep(parts, 'ping')} className="absolute -inset-[3px] rounded-full shadow-[0_0_0_1.5px_#fff]" style={{ opacity: 0 }} />
                        <span
                            ref={keep(parts, 'tick')}
                            className="absolute -bottom-[3px] -right-[3px] grid h-[26px] w-[26px] place-items-center rounded-full bg-white shadow-[0_0_0_3px_var(--login-pc)]"
                            style={{ opacity: 0, color: tickColour }}
                        >
                            <Check size={14} strokeWidth={3} />
                        </span>
                    </span>
                    <div className="min-w-0">
                        <em ref={keep(parts, 'line1')} className="block text-[13px] font-medium not-italic leading-5 tracking-[0.02em]" style={{ opacity: 0 }}>{title}</em>
                        <b ref={keep(parts, 'line2')} className="mt-0.5 block max-w-[270px] truncate text-[28px] font-semibold leading-9 tracking-[-0.01em]" style={{ opacity: 0 }}>
                            {user?.nickname || label}
                        </b>
                    </div>
                </div>
            </div>
        )}
    </div>
);

/**
 * 飞向切换器的头像：画在窗口外面，窗口淡出之后它还在路上。白圈一路淡掉，角上平台的记号一路出来。
 * 它在应用的颜色变量够不着的地方，所以自己带着（没有头像的账号画的那个字要用）。
 */
export const LoginDoneFlight: React.FC<DoneProps> = ({ parts, providerId, label, user }) => {
    const { isDaylight, theme } = useSettingsKitTheme();
    return createPortal(
        <div
            ref={keep(parts, 'flight')}
            className="pointer-events-none fixed left-0 top-0 z-[300] flex"
            style={{ ...settingsTokens(isDaylight, theme), visibility: 'hidden', '--login-edge': 'transparent' } as React.CSSProperties}
        >
            <span ref={keep(parts, 'flightRing')} className="relative flex rounded-full" style={{ boxShadow: WHITE_RING }}>
                <DonePicture providerId={providerId} label={label} user={user} cornerRef={keep(parts, 'flightMark')} />
            </span>
        </div>,
        document.body,
    );
};

/** 一个平台的那一面颜色和对勾的颜色。 */
export const loginDoneColours = (providerId: OnlineProviderId, label: string) => {
    const shades = platformShades(platformMarkOf(providerId, label).color);
    return { surface: shades.surface, tick: shades.tick };
};
