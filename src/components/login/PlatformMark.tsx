import React from 'react';
import { omni } from '../../services/onlineMusic/omni';
import type { OnlineProviderId, ProviderUser } from '../../types/onlineMusic';
import { getProviderAppIcon, PROVIDER_APP_ICONS } from '../../assets/providers/appIcons';
import { onAccentColor } from '../modal/settings/kit/kitTheme';
import { resolvePlatformMark } from './resolvePlatformMark';

// src/components/login/PlatformMark.tsx
// 平台的记号和账号的头像，登录窗口、主页的登录按钮、切换器和控制面板的账号页都画这两样。
// 记号上的黄点是「这个平台的登录失效了」。角上的小记号和黄点外面那一圈，颜色取所在表面的
// `--login-edge`（没有设就是卡片的颜色）。

const EDGE = '0 0 0 2px var(--login-edge, var(--st-card))';

/** 一个平台的记号的字和颜色，连同画在这种颜色上的字的颜色。 */
export const platformMarkOf = (providerId: OnlineProviderId, label?: string) => {
    const mark = resolvePlatformMark(omni.getProviderMark(providerId), label ?? omni.getProviderLabel(providerId));
    return { ...mark, onColor: onAccentColor(mark.color) };
};

type PlatformMarkProps = {
    providerId: OnlineProviderId;
    /** 平台的短名；没有声明记号的平台从它取字。 */
    label?: string;
    size: number;
    ranOut?: boolean;
    className?: string;
};

export const PlatformMark: React.FC<PlatformMarkProps> = ({ providerId, label, size, ranOut, className }) => {
    const mark = platformMarkOf(providerId, label);
    /*
     * 有「应用本尊」图标的平台亮那颗图标，不画字。
     *
     * 登录窗口只认 provider 声明的 `mark`（一个字 + 一种颜色），从来不看 assets/providers 里那张
     * 来源图标表 —— 于是各家在登录界面一律变成一个彩色的字，而资料库的来源角标是同一张表里取的图，
     * 两边对不上。这里按各处同一条规矩补上：有图就用图，没图才回落字 + 颜色。
     *
     * 注释里不点名平台：这一层要与平台无关（loginModuleKnowsNoPlatform 那条守卫会扫本目录），
     * 平台自己的东西由它自己的 adapter 通过 omni 声明。
     */
    const hasAppIcon = providerId in PROVIDER_APP_ICONS;
    return (
        <span
            aria-hidden
            className={`relative inline-grid shrink-0 place-items-center rounded-full font-bold leading-none ${className ?? ''}`}
            style={{
                width: size,
                height: size,
                // 有图就不套彩色圆底（图自己就是那块方的 / 圆的底），没图才需要底色配字。
                background: hasAppIcon ? undefined : mark.color,
                color: hasAppIcon ? undefined : mark.onColor,
                fontSize: Math.round(size * 0.42),
            }}
        >
            {hasAppIcon ? (
                // 图是方的（有的还自带底色），铺满再让圆角把它裁成圆。
                <img
                    src={getProviderAppIcon(providerId)}
                    alt=""
                    draggable={false}
                    className="h-full w-full rounded-full object-cover"
                />
            ) : mark.letter}
            {ranOut && (
                <i className="absolute -right-px -top-px h-2.5 w-2.5 rounded-full bg-[var(--st-warn)]" style={{ boxShadow: EDGE }} />
            )}
        </span>
    );
};

/**
 * 账号头像的地址。网页端把 http 的地址换成 https（https 的页面不让载 http 的图）；桌面端原样用，
 * 有的平台的头像只在 http 上。
 */
export const accountPictureSrc = (avatarUrl: string, inDesktopApp: boolean): string => (
    inDesktopApp ? avatarUrl : avatarUrl.replace(/^http:/, 'https:')
);

type AccountPictureProps = {
    user: ProviderUser;
    size: number;
    /** 给了就在角上画这个平台的记号。 */
    providerId?: OnlineProviderId;
    ranOut?: boolean;
    /** 角上那个记号的元素：登录成功的动画让它一路显出来。 */
    cornerRef?: React.Ref<HTMLSpanElement>;
};

export const AccountPicture: React.FC<AccountPictureProps> = ({ user, size, providerId, ranOut, cornerRef }) => {
    const corner = Math.max(14, Math.round(size * 0.44));
    return (
        <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
            {user.avatarUrl ? (
                <img
                    src={accountPictureSrc(user.avatarUrl, typeof window !== 'undefined' && Boolean(window.electron))}
                    alt=""
                    draggable={false}
                    className="h-full w-full rounded-full bg-[var(--st-fill)] object-cover"
                />
            ) : (
                <span
                    aria-hidden
                    className="grid h-full w-full place-items-center rounded-full bg-[var(--st-fill2)] font-semibold leading-none text-[color:var(--st-t1)]"
                    style={{ fontSize: Math.round(size * 0.42) }}
                >
                    {[...user.nickname.trim()][0] ?? ''}
                </span>
            )}
            {providerId && (
                <span ref={cornerRef} className="absolute -bottom-[3px] -right-[3px] inline-flex rounded-full" style={{ boxShadow: EDGE }}>
                    <PlatformMark providerId={providerId} size={corner} ranOut={ranOut} />
                </span>
            )}
        </span>
    );
};
