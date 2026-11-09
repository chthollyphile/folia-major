import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryAccountSurfaceProps } from '../../core/account/account.contract';
import { useLibraryAccountPendingSwitch, type LibraryProviderSwitchView } from '../../core/account/useLibraryAccount';
import { useLibraryTuiAccountKeys } from './useLibraryTuiAccountKeys';

// src/library/suites/tui/LibraryTuiAccount.tsx
// TUI 的 account surface（Library v2 · A6，开发版）：平台切换确认，叠在 TUI 首页（以及集合层）之上。登录不在这里：
// 选未登录的平台打开共用的登录窗口（src/components/login）。数据来自账户 controller 的绑定（useLibraryAccountPendingSwitch），
// 动作调 controller；不碰 omni 与账户 store。待确认切换在 controller 里，换 suite 会重挂这个组件，接着显示同一个请求。
// - 层：自己渲染一个 fixed 全屏层（z-200，与网格的确认框同层），
//   挂 data-folia-keyboard-window（可交互时）让 TUI 首页 / 集合层的按键与全局热键让路，按键由捕获监听独占
//   （useLibraryTuiAccountKeys）；data-ponder-page-scope="none" 与其它 TUI surface 一致。
// - 切换确认（account-switch-confirm）：Enter 确认、Esc 取消；不等 confirmSwitch 走完，controller 同步清掉待确认
//   请求，层随之收起。

/**
 * 方框（及嵌在上边框里的标题）的底色：跟随应用的 --bg-color，没定义时（例如探针页）回落到主题背景色，
 * 否则底色透明，上边框会从标题文字中间穿过。
 */
const resolveTuiBoxBackground = (themeBackground: string | undefined) => (
    themeBackground ? `var(--bg-color, ${themeBackground})` : 'var(--bg-color, Canvas)'
);

const LibraryTuiAccountConfirm: React.FC<{
    view: LibraryProviderSwitchView;
    accentColor: string;
    boxBackground: string;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({
    view,
    accentColor,
    boxBackground,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    return (
        <section
            role="alertdialog"
            aria-modal="true"
            aria-label={view.title}
            data-tui-account-confirm={view.request.to}
            data-tui-confirm-reason={view.request.reason}
            className="relative w-full max-w-md border px-4 pb-3 pt-4 text-[13px]"
            style={{ borderColor: accentColor, backgroundColor: boxBackground, color: 'var(--text-primary)' }}
        >
            <h3 className="absolute -top-2.5 left-3 px-1 font-bold" style={{ color: accentColor, backgroundColor: boxBackground }}>
                {view.title}
            </h3>
            <p data-tui-confirm-message>{view.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3">
                <button type="button" data-tui-confirm-answer="confirm" onClick={onConfirm} className="hover:underline" style={{ color: accentColor }}>
                    {`[${t('libraryTui.confirm')}]`}
                </button>
                <button type="button" data-tui-confirm-answer="cancel" onClick={onCancel} className="opacity-70 hover:opacity-100">
                    {`[${t('libraryTui.cancel')}]`}
                </button>
                <span className="text-[11px] opacity-50">{t('libraryTui.promptHint')}</span>
            </div>
        </section>
    );
};

const LibraryTuiAccount: React.FC<LibraryAccountSurfaceProps> = ({ account, theme, isInteractive }) => {
    const pendingSwitch = useLibraryAccountPendingSwitch(account);
    const accentColor = theme.accentColor || 'currentColor';
    const boxBackground = resolveTuiBoxBackground(theme.backgroundColor);
    const containerRef = useRef<HTMLDivElement>(null);
    const visible = Boolean(pendingSwitch);

    // 显示出来时把焦点拿进层里：首页上开着的行内输入框不该继续接收按键。
    useEffect(() => {
        if (visible && isInteractive) containerRef.current?.focus({ preventScroll: true });
    }, [visible, isInteractive, pendingSwitch?.request.id]);

    useLibraryTuiAccountKeys({
        isActive: visible && isInteractive,
        containerRef,
        onKey: (key) => {
            if (!pendingSwitch) return false;
            const requestId = pendingSwitch.request.id;
            // 不 await：controller 同步清掉待确认请求，层随之收起；离开旧平台与读账号在后台走完。
            if (key === 'Enter') void account.confirmSwitch(requestId);
            else if (key === 'Escape') account.cancelSwitch(requestId);
            else return false;
            return true;
        },
    });

    if (!pendingSwitch) return null;

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            data-tui-account="confirm"
            data-ponder-page-scope="none"
            data-folia-keyboard-window={isInteractive ? 'true' : undefined}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 font-mono outline-none"
            // 点在遮罩上不把焦点交出去（按键照样归这一层，这里只是别让首页的元素拿到焦点）。
            onMouseDown={event => {
                if (event.target === event.currentTarget) event.preventDefault();
            }}
        >
            <LibraryTuiAccountConfirm
                view={pendingSwitch}
                accentColor={accentColor}
                boxBackground={boxBackground}
                onConfirm={() => void account.confirmSwitch(pendingSwitch.request.id)}
                onCancel={() => void account.cancelSwitch(pendingSwitch.request.id)}
            />
        </div>
    );
};

export default LibraryTuiAccount;
