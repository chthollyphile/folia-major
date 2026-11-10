import React from 'react';
import type { LucideIcon } from 'lucide-react';

// src/components/ui/Button.tsx
// 全仓唯一的按钮实现：语义（type/禁用/图标/无障碍名/ref）都在这里，外观由 className 决定。
// 除了 src/components/ui/ 与设置页的 kit，任何地方都不许再手写 <button>（CI 的 ui-gates 会拦）。
//
// bare 是迁移期的默认档：**一个类都不加**。裸 <button> 的默认 display 是 inline-block，调用方
// 写 hidden / flex / inline-flex 都按原样生效；控件库任何一条 display、高度、字号、transition
// 都可能压过调用方的 className（Tailwind 的层叠按生成顺序，不按书写顺序），那就是外观回退。
// fill / primary / quiet 是给新代码的风格档，才带各自的布局与尺寸。

export type ButtonVariant = 'bare' | 'fill' | 'primary' | 'quiet';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<Exclude<ButtonVariant, 'bare'>, string> = {
    fill: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-white/10 px-3 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40',
    primary: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--ui-accent,#3b82f6)] px-3 text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
    quiet: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-current/70 transition-colors hover:bg-white/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-40',
};

const SIZE: Record<ButtonSize, string> = {
    sm: 'h-6 text-xs',
    md: 'h-8 text-[13px]',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: LucideIcon;
    /** 只有图标时给无障碍名字：优先用 tip，其次 aria-label。 */
    tip?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'bare', size = 'md', icon: Icon, tip, className, children, type = 'button', ...rest },
    ref,
) {
    const iconOnly = !children;
    // bare 不拼任何样式：调用方自己的 display/高度/字号/过渡必须原样生效。
    const look = variant === 'bare' ? '' : `${VARIANT[variant]} ${SIZE[size]}`;
    return (
        <button
            ref={ref}
            type={type}
            {...rest}
            aria-label={iconOnly ? (rest['aria-label'] ?? tip) : rest['aria-label']}
            title={tip ?? rest.title}
            className={`${look} ${className ?? ''}`.trim()}
        >
            {Icon && <Icon size={size === 'sm' ? 12 : 14} />}
            {children}
        </button>
    );
});

export default Button;
