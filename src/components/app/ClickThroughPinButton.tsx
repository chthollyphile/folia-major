import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, PinOff } from 'lucide-react';

// Keep-on-top toggle beside the click-through lock. With click-through on the window controls are
// hidden and the tray is the only other way to pin the window, so it comes up with the lock and the
// media buttons (`clickThroughUnlockHotspot.ts` covers it too). Not drawn where Electron cannot pin
// (native Wayland): AppShell leaves it out and moves the media buttons up.

type ClickThroughPinButtonProps = {
    visible: boolean;
    isDaylight: boolean;
};

const ClickThroughPinButton: React.FC<ClickThroughPinButtonProps> = ({ visible, isDaylight }) => {
    const { t } = useTranslation();
    const [pinned, setPinned] = useState(false);

    // The tray, the remote window and the command palette change it too and send no event here,
    // so read it again each time the button comes up.
    useEffect(() => {
        if (!visible) return;
        let mounted = true;
        void window.electron?.getMainWindowAlwaysOnTop().then(next => {
            if (mounted) setPinned(next);
        });
        return () => {
            mounted = false;
        };
    }, [visible]);

    const handleToggle = () => {
        const next = !pinned;
        setPinned(next);
        // Wallpaper mode refuses it, so take what the main process reports back.
        void window.electron?.setMainWindowAlwaysOnTop(next).then(actual => {
            setPinned(actual);
        }).catch((error: unknown) => {
            console.warn('[ClickThroughPin] toggling always-on-top failed', error);
            setPinned(!next);
        });
    };

    const label = pinned ? t('remote.unpin') : t('remote.pinToFront');

    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={pinned}
            title={label}
            tabIndex={visible ? 0 : -1}
            onClick={handleToggle}
            className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all duration-200 ${
                visible
                    ? 'click-through-interactive pointer-events-auto opacity-100 translate-y-0'
                    : 'pointer-events-none opacity-0 -translate-y-1'
            } ${
                pinned
                    ? isDaylight
                        ? 'border-amber-500/30 bg-amber-50/80 text-amber-700 hover:bg-amber-100/90'
                        : 'border-amber-300/35 bg-black/55 text-amber-100 hover:bg-black/70'
                    : isDaylight
                        ? 'border-black/[0.06] bg-white/80 text-zinc-700 hover:bg-white hover:text-zinc-900'
                        : 'border-white/15 bg-black/55 text-white/85 hover:bg-black/70 hover:text-white'
            }`}
        >
            {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
    );
};

export default ClickThroughPinButton;
