import i18n from '../../../i18n/config';
import type { ProviderSetupAction, ProviderSetupStep, ProviderSetupView } from '../../../types/onlineMusic';
import { requestSpotify } from './spotifyTransport';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode, type SpotifyPlaybackMode } from './spotifySoloistPlayback';

// src/services/onlineMusic/spotify/spotifySetup.ts
// What the sign-in window's setup checklist shows for Spotify (ProviderSetupView), and what its
// buttons do. Three things are set up here:
// - right after a sign-in the standard way, whether Spotify gives the account audio keys: when it
//   gives none (the account cannot play the standard way), the checklist offers Soloist and, on
//   Windows, Spotify's own desktop app;
// - Soloist itself: the program (downloaded from Spotify, picked here), its API key, and its
//   pairing with the account in another Spotify app;
// - Spotify's own app: whether it is installed (nothing else is set up for it).
// The desktop side does the work (electron/spotify/soloist.cjs, officialClient.cjs); this file only
// reads its state and words it. The API key goes to the desktop side once and never comes back.

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

/** What the desktop side says of Spotify's own app (spotifyApiBridge.cjs `client_probe`). */
interface ClientWireState { available: boolean; reason?: string }

/** Why the standard way was stopped at after a sign-in: the account gets no audio key, or is a free one. */
type Attention = 'no-key' | 'free' | null;

/** Which of the other ways Spotify plays the desktop side offers. */
interface OfferedModes { soloist: boolean; client: boolean }

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

/** The way it plays now, and the buttons that change it (only to the ways the desktop side offers). */
const modeStep = (mode: SpotifyPlaybackMode, offered: OfferedModes, attention: Attention = null): ProviderSetupStep => {
    const toStandard = run('use-standard', 'soloist.action.useStandard');
    const toSoloist = (primary: boolean) => run('use-soloist', 'soloist.action.useSoloist', primary);
    const toClient = (primary: boolean) => run('use-client', 'soloist.action.useClient', primary);
    if (mode === 'soloist') {
        return {
            id: 'mode', titleKey: 'soloist.step.modeSoloist', noteKey: 'soloist.mode.soloistNote', state: 'done',
            actions: [toStandard, ...(offered.client ? [toClient(false)] : [])],
        };
    }
    if (mode === 'client') {
        return {
            id: 'mode', titleKey: 'soloist.step.modeClient', noteKey: 'soloist.mode.clientNote', state: 'done',
            actions: [toStandard, ...(offered.soloist ? [toSoloist(false)] : [])],
        };
    }
    return {
        id: 'mode',
        titleKey: 'soloist.step.modeStandard',
        noteKey: attention === 'free' ? 'soloist.mode.freeNote' : attention ? 'soloist.mode.noKeyNote' : 'soloist.mode.standardNote',
        state: attention ? 'warn' : 'done',
        actions: [
            ...(offered.soloist ? [toSoloist(attention !== null)] : []),
            ...(offered.client ? [toClient(attention !== null && !offered.soloist)] : []),
        ],
    };
};

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

const soloistView = (read: SoloistWireState, offered: OfferedModes): ProviderSetupView => {
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
        steps: [program, keyStep(state), pair, modeStep('soloist', offered)],
        complete: ready && pair.state === 'done',
        message: takeMessage(),
    };
};

/** Spotify's own app: it needs nothing set up but to be installed. */
const clientView = (read: ClientWireState, offered: OfferedModes): ProviderSetupView => ({
    titleKey: 'soloist.setup.clientTitle',
    noteKey: 'soloist.setup.clientNote',
    steps: [
        {
            id: 'app',
            titleKey: 'soloist.step.clientApp',
            noteKey: read.available ? 'soloist.clientApp.ready' : 'soloist.clientApp.missing',
            state: read.available ? 'done' : 'error',
            // 控制这台电脑上的 Spotify 靠的是它未公开的内部结构，可能因它的更新失效，也可能不合它的服务条款；
            // 会改动它哪些状态也在这里说清楚。一句短的留在清单里，长的那段展开才看（窗口不能再高）。
            more: { labelKey: 'soloist.clientApp.more', noteKey: 'soloist.clientApp.moreNote' },
        },
        modeStep('client', offered),
    ],
    complete: read.available,
    message: takeMessage(),
});

