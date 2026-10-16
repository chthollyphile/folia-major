import React, { useEffect, useState } from 'react';
import { getI18n } from 'react-i18next';
import RemoteControlApp from '../../src/components/remote/RemoteControlApp';
import { PlayerState, type SongResult } from '../../src/types';
import { getPlaybackSongKey } from '../../src/utils/appPlaybackGuards';
import { buildPlaybackSyncBridgeModel, buildRemoteControlSnapshotFromPlaybackSyncBridge, type BuildPlaybackSyncBridgeModelArgs } from '../../src/utils/playbackSyncBridge';
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
    sessionNavigation(enabled: boolean | null): void; hostDisabled(disabled: boolean): void;
    log: string[]; commands: RemoteControlCommand[]; results: boolean[];
}; } }

function RemoteActionsProbe() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const log: string[] = []; const commands: RemoteControlCommand[] = []; const results: boolean[] = [];
        let dispose: (() => void) | undefined; let delayed = false;
        const song = (id: string): SongResult => ({ id, name: 'Remote actions demo', artists: [{ id: 1, name: 'Offline fixture' }], album: { id: 1, name: '' }, durationMs: 180_000 });
        const current = song('a');
        const state: BuildPlaybackSyncBridgeModelArgs = {
            activePlaybackContext: 'main', currentSong: current, playQueue: [song('prev'), current, song('next')],
            currentTimeSec: 12, durationSec: 180, playerState: PlayerState.PLAYING, effectiveLoopMode: 'off', isFmMode: false,
            coverUrl: null, controlsDisabled: false, isStageActive: false, transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false, mainWindowAlwaysOnTop: false, mainWindowBorderVisible: false,
            playerChromeHidden: false, exportState: idleVideoExportState(),
            isDaylight: false, isLiked: false, mainWindowWidth: 450, mainWindowHeight: 230,
        };
        const bridge = createRemoteControlActionBridge(() => ({
            trackKey: state.currentSong ? getPlaybackSongKey(state.currentSong) : null,
            context: {
                song: state.currentSong ? { id: String(state.currentSong.id), title: state.currentSong.name, artist: 'Offline fixture', album: null, source: 'local', ref: null } : null,
                state: state.currentSong ? 'playing' : 'stopped',
            },
        }));
        // Use the main window's real producer: empty-song availability must not be hand-authored here.
        const snapshot = () => ({
            ...buildRemoteControlSnapshotFromPlaybackSyncBridge(buildPlaybackSyncBridgeModel(state), { playerChromeVisibilityMode: 'auto-hide' }),
            canLike: Boolean(state.currentSong), remoteActions: bridge.read(),
        });
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
                const api = createFoliumClientApi(mod, { context: 'main', internals: null, experimental: createFoliumExperimental(mod) });
                dispose = activate({ ...api, log: { ...api.log, info: (message: string) => log.push(message) } });
            },
            disable, log, commands, results,
            daylight: () => { state.isDaylight = !state.isDaylight; publish(); },
            language: (language) => getI18n().changeLanguage(language),
            track: (id, delay = false) => {
                state.currentSong = id ? song(id) : null;
                state.playQueue = state.currentSong ? [song('prev'), state.currentSong, song('next')] : [];
                state.currentTimeSec = id ? 12 : 0; state.durationSec = id ? 180 : 0;
                state.playerState = id ? PlayerState.PLAYING : PlayerState.IDLE;
                delayed = delay; publish();
            },
            flush: () => { delayed = false; publish(); },
            sessionNavigation: (enabled) => {
                state.externalCapabilities = enabled === null ? null : { canNext: enabled, canPrevious: enabled, canSeek: false };
                publish();
            },
            hostDisabled: (disabled) => { state.controlsDisabled = disabled; publish(); },
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
