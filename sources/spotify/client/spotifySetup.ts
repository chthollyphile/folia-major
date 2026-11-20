import type { FoliumSourceSetupStep, FoliumSourceSetupView, FoliumText } from '@folia/folium';
import { requestSpotify } from './spotifyTransport';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode, type SpotifyPlaybackMode } from './spotifySoloistPlayback';

// sources/spotify/client/spotifySetup.ts
// What the sign-in window's setup checklist shows for Spotify (FoliumSourceSetupView), and what its
// buttons do. Its words are the mod's own (locales/, under `soloist.`). Two things are set up here:
// - right after a sign-in the standard way, whether Spotify gives the account audio keys: when it
//   gives none (the account cannot play the standard way), the checklist offers Soloist;
// - Soloist itself: the program (downloaded from Spotify, picked here), its API key, and its
//   pairing with the account in another Spotify app.
// The desktop side does the work (sources/spotify/main/soloist.cjs); this file only reads its state
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

/** What the probe right after a sign-in found (sources/spotify/main/spotifyApiBridge.cjs `audio_probe`). */
type SpotifyProbeAnswer = 'ok' | 'no-key' | 'free' | 'skipped' | 'unknown';

/** The mod's texts: activate (index.ts) hands them in. */
export interface SpotifySetupTexts {
    /** A key of the mod's locale files as a FoliumText. */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** The same, written out in the UI language now. */
    translate(key: string): string;
}
let texts: SpotifySetupTexts = { text: key => key, translate: key => key };
export const connectSpotifySetup = (next: SpotifySetupTexts): void => { texts = next; };
const t = (key: string, params?: Record<string, string | number>): FoliumText => texts.text(`soloist.${key}`, params);

type SetupAction = NonNullable<FoliumSourceSetupStep['actions']>[number];
type SetupMessage = NonNullable<FoliumSourceSetupView['message']>;

// What the last button said, shown under the checklist for a while (the checklist is asked for
// again every few seconds while it is open).
const MESSAGE_SHOWN_MS = 8000;
let message: { said: SetupMessage; at: number } | null = null;
const say = (key: string, tone: 'ok' | 'warn' | 'error'): void => { message = { said: { text: t(key), tone }, at: Date.now() }; };

const link = (id: string, labelKey: string): SetupAction => ({ id, label: t(labelKey), kind: 'link' });
const run = (id: string, labelKey: string, primary = false): SetupAction => ({ id, label: t(labelKey), kind: 'run', primary });

// Dates in the UI language now (the mod's `dateLocale`: an Intl locale for it).
const dateText = (at: number | null): string => {
    if (!at) return '';
    try {
        return new Intl.DateTimeFormat(texts.translate('dateLocale') || 'en', { dateStyle: 'medium' }).format(at);
    } catch {
        return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(at);
    }
};

const takeMessage = (): SetupMessage | undefined => (
    message && Date.now() - message.at < MESSAGE_SHOWN_MS ? message.said : undefined
);

/** The way it plays now, and the button that changes it. */
const modeStep = (mode: SpotifyPlaybackMode, attention = false): FoliumSourceSetupStep => (mode === 'soloist'
    ? { id: 'mode', title: t('step.modeSoloist'), note: t('mode.soloistNote'), state: 'done', actions: [run('use-standard', 'action.useStandard')] }
    : {
        id: 'mode',
        title: t('step.modeStandard'),
        note: t(attention ? 'mode.noKeyNote' : 'mode.standardNote'),
        state: attention ? 'warn' : 'done',
        actions: [run('use-soloist', 'action.useSoloist', attention)],
    });

const programStep = (state: SoloistWireState): FoliumSourceSetupStep => {
    const program = state.executable;
    const pick: SetupAction = { id: 'pick', label: t(program ? 'action.pickAgain' : 'action.pick'), kind: 'pick-file', primary: !program || program.state === 'expired' };
    const actions = [link('download', 'action.download'), pick];
    if (!program) return { id: 'program', title: t('step.program'), note: t('program.todo'), state: 'todo', actions };
    const params = { version: program.version ?? '?', days: program.daysLeft ?? 0, expires: dateText(program.expiresAt), built: dateText(program.builtAt) };
    const shown: Record<SoloistBuildState, FoliumSourceSetupStep['state']> = {
        valid: 'done', expiring: 'warn', unknown: 'warn', clock: 'warn', expired: 'error', missing: 'error', invalid: 'error',
    };
    return {
        id: 'program',
        title: t('step.program'),
        note: t(`program.${program.state}`, params),
        state: shown[program.state],
        detail: program.path,
        actions,
    };
};

