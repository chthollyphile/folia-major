import React from 'react';
import { platformMarkOf } from '../../../components/login/PlatformMark';

// src/library/suites/bravais/BravaisProviderAvatar.tsx
// 已登录的账户显示头像，没有头像时退回平台的记号。记号（字和颜色）是平台自己声明的，和登录窗口、grid 的切换器
// 同一个来源（components/login/PlatformMark 的 platformMarkOf）；mod 加的平台没有声明就取名称首字、中性的颜色。

/** 网页版把 http 的头像换成 https（与 grid 的切换器一致，避免混合内容被拦）；桌面版原样。 */
const resolveAvatarSrc = (url: string) => (typeof window !== 'undefined' && window.electron ? url : url.replace(/^http:/, 'https:'));

/**
 * 头像或平台徽章（圆形，尺寸由 className 定）。装饰性的：可访问名由外面的按钮给，这里 aria-hidden。
 * `data-bravais-account-avatar` 标出画的是哪一种（image / badge），用例按它判断。
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
    const mark = platformMarkOf(providerId, name);
    return (
        <span className={`bravais-account-avatar is-badge${className ? ` ${className}` : ''}`} style={{ backgroundColor: mark.color, color: mark.onColor }} aria-hidden
            data-bravais-account-avatar="badge">
            {mark.letter}
        </span>
    );
};

export default BravaisProviderAvatar;
