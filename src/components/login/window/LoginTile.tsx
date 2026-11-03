import React from 'react';
import { AppWindow, Ban, CircleHelp, Clock, RefreshCw, ServerOff, Smartphone, User, UserX, WifiOff, type LucideIcon } from 'lucide-react';
import type { LoginCaseKind } from '../../../types/loginFailure';
import type { OnlineProviderId, ProviderUser } from '../../../types/onlineMusic';
import { AccountPicture, PlatformMark } from '../PlatformMark';
import type { LoginScene } from './loginView';

// src/components/login/window/LoginTile.tsx
// 登录发生的地方：200 像素见方的一块，每一种样子一幅画。二维码；过期的二维码淡淡地留在原地，
// 上面一个刷新的圆钮；浏览器登录是一幅浏览器窗口的小画；失败是一个代表类别的图形（A 类没有出错，
// 是灰的，其余是黄的或红的）；还没有选平台是一个空框。画每换一幅，新的那幅弹进来。

const KIND_GLYPH: Record<LoginCaseKind, { icon: LucideIcon; tone: 'calm' | 'warn' | 'err' }> = {
    A: { icon: Clock, tone: 'calm' },
    B: { icon: WifiOff, tone: 'warn' },
    C: { icon: Ban, tone: 'err' },
    D: { icon: ServerOff, tone: 'warn' },
    E: { icon: AppWindow, tone: 'warn' },
    F: { icon: UserX, tone: 'err' },
    G: { icon: CircleHelp, tone: 'err' },
};

const TONE_CLASS = {
    calm: 'bg-[var(--st-fill)] text-[color:var(--st-t2)]',
    warn: 'bg-[color-mix(in_srgb,var(--st-warn)_14%,transparent)] text-[color:var(--st-warn)]',
    err: 'bg-[color-mix(in_srgb,var(--st-err)_13%,transparent)] text-[color:var(--st-err)]',
} as const;

const Disc: React.FC<{ tone: keyof typeof TONE_CLASS; arc?: boolean; children: React.ReactNode }> = ({ tone, arc, children }) => (
    <span className={`relative grid h-[88px] w-[88px] place-items-center rounded-full ${TONE_CLASS[tone]} ${arc ? 'login-arc' : ''}`}>{children}</span>
);

/** 一幅浏览器窗口的小画，里面是平台的记号；等待的时候标题条下面有一道滑动的细条。 */
const BrowserDrawing: React.FC<{ providerId: OnlineProviderId; label: string; waiting: boolean }> = ({ providerId, label, waiting }) => (
    <span className="login-browser relative grid h-[98px] w-[132px] place-items-center rounded-[10px] pt-5 shadow-[inset_0_0_0_1.5px_var(--st-line2)]">
        {waiting && <span className="login-browser-bar absolute left-[1.5px] right-[1.5px] top-[21.5px] h-0.5 overflow-hidden" />}
        <PlatformMark providerId={providerId} label={label} size={30} />
    </span>
);

type LoginTileProps = {
    scene: LoginScene;
    providerId: OnlineProviderId | null;
    label: string;
    inBrowser: boolean;
    codeImage: string;
    /** 账号那一幅画的是谁。 */
    user: ProviderUser | null;
    /** 失败的类别；失败那一幅画它的图形。 */
    failedKind: LoginCaseKind | null;
    /** 失败的是一张过期了的二维码：它留在原地，点它或者圆钮就刷新。 */
    onRefreshCode?: () => void;
    refreshLabel: string;
    /** 选登录方式那一幅里的那句话。 */
    pendingText: string;
    /** 这一块的元素：登录成功的动画要借它（让它收成一个圆）。 */
    tileRef?: React.Ref<HTMLDivElement>;
    /**
     * 登录成功的动画在这一块里的那一层。给了它（扫码之后，到读到账号），这一块就由它画；交给它的是
     * 它底下原来的东西（二维码，或者浏览器的小画），和那是不是一张要白底的二维码。
     */
    doneLayer?: (source: React.ReactNode, onPaper: boolean) => React.ReactNode;
};

