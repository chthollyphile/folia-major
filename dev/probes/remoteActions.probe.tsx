import React, { useEffect, useState } from 'react';
import { getI18n } from 'react-i18next';
import RemoteControlApp from '../../src/components/remote/RemoteControlApp';
import { PlayerState } from '../../src/types';
import { idleVideoExportState } from '../../src/types/videoExport';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../src/types/remoteControl';
import { createRemoteControlActionBridge } from '../../src/services/remoteControlActions';
import { createFoliumClientApi } from '../../src/mods/folium/api';
import { createFoliumExperimental } from '../../src/mods/folium/experimental';
import { registerRemoteActions, remoteActionsRegistry, subscribeRemoteActions } from '../../src/mods/folium/registries/remoteActions';
import type { ModRuntimeInfo } from '../../src/mods/types';
import activate from '../folium/sample-remote-actions/client.mjs';
import type { ProbeDefinition } from './definition';

// dev/probes/remoteActions.probe.tsx
// Real sample, owned registry, action bridge and companion UI; only Electron IPC is mocked.
declare global { interface Window { remoteActionsProbe: {
    enable(): void; disable(): void; daylight(): void; language(language: string): Promise<unknown>;
    track(id: string | null, delay?: boolean): void; flush(): void; many(): void;
    log: string[]; commands: RemoteControlCommand[]; results: boolean[];
}; } }

function RemoteActionsProbe() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const log: string[] = []; const commands: RemoteControlCommand[] = []; const results: boolean[] = [];
        let dispose: (() => void) | undefined; let delayed = false;
        const state: RemoteControlSnapshot = {
            hasTrack: true, trackKey: 'probe:a', title: 'Remote actions demo', artist: 'Offline fixture', coverUrl: null,
            currentTime: 12, duration: 180, playerState: PlayerState.PLAYING, loopMode: 'off',
            canGoPrevious: true, canGoNext: true, prevTrackKey: null, prevTrackTitle: null, prevTrackArtist: null,
            prevTrackCoverUrl: null, nextTrackKey: null, nextTrackTitle: null, nextTrackArtist: null, nextTrackCoverUrl: null,
            trackTransition: null, controlsDisabled: false, isStageActive: false, transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false, mainWindowAlwaysOnTop: false, mainWindowBorderVisible: false,
            playerChromeHidden: false, playerChromeVisibilityMode: 'auto-hide', exportState: idleVideoExportState(),
            isDaylight: false, isLiked: false, canLike: true, subtitleContentMode: 'translation', updatedAt: 0,
        };
        const bridge = createRemoteControlActionBridge(() => ({
            trackKey: state.trackKey,
            context: {
                song: state.trackKey ? { id: state.trackKey, title: state.title!, artist: state.artist!, album: null, source: 'local', ref: null } : null,
                state: state.hasTrack ? 'playing' : 'stopped',
            },
        }));
        const snapshot = () => ({ ...state, remoteActions: bridge.read() });
        let listener: ((value: RemoteControlSnapshot) => void) | undefined;
        const publish = () => { if (!delayed) listener?.(snapshot()); };
        const unsubscribe = subscribeRemoteActions(publish);
        const previous = window.electron;
        window.electron = {
            getRemoteControlSnapshot: async () => snapshot(),
            onRemoteControlSnapshot: (callback: typeof listener) => { listener = callback; return () => { listener = undefined; }; },
            sendRemoteControlCommand: async (command: RemoteControlCommand) => {
                commands.push(command);
                if (command.type === 'remote-action') results.push(await bridge.activate(command));
                publish(); return true;
            },
        } as unknown as NonNullable<typeof window.electron>;
        const disable = () => { dispose?.(); dispose = undefined; remoteActionsRegistry.unregisterAll('overflow'); };
        window.remoteActionsProbe = {
            enable: () => {
                if (dispose) return;
                const mod = { id: 'sample-remote-actions', permissions: [], experimental: ['remote.actions'] } as unknown as ModRuntimeInfo;
                const api = createFoliumClientApi(mod, { context: 'main', experimental: createFoliumExperimental(mod), onRelease: () => {}, stopped: () => false });
                dispose = activate({ ...api, log: { ...api.log, info: (message: string) => log.push(message) } });
            },
            disable, log, commands, results,
            daylight: () => { state.isDaylight = !state.isDaylight; publish(); },
            language: (language) => getI18n().changeLanguage(language),
            track: (id, delay = false) => {
                state.trackKey = id ? `probe:${id}` : null; state.hasTrack = id !== null;
                delayed = delay; publish();
            },
            flush: () => { delayed = false; publish(); },
            many: () => registerRemoteActions('overflow', { id: 'extra', actions: () => Array.from({ length: 30 }, (_, index) => ({
                id: `extra-${index}`, label: { en: `Extra ${index}` }, icon: 'circle', scope: 'session' as const,
                run: () => { log.push(`extra-${index}`); },
            })) }),
        };
        setReady(true);
        return () => { unsubscribe(); disable(); bridge.dispose(); window.electron = previous; };
    }, []);
    // The gallery's opaque background must not cover the remote's negative-z-index backdrop.
    return ready ? <div style={{ isolation: 'isolate' }}><RemoteControlApp /></div> : null;
}

export default { id: 'remoteActions', title: 'Remote additional actions', description: 'Host-rendered append-only actions, native geometry, keyboard activation and teardown.', Component: RemoteActionsProbe } satisfies ProbeDefinition;
