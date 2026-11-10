import React, { useEffect, useState } from 'react';
import { Palette, Pin, PinOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';

// src/components/remote/RemoteWindowTools.tsx
// The remote window's own three tools, top right: background, keep on top, close.
// They show with the pointer in the window, and never when the title bar is switched off.
// Keep on top is greyed out where Electron cannot do it (native Wayland), with a word on why.

export type RemoteBackgroundMode = 'default' | 'cover' | 'transparent';

const BACKGROUND_LABEL_KEYS: Record<RemoteBackgroundMode, string> = {
    default: 'remote.backgroundDefault',
    cover: 'remote.backgroundCover',
    transparent: 'remote.backgroundTransparent',
};

type RemoteWindowToolsProps = {
    backgroundMode: RemoteBackgroundMode;
    alwaysOnTopSupported: boolean;
    onCycleBackgroundMode: () => void;
};

const RemoteWindowTools: React.FC<RemoteWindowToolsProps> = ({ backgroundMode, alwaysOnTopSupported, onCycleBackgroundMode }) => {
    const { t } = useTranslation();
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);
    const pinned = alwaysOnTopSupported && alwaysOnTop;
    const pinLabel = !alwaysOnTopSupported
        ? t('remote.pinUnavailable')
        : alwaysOnTop ? t('remote.unpin') : t('remote.pinToFront');

    useEffect(() => {
        let mounted = true;
        void window.electron?.getRemoteControlAlwaysOnTop?.().then(nextAlwaysOnTop => {
            if (mounted) {
                setAlwaysOnTop(Boolean(nextAlwaysOnTop));
            }
        });
        return () => {
            mounted = false;
        };
    }, []);

    const handleToggleAlwaysOnTop = () => {
        const nextAlwaysOnTop = !alwaysOnTop;
        setAlwaysOnTop(nextAlwaysOnTop);
        void window.electron?.setRemoteControlAlwaysOnTop?.(nextAlwaysOnTop).then(actualAlwaysOnTop => {
            setAlwaysOnTop(Boolean(actualAlwaysOnTop));
        }).catch(() => {
            setAlwaysOnTop(!nextAlwaysOnTop);
        });
    };

    return (
        <div className="remote-tools remote-lit" style={REMOTE_NO_DRAG_STYLE}>
            <button
                type="button"
                aria-label={t(BACKGROUND_LABEL_KEYS[backgroundMode])}
                className="remote-tool"
                onClick={onCycleBackgroundMode}
            >
                <Palette size={13} />
            </button>
            <button
                type="button"
                aria-label={pinLabel}
                aria-pressed={pinned}
                disabled={!alwaysOnTopSupported}
                title={alwaysOnTopSupported ? undefined : pinLabel}
                className="remote-tool"
                onClick={handleToggleAlwaysOnTop}
            >
                {pinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>
            <button
                type="button"
                aria-label={t('remote.close')}
                className="remote-tool"
                onClick={() => void window.electron?.closeRemoteControl?.()}
            >
                <X size={13} />
            </button>
        </div>
    );
};

export default RemoteWindowTools;
