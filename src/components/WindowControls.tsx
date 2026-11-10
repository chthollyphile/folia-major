import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Maximize, Minimize, Minus, Radio, Square, X } from 'lucide-react';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { useNativeTrafficLights } from '../hooks/useNativeTrafficLights';

export default function WindowControls({
    side = 'right',
    revealed,
    isDaylight = false,
    isMainWindowClickThroughEnabled = false,
    hideFullscreenButton,
}: {
    side?: 'left' | 'right';
    revealed: boolean;
    isDaylight?: boolean;
    isMainWindowClickThroughEnabled?: boolean;
    hideFullscreenButton: boolean;
}) {
    const { t } = useTranslation();
    const [isMaximized, setIsMaximized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const useNativeMacFullscreenButton = usePlayerChromeSettingsStore(state => state.useNativeMacFullscreenButton);
    // 窗口带系统红绿灯时，最小化/最大化/关闭由系统接管，这里只剩遥控和全屏。
    const nativeTrafficLights = useNativeTrafficLights();
    const electron = window.electron;
    const isMac = electron?.platform === 'darwin';
    const usesNativeFullscreen = isMac && (useNativeMacFullscreenButton || isFullscreen);
    const isExpanded = usesNativeFullscreen ? isFullscreen : isMaximized;

    useEffect(() => {
        if (!electron) return;
        let active = true;
        let fullscreenEventReceived = false;
        const unsubscribe = electron.onWindowFullscreenChanged(fullscreen => {
            fullscreenEventReceived = true;
            if (active) setIsFullscreen(fullscreen);
        });
        const checkMaximized = async () => {
            const maximized = await electron.isWindowMaximized();
            if (active) setIsMaximized(maximized);
        };
        const checkFullscreen = async () => {
            const fullscreen = await electron.isWindowFullscreen();
            if (active && !fullscreenEventReceived) setIsFullscreen(fullscreen);
        };
        void checkMaximized();
        void checkFullscreen();
        window.addEventListener('resize', checkMaximized);
        return () => {
            active = false;
            unsubscribe?.();
            window.removeEventListener('resize', checkMaximized);
        };
    }, [electron]);

    if (!electron) return null;

    const remoteControlVisible = revealed && !isMainWindowClickThroughEnabled;
    const standardControlsVisible = revealed && !isMainWindowClickThroughEnabled;
    // Keep the full titlebar hit area while centering the rounded hover surface on the icon.
    const buttonBaseClass = `relative flex items-center justify-center w-11 h-full transition-all duration-200 before:pointer-events-none before:absolute before:inset-x-1 before:rounded-lg before:transition-colors before:duration-200 before:content-[''] [&_svg]:relative ${
        isMac ? 'before:top-1.5 before:-bottom-0.5' : 'before:top-0.5 before:bottom-0.5'
    }`;
    const remoteBtnClass = `${buttonBaseClass} ${
        remoteControlVisible
            ? isDaylight
                ? 'pointer-events-auto opacity-85 translate-y-0 hover:opacity-100 hover:before:bg-black/[0.05]'
                : 'pointer-events-auto opacity-75 translate-y-0 hover:opacity-100 hover:before:bg-white/10'
            : 'pointer-events-none opacity-0 -translate-y-1'
    }`;
    const btnClass = `${buttonBaseClass} ${
        standardControlsVisible
            ? isDaylight
                ? 'pointer-events-auto opacity-85 translate-y-0 hover:opacity-100 hover:before:bg-black/[0.05]'
                : 'pointer-events-auto opacity-75 translate-y-0 hover:opacity-100 hover:before:bg-white/10'
            : 'pointer-events-none opacity-0 -translate-y-1'
    }`;
    const closeBtnClass = `${buttonBaseClass} ${
        standardControlsVisible
            ? isDaylight
                ? 'pointer-events-auto opacity-85 translate-y-0 hover:opacity-100 hover:before:bg-red-500 hover:text-white'
                : 'pointer-events-auto opacity-75 translate-y-0 hover:opacity-100 hover:before:bg-red-500 hover:text-white'
            : 'pointer-events-none opacity-0 -translate-y-1'
    }`;

    const remoteControl = (
        <button
            className={remoteBtnClass}
            title={t('ui.remoteControl')}
            tabIndex={remoteControlVisible ? 0 : -1}
            onClick={() => void electron.openRemoteControl?.()}
        >
            <Radio size={15} />
        </button>
    );
    const fullscreenControl = hideFullscreenButton ? null : (
        <button
            className={btnClass}
            tabIndex={standardControlsVisible ? 0 : -1}
            title={t(isFullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen')}
            aria-label={t(isFullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen')}
            onClick={() => void electron.toggleFullscreenWindow()}
        >
            {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
    );
    const minimizeControl = (
        <button
            className={btnClass}
            tabIndex={standardControlsVisible ? 0 : -1}
            onClick={() => electron.minimizeWindow()}
        >
            <Minus size={16} />
        </button>
    );
    const maximizeControl = (
        <button
            className={btnClass}
            tabIndex={standardControlsVisible ? 0 : -1}
            title={t(usesNativeFullscreen
                ? isExpanded ? 'ui.exitFullscreen' : 'ui.enterFullscreen'
                : isExpanded ? 'ui.restoreWindow' : 'ui.maximizeWindow')}
            aria-label={t(usesNativeFullscreen
                ? isExpanded ? 'ui.exitFullscreen' : 'ui.enterFullscreen'
                : isExpanded ? 'ui.restoreWindow' : 'ui.maximizeWindow')}
            onClick={async () => {
                if (usesNativeFullscreen) {
                    await electron.toggleFullscreenWindow();
                } else {
                    await electron.toggleMaximizeWindow();
                    setIsMaximized(await electron.isWindowMaximized());
                }
            }}
        >
            {usesNativeFullscreen
                ? isExpanded ? <Minimize size={13} /> : <Maximize size={13} />
                : isExpanded ? <Copy size={13} /> : <Square size={13} />}
        </button>
    );
    const closeControl = (
        <button
            className={closeBtnClass}
            tabIndex={standardControlsVisible ? 0 : -1}
            onClick={() => electron.closeWindow()}
        >
            <X size={16} />
        </button>
    );

    return (
        <div
            className={`flex h-full ${isMac ? '[&_svg]:translate-y-1' : ''} ${isDaylight ? 'text-zinc-800' : 'text-[var(--text-primary)]'}`}
            style={{
                WebkitAppRegion: 'no-drag',
                pointerEvents: 'none',
            } as React.CSSProperties}
        >
            {side === 'left'
                ? <>{!nativeTrafficLights && <>{closeControl}{minimizeControl}{maximizeControl}</>}{fullscreenControl}{remoteControl}</>
                : <>{remoteControl}{fullscreenControl}{!nativeTrafficLights && <>{minimizeControl}{maximizeControl}{closeControl}</>}</>}
        </div>
    );
}