export const LoginTile: React.FC<LoginTileProps> = ({
    scene, providerId, label, inBrowser, codeImage, user, failedKind, onRefreshCode, refreshLabel, pendingText, tileRef, doneLayer,
}) => {
    const live = Boolean(doneLayer) && providerId !== null;
    const expiredCode = scene === 'failed' && Boolean(onRefreshCode) && Boolean(codeImage);
    const onWhite = !live && ((scene === 'code' && Boolean(codeImage)) || expiredCode);
    const framed = scene === 'none' || scene === 'methods';
    let picture: React.ReactNode = null;
    if (live && doneLayer && providerId) {
        const source = codeImage
            ? <img src={codeImage} alt="" draggable={false} className="h-[176px] w-[176px]" />
            : inBrowser ? <BrowserDrawing providerId={providerId} label={label} waiting /> : null;
        picture = doneLayer(source, Boolean(codeImage));
    } else if (scene === 'none') {
        picture = <Disc tone="calm"><User size={38} className="opacity-[0.62]" /></Disc>;
    } else if (!providerId) {
        picture = null;
    } else if (scene === 'methods') {
        picture = <span className="px-6 text-center text-xs leading-[18px] text-[color:var(--st-t3)]">{pendingText}</span>;
    } else if (scene === 'account' && user) {
        picture = <AccountPicture user={user} size={88} providerId={providerId} />;
    } else if (scene === 'accountless' || scene === 'account') {
        // 不用登录的平台，和没有账号资料可画的账号那一幅：平台的记号。
        picture = <PlatformMark providerId={providerId} label={label} size={56} />;
    } else if (expiredCode) {
        picture = (
            <button type="button" onClick={onRefreshCode} aria-label={refreshLabel} className="relative grid h-full w-full place-items-center">
                <img src={codeImage} alt="" draggable={false} className="h-[176px] w-[176px] opacity-10" />
                {/* 二维码底下的那一块在两种主题里都是白的（码要在白底上才扫得出来），所以它上面的圆钮在两种主题里都是深色的，不跟主题的变量。 */}
                <span className="st-t-fast absolute grid h-14 w-14 place-items-center rounded-full bg-[#17171a] text-white transition-transform active:scale-95">
                    <RefreshCw size={22} />
                </span>
            </button>
        );
    } else if (scene === 'failed' && failedKind) {
        const { icon: Glyph, tone } = KIND_GLYPH[failedKind];
        picture = <Disc tone={tone}><Glyph size={34} /></Disc>;
    } else if (scene === 'code' && codeImage) {
        picture = <img src={codeImage} alt="" draggable={false} className="login-code h-[176px] w-[176px]" />;
    } else if (scene === 'browser-ready' || scene === 'browser' || (scene === 'preparing' && inBrowser)) {
        picture = <BrowserDrawing providerId={providerId} label={label} waiting={scene !== 'browser-ready'} />;
    } else if (scene === 'scanned') {
        picture = <Disc tone="calm"><Smartphone size={34} className="text-[color:var(--st-t1)]" /></Disc>;
    } else if (scene === 'reading') {
        picture = <Disc tone="calm" arc><User size={34} className="text-[color:var(--st-t1)]" /></Disc>;
    } else {
        // 正在取二维码：平台的记号，外面一道转着的弧。
        picture = <span className="login-arc relative grid h-[54px] w-[54px] place-items-center"><PlatformMark providerId={providerId} label={label} size={30} /></span>;
    }

    return (
        <div
            ref={tileRef}
            className={`st-t-move relative h-[200px] w-[200px] shrink-0 overflow-hidden rounded-xl transition-colors ${onWhite ? 'bg-white' : framed ? 'shadow-[inset_0_0_0_1px_var(--st-line2)]' : 'bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]'}`}
            style={{ '--login-edge': 'var(--st-card)' } as React.CSSProperties}
        >
            <div key={live ? 'done' : `${scene}:${expiredCode}:${codeImage}`} className={`absolute inset-0 grid place-items-center ${scene === 'code' || live ? '' : 'login-pop'}`}>
                {picture}
            </div>
        </div>
    );
};

export default LoginTile;