const standardView = (attention: Attention, offered: OfferedModes): ProviderSetupView => ({
    titleKey: attention === 'free' ? 'soloist.free.title' : attention ? 'soloist.noKey.title' : 'soloist.setup.titleStandard',
    noteKey: attention === 'free' ? 'soloist.free.note' : attention ? 'soloist.noKey.note' : 'soloist.setup.noteStandard',
    steps: [modeStep('standard', offered, attention)],
    // Playing the standard way needs nothing set up; an account that gets no key may still leave it so.
    complete: attention === null,
    message: takeMessage(),
});

// Why the last view stopped an account at the standard way: it stays so until the way changes.
let noKeySeen: Attention = null;

/** Soloist's state, read; with `start`, a program that is set up is started to say whether it is paired. */
const readState = (start: boolean) => requestSpotify<SoloistWireState>('soloist_state', { start });

/** Whether Spotify's app is on this computer (a look at its launcher on disk, kept for a minute). */
const readClient = () => requestSpotify<ClientWireState>('client_probe');

const offeredBy = (answer: { soloist: boolean; client?: boolean }): OfferedModes => ({ soloist: answer.soloist, client: answer.client === true });

/** The checklist now. Soloist is started only when it is the way Spotify plays. */
export const getSpotifySetup = async (): Promise<ProviderSetupView | null> => {
    const answer = await readSpotifyPlaybackMode();
    if (!answer || (!answer.soloist && !answer.client)) return null;
    const offered = offeredBy(answer);
    if (answer.mode === 'standard') return standardView(noKeySeen, noKeySeen === 'free' ? { soloist: false, client: offered.client } : offered);
    if (answer.mode === 'client') return clientView(await readClient(), offered);
    return soloistView(await readState(true), offered);
};

/**
 * After a sign-in. The Soloist way: its checklist, unless all of it is done. Spotify's own app: its
 * checklist, unless the app is installed. The standard way: the account's audio key is probed, and
 * an account Spotify gives no key gets the offer of the other ways.
 */
export const checkSpotifyAfterLogin = async (methodId: string | null): Promise<ProviderSetupView | null> => {
    const answer = await readSpotifyPlaybackMode();
    if (!answer || (!answer.soloist && !answer.client)) return null;
    const offered = offeredBy(answer);
    if (methodId === 'soloist' || answer.mode === 'soloist') {
        const view = soloistView(await readState(true), offered);
        return view.complete ? null : view;
    }
    if (methodId === 'client' || answer.mode === 'client') {
        const view = clientView(await readClient(), offered);
        return view.complete ? null : view;
    }
    const probe = await requestSpotify<SpotifyProbeAnswer>('audio_probe');
    // A free account cannot use Soloist either, so only Spotify's own app is offered to it.
    if (probe === 'no-key') noKeySeen = 'no-key';
    else if (probe === 'free' && offered.client) noKeySeen = 'free';
    else noKeySeen = null;
    return noKeySeen ? standardView(noKeySeen, noKeySeen === 'free' ? { soloist: false, client: true } : offered) : null;
};

const runAction = async (actionId: string, value?: string): Promise<void> => {
    switch (actionId) {
        case 'use-soloist':
            await setSpotifyPlaybackMode('soloist');
            return;
        case 'use-client':
            await setSpotifyPlaybackMode('client');
            noKeySeen = null;
            return;
        case 'use-standard':
            await setSpotifyPlaybackMode('standard');
            noKeySeen = null;
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
    return await getSpotifySetup() ?? standardView(null, { soloist: false, client: false });
};
