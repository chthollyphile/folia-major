import React, { useState, useEffect } from 'react';
import { Copy, Minus, Radio, Square, X } from 'lucide-react';

export default function WindowControls({
    revealed,
}: {
    revealed: boolean;
}) {
    const [isMaximized, setIsMaximized] = useState(false);
    const electron = (window as any).electron;

    useEffect(() => {
        if (!electron) return;
        const checkMaximize = async () => setIsMaximized(await electron.isWindowMaximized());
        checkMaximize();
        window.addEventListener('resize', checkMaximize);
        return () => window.removeEventListener('resize', checkMaximize);
    }, [electron]);

    if (!electron) return null;

    const controlsVisible = revealed;
    const btnClass = `flex items-center justify-center w-11 h-full transition-all duration-200 ${
        controlsVisible ? 'opacity-75 translate-y-0 hover:opacity-100 hover:bg-white/10' : 'opacity-0 -translate-y-1'
    }`;
    const closeBtnClass = `flex items-center justify-center w-11 h-full transition-all duration-200 ${
        controlsVisible ? 'opacity-75 translate-y-0 hover:opacity-100 hover:bg-red-500 hover:text-white' : 'opacity-0 -translate-y-1'
    }`;

    return (
        <div
            className="flex h-full text-[var(--text-primary)]"
            style={{
                WebkitAppRegion: 'no-drag',
                pointerEvents: controlsVisible ? 'auto' : 'none',
            } as React.CSSProperties}
        >
            <button
                className={btnClass}
                title="Remote control"
                onClick={() => void electron.openRemoteControl?.()}
            >
                <Radio size={15} />
            </button>
            <button className={btnClass} onClick={() => electron.minimizeWindow()}>
                <Minus size={16} />
            </button>
            <button className={btnClass} onClick={async () => {
                await electron.toggleMaximizeWindow();
                setIsMaximized(await electron.isWindowMaximized());
            }}>
                {isMaximized ? <Copy size={13} /> : <Square size={13} />}
            </button>
            <button className={closeBtnClass} onClick={() => electron.closeWindow()}>
                <X size={16} />
            </button>
        </div>
    );
}
