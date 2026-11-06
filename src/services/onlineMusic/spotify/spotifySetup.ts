import i18n from '../../../i18n/config';
import type { ProviderSetupAction, ProviderSetupStep, ProviderSetupView } from '../../../types/onlineMusic';
import { requestSpotify } from './spotifyTransport';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode, type SpotifyPlaybackMode } from './spotifySoloistPlayback';

// src/services/onlineMusic/spotify/spotifySetup.ts
// What the sign-in window's setup checklist shows for Spotify (ProviderSetupView), and what its
// buttons do. Two things are set up here:
// - right after a sign-in the standard way, whether Spotify gives the account audio keys: when it
//   gives none (the account cannot play the standard way), the checklist offers Soloist;
// - Soloist itself: the program (downloaded from Spotify, picked here), its API key, and its
//   pairing with the account in another Spotify app.
// The desktop side does the work (electron/spotify/soloist.cjs); this file only reads its state
// and words it. The API key goes to the desktop side once and never comes back.

type SoloistBuildState = 'missing' | 'invalid' | 'valid' | 'expiring' | 'expired' | 'unknown' | 'clock';

interface SoloistWireState {
    mode: SpotifyPlaybackMode;
    executable: { path: string; state: SoloistBuildState; version: string | null; builtAt: number | null; expiresAt: number | null; daysLeft: number | null } | null;
    key: 'saved' | 'missing' | 'locked' | 'unreadable';
    canSealKey: boolean;
    running: boolean;
    paired: boolean;
    /** Why the program is not running after it was started: 'expired', 'start', 'exited'. */
    error: string | null;
}

/** What the probe right after a sign-in found (electron/spotify/spotifyApiBridge.cjs `audio_probe`). */
type SpotifyProbeAnswer = 'ok' | 'no-key' | 'free' | 'skipped' | 'unknown';

// What the last button said, shown under the checklist for a while (the checklist is asked for
// again every few seconds while it is open).
const MESSAGE_SHOWN_MS = 8000;
let message: { said: NonNullable<ProviderSetupView['message']>; at: number } | null = null;
const say = (key: string, tone: 'ok' | 'warn' | 'error'): void => { message = { said: { key, tone }, at: Date.now() }; };

const link = (id: string, labelKey: string): ProviderSetupAction => ({ id, labelKey, kind: 'link' });
const run = (id: string, labelKey: string, primary = false): ProviderSetupAction => ({ id, labelKey, kind: 'run', primary });

const dateText = (at: number | null): string => (
    at ? new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'en', { dateStyle: 'medium' }).format(at) : ''
);

const takeMessage = (): ProviderSetupView['message'] => (
    message && Date.now() - message.at < MESSAGE_SHOWN_MS ? message.said : undefined
);

/** The way it plays now, and the button that changes it. */
const modeStep = (mode: SpotifyPlaybackMode, attention = false): ProviderSetupStep => (mode === 'soloist'
    ? { id: 'mode', titleKey: 'soloist.step.modeSoloist', noteKey: 'soloist.mode.soloistNote', state: 'done', actions: [run('use-standard', 'soloist.action.useStandard')] }
    : {
        id: 'mode',
        titleKey: 'soloist.step.modeStandard',
        noteKey: attention ? 'soloist.mode.noKeyNote' : 'soloist.mode.standardNote',
        state: attention ? 'warn' : 'done',
        actions: [run('use-soloist', 'soloist.action.useSoloist', attention)],
    });

const programStep = (state: SoloistWireState): ProviderSetupStep => {
    const program = state.executable;
    const pick: ProviderSetupAction = { id: 'pick', labelKey: program ? 'soloist.action.pickAgain' : 'soloist.action.pick', kind: 'pick-file', primary: !program || program.state === 'expired' };
    const actions = [link('download', 'soloist.action.download'), pick];
    if (!program) return { id: 'program', titleKey: 'soloist.step.program', noteKey: 'soloist.program.todo', state: 'todo', actions };
    const params = { version: program.version ?? '?', days: program.daysLeft ?? 0, expires: dateText(program.expiresAt), built: dateText(program.builtAt) };
    const shown: Record<SoloistBuildState, ProviderSetupStep['state']> = {
        valid: 'done', expiring: 'warn', unknown: 'warn', clock: 'warn', expired: 'error', missing: 'error', invalid: 'error',
    };
    return {
        id: 'program',
        titleKey: 'soloist.step.program',
        noteKey: `soloist.program.${program.state}`,
        params,
        state: shown[program.state],
        detail: program.path,
        actions,
    };
};

const keyStep = (state: SoloistWireState): ProviderSetupStep => {
    const actions = [link('key-page', 'soloist.action.keyPage'), { id: 'save-key', labelKey: 'soloist.action.saveKey', kind: 'submit-secret', primary: true } as ProviderSetupAction];
    const secret = { labelKey: 'soloist.key.label', saved: state.key === 'saved' };
    if (state.key === 'saved') return { id: 'key', titleKey: 'soloist.step.key', noteKey: 'soloist.key.saved', state: 'done', secret, actions };
    if (state.key === 'locked') return { id: 'key', titleKey: 'soloist.step.key', noteKey: 'soloist.key.locked', state: 'warn', secret, actions: [...actions, run('restart', 'soloist.action.reconnect')] };
    if (!state.canSealKey) return { id: 'key', titleKey: 'soloist.step.key', noteKey: 'soloist.key.noKeychain', state: 'error', actions: [link('key-page', 'soloist.action.keyPage')] };
    if (state.key === 'unreadable') return { id: 'key', titleKey: 'soloist.step.key', noteKey: 'soloist.key.unreadable', state: 'error', secret, actions };
    return { id: 'key', titleKey: 'soloist.step.key', noteKey: 'soloist.key.todo', state: 'todo', secret, actions };
};

