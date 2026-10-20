import React from 'react';
import { getProviderAppIcon, PROVIDER_APP_ICONS } from '../../../assets/providers/appIcons';
import { platformMarkOf } from '../../../components/login/PlatformMark';
import type { OnlineProviderId } from '../../../types/onlineMusic';

// src/library/suites/bravais/BravaisProviderAvatar.tsx
// 已登录的账户显示头像，没有头像时退回平台**本尊的 App 图标**（有图的平台见 appIcons 那张表），
// 再没有才退回平台的记号（字和颜色）。记号是平台自己声明的，和登录窗口、grid 的切换器同一个来源
// （components/login/PlatformMark 的 platformMarkOf）；mod 加的平台没有声明就取名称首字、中性的颜色。
// 图与映射都在 src/assets/providers/appIcons.ts（共享的静态资源模块，不是 suite 之间的互相 import），
// 两边改图标时一起改，别在组件里再抄一份 providerId → 文件的对照表。

/** 网页版把 http 的头像换成 https（与 grid 的切换器一致，避免混合内容被拦）；桌面版原样。 */
const resolveAvatarSrc = (url: string) => (typeof window !== 'undefined' && window.electron ? url : url.replace(/^http:/, 'https:'));

/**
 * 头像、平台图标或平台徽章（圆形，尺寸由 className 定）。装饰性的：可访问名由外面的按钮给，这里 aria-hidden。
 * `data-bravais-account-avatar` 标出画的是哪一种（image 是用户头像 / icon 是平台 App 图标 / badge 是文字徽章 /
 * connect 是「连接在线平台」的插头），用例按它判断。
 */
const BravaisProviderAvatar: React.FC<{ providerId: string; name: string; avatarUrl: string | null; className?: string }> = ({
    providerId,
    name,
    avatarUrl,
    className,
}) => {
    if (avatarUrl) {
        return <img className={`bravais-account-avatar${className ? ` ${className}` : ''}`} src={resolveAvatarSrc(avatarUrl)} alt="" aria-hidden
            draggable={false} data-bravais-account-avatar="image" />;
    }
    // 有 App 本尊图的平台直接亮那颗图标（圆形裁切）：认的是「这是哪个平台的歌」，不是 logo 上的字。
    if (providerId in PROVIDER_APP_ICONS) {
        return <img className={`bravais-account-avatar is-icon${className ? ` ${className}` : ''}`} src={getProviderAppIcon(providerId)} alt="" aria-hidden
            draggable={false} data-bravais-account-avatar="icon" />;
    }
    const mark = platformMarkOf(providerId as OnlineProviderId, name);
    return (
        <span className={`bravais-account-avatar is-badge${className ? ` ${className}` : ''}`} style={{ backgroundColor: mark.color, color: mark.onColor }} aria-hidden
            data-bravais-account-avatar="badge">
            {mark.letter}
        </span>
    );
};

export default BravaisProviderAvatar;
