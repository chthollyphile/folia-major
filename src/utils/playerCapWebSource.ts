import type { WebLyricConnectionStatus, WebLyricSource, WebLyricSourceState } from '../types/webLyricSource';
import type { PlayerCapConnectionStatus } from '../types/playerCap';
import type { PlayerCapSessionState } from './playerCapSession';

// src/utils/playerCapWebSource.ts
// Bridges a PlayerCap session onto the source-neutral WebLyricSource consumed by ObsWebSourceApp.
// The clock, playback state and lyrics are structurally identical between the two contracts; only
// the connection status (6 states → 5) and the track (title → visual seed) need adapting.

// Fold PlayerCap's connection enum into the neutral one. The OBS shell does not render connection
// status, so this only needs to be type-correct and reasonable.
export function foldPlayerCapConnectionStatus(status: PlayerCapConnectionStatus): WebLyricConnectionStatus {
    switch (status) {
        case 'connected':
            return 'connected';
        case 'probing':
        case 'connecting':
            return 'connecting';
        case 'disconnected':
        case 'unreachable':
            return 'error';
        default:
            return 'idle';
    }
}

// Adapt a PlayerCap source ({ state, getCurrentTimeSec }) into a WebLyricSource. getCurrentTimeSec is
// passed through unchanged so the shell's shared rAF loop keeps a stable identity.
export function playerCapToWebLyricSource(
    pc: { state: PlayerCapSessionState; getCurrentTimeSec: (nowMs: number) => number },
): WebLyricSource {
    const { state, getCurrentTimeSec } = pc;
    const { track } = state;
    const webState: WebLyricSourceState = {
        connectionStatus: foldPlayerCapConnectionStatus(state.connectionStatus),
        playerState: state.playerState,
        track: track
            ? { name: track.name, artist: track.artist, coverUrl: track.coverUrl || null, seed: track.title }
            : null,
        lyrics: state.lyrics,
        clock: state.clock,
    };
    return { state: webState, getCurrentTimeSec };
}