const pairStep = (state: SoloistWireState, ready: boolean): ProviderSetupStep => {
    if (state.paired) return { id: 'pair', titleKey: 'soloist.step.pair', noteKey: 'soloist.pair.done', state: 'done' };
    if (!ready) return { id: 'pair', titleKey: 'soloist.step.pair', noteKey: 'soloist.pair.waiting', state: 'todo' };
    if (!state.running && (state.error === 'start' || state.error === 'exited')) {
        return { id: 'pair', titleKey: 'soloist.step.pair', noteKey: 'soloist.pair.startFailed', state: 'error', actions: [run('restart', 'soloist.action.reconnect', true)] };
    }
    if (!state.running) return { id: 'pair', titleKey: 'soloist.step.pair', noteKey: 'soloist.pair.starting', state: 'todo', actions: [run('restart', 'soloist.action.reconnect')] };
    return { id: 'pair', titleKey: 'soloist.step.pair', noteKey: 'soloist.pair.todo', state: 'todo', actions: [run('restart', 'soloist.action.reconnect')] };
};

const soloistView = (read: SoloistWireState): ProviderSetupView => {
    // The program refused to start as expired (exit code 10) though its build date could not be read:
    // it is expired, and the setup says to fetch a new build.
    const state = read.error === 'expired' && read.executable && read.executable.state !== 'expired'
        ? { ...read, executable: { ...read.executable, state: 'expired' as const, daysLeft: 0 } }
        : read;
    const program = programStep(state);
    const usable = program.state === 'done' || program.state === 'warn';
    const ready = usable && state.key === 'saved';
    const pair = pairStep(state, ready);
    return {
        titleKey: 'soloist.setup.title',
        noteKey: 'soloist.setup.note',
        steps: [program, keyStep(state), pair, modeStep('soloist')],
        complete: ready && pair.state === 'done',
        message: takeMessage(),
    };
};

const standardView = (attention: boolean): ProviderSetupView => ({
    titleKey: attention ? 'soloist.noKey.title' : 'soloist.setup.titleStandard',
    noteKey: attention ? 'soloist.noKey.note' : 'soloist.setup.noteStandard',
    steps: [modeStep('standard', attention)],
    // Playing the standard way needs nothing set up; an account that gets no key may still leave it so.
    complete: !attention,
    message: takeMessage(),
});

// Whether the last view was for an account that gets no key: it stays so until the way changes.
let noKeySeen = false;

/** Soloist's state, read; with `start`, a program that is set up is started to say whether it is paired. */
const readState = (start: boolean) => requestSpotify<SoloistWireState>('soloist_state', { start });

/** The checklist now. Soloist is started only when it is the way Spotify plays. */
export const getSpotifySetup = async (): Promise<ProviderSetupView | null> => {
    const answer = await readSpotifyPlaybackMode();
    if (!answer?.soloist) return null;
    if (answer.mode === 'standard') return standardView(noKeySeen);
    return soloistView(await readState(true));
};

/**
 * After a sign-in. The Soloist way: its checklist, unless all of it is done. The standard way: the
 * account's audio key is probed, and an account Spotify gives no key gets the offer of Soloist.
 */
export const checkSpotifyAfterLogin = async (methodId: string | null): Promise<ProviderSetupView | null> => {
    const answer = await readSpotifyPlaybackMode();
    if (!answer?.soloist) return null;
    if (methodId === 'soloist' || answer.mode === 'soloist') {
        const view = soloistView(await readState(true));
        return view.complete ? null : view;
    }
    const probe = await requestSpotify<SpotifyProbeAnswer>('audio_probe');
    noKeySeen = probe === 'no-key';
    return noKeySeen ? standardView(true) : null;
};

const runAction = async (actionId: string, value?: string): Promise<void> => {
    switch (actionId) {
        case 'use-soloist':
            await setSpotifyPlaybackMode('soloist');
            return;
        case 'use-standard':
            await setSpotifyPlaybackMode('standard');
            noKeySeen = false;
            return;
        case 'download':
            await requestSpotify('soloist_open', { page: 'download' });
            return;
        case 'key-page':
            await requestSpotify('soloist_open', { page: 'key' });
            return;
        case 'pick': {
            const picked = await requestSpotify<{ picked: boolean; executable: SoloistWireState['executable'] }>('soloist_pick');
            if (!picked.picked && picked.executable) say(picked.executable.state === 'expired' ? 'soloist.message.pickedExpired' : 'soloist.message.pickedInvalid', 'error');
            else if (picked.picked) say('soloist.message.picked', 'ok');
            return;
        }
        case 'save-key': {
            const saved = await requestSpotify<{ saved: boolean; why?: 'shape' | 'keychain' }>('soloist_key', { key: value ?? '' });
            if (saved.saved) say('soloist.message.keySaved', 'ok');
            else say(saved.why === 'keychain' ? 'soloist.message.keychain' : 'soloist.message.keyShape', 'error');
            return;
        }
        case 'restart':
            try {
                await requestSpotify('soloist_restart');
            } catch (error) {
                console.warn('[Spotify] Soloist did not start again', error);
                say('soloist.message.startFailed', 'error');
            }
            return;
        default:
            throw new Error(`Unknown Spotify setup action: ${actionId}`);
    }
};

/** Does one button of the checklist; a failure is said under the checklist, not thrown. */
export const runSpotifySetupAction = async (_stepId: string, actionId: string, value?: string): Promise<ProviderSetupView> => {
    message = null;
    try {
        await runAction(actionId, value);
    } catch (error) {
        console.warn(`[Spotify] The setup action ${actionId} failed`, error);
        say('soloist.message.failed', 'error');
    }
    return await getSpotifySetup() ?? standardView(false);
};
