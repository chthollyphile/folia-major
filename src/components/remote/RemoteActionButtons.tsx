import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createFoliumIcon } from '@/mods/folium/icons';
import { resolveFoliumLabel } from '@/mods/params/params';
import type { RemoteActionsSnapshot, RemoteControlCommand } from '@/types/remoteControl';
import { createRemoteActionActivation } from '@/utils/remoteActionActivation';

// src/components/remote/RemoteActionButtons.tsx
type ButtonClasses = { base: string; idle: string; active: string; alert: string };

/** Only the host renders this bounded append area; native controls keep their layout. */
export function RemoteActionButtons({ snapshot, visible, isDaylight, className, classes, sendCommand }: {
    snapshot: RemoteActionsSnapshot | undefined;
    visible: boolean;
    isDaylight: boolean;
    /** Where the host places the area. */
    className: string;
    classes: ButtonClasses;
    sendCommand: (command: RemoteControlCommand) => void;
}) {
    const { i18n } = useTranslation();
    if (!snapshot?.items.length) return null;
    return <div data-folium-slot="remote-actions" hidden={!visible}
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
        className={`${className} items-center gap-1 overflow-auto px-0.5`}
        style={{ display: visible ? 'flex' : 'none', scrollbarWidth: 'thin', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {snapshot.items.map((item) => {
            const label = resolveFoliumLabel(item.label, i18n.language, item.id);
            return <button key={item.handle} type="button" title={label} aria-label={label}
                disabled={item.disabled} aria-pressed={item.pressed}
                data-remote-action={item.id}
                onClick={() => sendCommand(createRemoteActionActivation(snapshot, item))}
                className={`group relative shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 ${classes.base} ${item.tone === 'alert' ? classes.alert : item.pressed ? classes.active : classes.idle}`}>
                <RemoteActionIcon name={item.icon} />
                {item.count !== undefined && <span data-remote-action-count aria-hidden="true"
                    className={`pointer-events-none absolute -right-0.5 top-0 min-w-3 rounded-full px-0.5 text-center text-[9px] leading-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${isDaylight ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-700 text-white'}`}>
                    {item.count}
                </span>}
            </button>;
        })}
    </div>;
}

function RemoteActionIcon({ name }: { name: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let active = true;
        const container = ref.current;
        container?.replaceChildren();
        void createFoliumIcon(name, { size: 15, strokeWidth: 2 }).then((icon) => {
            if (active && icon) container?.replaceChildren(icon);
        }).catch(() => { /* An icon loading failure must not disable its labelled button. */ });
        return () => { active = false; container?.replaceChildren(); };
    }, [name]);
    return <span ref={ref} aria-hidden="true" className="flex h-[15px] w-[15px] items-center justify-center" />;
}