const keyStep = (state: SoloistWireState): FoliumSourceSetupStep => {
    const actions: SetupAction[] = [link('key-page', 'action.keyPage'), { id: 'save-key', label: t('action.saveKey'), kind: 'submit-secret', primary: true }];
    const secret = { label: t('key.label'), saved: state.key === 'saved' };
    if (state.key === 'saved') return { id: 'key', title: t('step.key'), note: t('key.saved'), state: 'done', secret, actions };
    if (state.key === 'locked') return { id: 'key', title: t('step.key'), note: t('key.locked'), state: 'warn', secret, actions: [...actions, run('restart', 'action.reconnect')] };
    if (!state.canSealKey) return { id: 'key', title: t('step.key'), note: t('key.noKeychain'), state: 'error', actions: [link('key-page', 'action.keyPage')] };
    if (state.key === 'unreadable') return { id: 'key', title: t('step.key'), note: t('key.unreadable'), state: 'error', secret, actions };
    return { id: 'key', title: t('step.key'), note: t('key.todo'), state: 'todo', secret, actions };
};

const pairStep = (state: SoloistWireState, ready: boolean): FoliumSourceSetupStep => {
    if (state.paired) return { id: 'pair', title: t('step.pair'), note: t('pair.done'), state: 'done' };
    if (!ready) return { id: 'pair', title: t('step.pair'), note: t('pair.waiting'), state: 'todo' };
    if (!state.running && (state.error === 'start' || state.error === 'exited')) {
        return { id: 'pair', title: t('step.pair'), note: t('pair.startFailed'), state: 'error', actions: [run('restart', 'action.reconnect', true)] };
    }
    if (!state.running) return { id: 'pair', title: t('step.pair'), note: t('pair.starting'), state: 'todo', actions: [run('restart', 'action.reconnect')] };
    return { id: 'pair', title: t('step.pair'), note: t('pair.todo'), state: 'todo', actions: [run('restart', 'action.reconnect')] };
};

const soloistView = (read: SoloistWireState): FoliumSourceSetupView => {
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
        title: t('setup.title'),
        note: t('setup.note'),
        steps: [program, keyStep(state), pair, modeStep('soloist')],
        complete: ready && pair.state === 'done',
        message: takeMessage(),
    };
};

const standardView = (attention: boolean): FoliumSourceSetupView => ({
    title: t(attention ? 'noKey.title' : 'setup.titleStandard'),
    note: t(attention ? 'noKey.note' : 'setup.noteStandard'),
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
export const getSpotifySetup = async (): Promise<FoliumSourceSetupView | null> => {
    const answer = await readSpotifyPlaybackMode();
    if (!answer?.soloist) return null;
    if (answer.mode === 'standard') return standardView(noKeySeen);
    return soloistView(await readState(true));
};

/**
 * After a sign-in. The Soloist way: its checklist, unless all of it is done. The standard way: the
 * account's audio key is probed, and an account Spotify gives no key gets the offer of Soloist.
 */
export const checkSpotifyAfterLogin = async (methodId: string | null): Promise<FoliumSourceSetupView | null> => {
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
            if (!picked.picked && picked.executable) say(picked.executable.state === 'expired' ? 'message.pickedExpired' : 'message.pickedInvalid', 'error');
            else if (picked.picked) say('message.picked', 'ok');
            return;
        }
        case 'save-key': {
            const saved = await requestSpotify<{ saved: boolean; why?: 'shape' | 'keychain' }>('soloist_key', { key: value ?? '' });
            if (saved.saved) say('message.keySaved', 'ok');
            else say(saved.why === 'keychain' ? 'message.keychain' : 'message.keyShape', 'error');
            return;
        }
        case 'restart':
            try {
                await requestSpotify('soloist_restart');
            } catch (error) {
                console.warn('[Spotify] Soloist did not start again', error);
                say('message.startFailed', 'error');
            }
            return;
        default:
            throw new Error(`Unknown Spotify setup action: ${actionId}`);
    }
};

/** Does one button of the checklist; a failure is said under the checklist, not thrown. */
export const runSpotifySetupAction = async (_stepId: string, actionId: string, value?: string): Promise<FoliumSourceSetupView> => {
    message = null;
    try {
        await runAction(actionId, value);
    } catch (error) {
        console.warn(`[Spotify] The setup action ${actionId} failed`, error);
        say('message.failed', 'error');
    }
    return await getSpotifySetup() ?? standardView(false);
};
