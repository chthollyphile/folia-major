import React from 'react';
import { omni } from '../../services/onlineMusic/omni';
import type { OnlineProviderId, ProviderUser } from '../../types/onlineMusic';
import { onAccentColor } from '../modal/settings/kit/kitTheme';
import { platformMarkIcon } from './platformMarkIcons';
import { resolvePlatformMark } from './resolvePlatformMark';

// src/components/login/PlatformMark.tsx
// 平台的记号和账号的头像，登录窗口、主页的登录按钮、切换器和控制面板的账号页都画这两样。
// 记号上的黄点是「这个平台的登录失效了」。角上的小记号和黄点外面那一圈，颜色取所在表面的
// `--login-edge`（没有设就是卡片的颜色）。

const EDGE = '0 0 0 2px var(--login-edge, var(--st-card))';

/** 一个平台的记号的颜色、画在上面的字或图标，连同这个圆上该用深色还是白色。 */
export const platformMarkOf = (providerId: OnlineProviderId, label?: string) => {
    const mark = resolvePlatformMark(omni.getProviderMark(providerId), label ?? omni.getProviderLabel(providerId));
    return { ...mark, onColor: onAccentColor(mark.color), iconSrc: platformMarkIcon(mark.icon) };
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
    return (
        <span
            aria-hidden
            className={`relative inline-grid shrink-0 place-items-center rounded-full font-bold leading-none ${className ?? ''}`}
            style={{ width: size, height: size, background: mark.color, color: mark.onColor, fontSize: Math.round(size * 0.42) }}
        >
            {mark.iconSrc ? (
                <img src={mark.iconSrc} alt="" draggable={false} className="pointer-events-none select-none object-contain" style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }} />
            ) : (
                mark.letter
            )}
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
