import React from 'react';
import './loadingRing.css';

// src/components/shared/LoadingRing.tsx
// 项目统一的转圈加载动画：一圈带缺口的细环，靠旋转形成转圈。颜色走 currentColor，跟随所在主题/文字色。
export const LoadingRing: React.FC<{ size?: number; className?: string }> = ({ size = 48, className }) => (
    <svg className={className ? `loading-ring ${className}` : 'loading-ring'} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" />
    </svg>
);
