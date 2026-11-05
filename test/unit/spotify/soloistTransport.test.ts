// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// The silent timeline must preserve transport ownership and must never start before setup succeeds.
const state = vi.hoisted(() => ({ audioSrc: '', hooks: [] as Array<(next: any, previous: any) => void>, prepare: vi.fn() }));
vi.mock('@/stores/usePlaybackStore', () => ({ usePlaybackStore: {
    getState: () => ({ audioSrc: state.audioSrc }),
    subscribe: (fn: (next: any, previous: any) => void) => { state.hooks.push(fn); return () => { state.hooks = state.hooks.filter(hook => hook !== fn); }; },
} }));
vi.mock('@/stores/useAudioSettingsStore', () => ({ useAudioSettingsStore: { getState: () => ({ volume: 0.7, isMuted: false }), subscribe: () => () => {} } }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
import { createSilentWav, disposeSoloistTransport, soloistSource, isSoloistSourceValid } from '@/services/onlineMusic/spotify/spotifySoloistTransport';
const commands: Array<Record<string, unknown>> = [];
const sockets: Socket[] = [];
class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
        super();
        sockets.push(this);
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'auth_state', logged_in: true }) })));
    }
    event(value: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
    send(raw: string) { commands.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
const song = { name: 'Test', durationMs: 300000 } as SongResult;
let serial = 0;
beforeEach(() => {
    vi.stubGlobal('WebSocket', Socket);
    Object.defineProperty(window, 'electron', { value: { soloistPrepare: state.prepare }, configurable: true });
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:soloist-${++serial}`), revokeObjectURL: vi.fn() });
    state.prepare.mockResolvedValue({ ok: true });
    commands.length = 0; sockets.length = 0;
});
afterEach(() => { disposeSoloistTransport(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function media(url: string) {
    const audio = document.createElement('audio');
    Object.defineProperties(audio, { currentSrc: { value: url }, src: { value: url }, paused: { value: false, writable: true }, duration: { value: 300 }, ended: { value: false } });
    vi.spyOn(audio, 'pause').mockImplementation(() => { Object.defineProperty(audio, 'paused', { value: true, writable: true }); audio.dispatchEvent(new Event('pause')); });
    document.body.append(audio);
    return audio;
}
describe('Soloist renderer transport', () => {
    it('creates bounded unsigned PCM silence for the lyric clock', async () => {
        const blob = createSilentWav(1000);
        const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob); });
        expect(new DataView(bytes).getUint32(40, true)).toBe(8000);
        expect([...new Uint8Array(bytes, 44)].every(value => value === 128)).toBe(true);
        expect(createSilentWav(Number.POSITIVE_INFINITY).size).toBe(44 + 180 * 8000);
    });
    it('preserves the full duration of a 40-minute track instead of truncating it', () => {
        expect(createSilentWav(40 * 60 * 1000).size).toBe(44 + 40 * 60 * 8000);
    });
    it('rejects oversized timelines explicitly instead of truncating them', () => {
        expect(() => createSilentWav(4 * 60 * 60 * 1000)).toThrow('soloist.errors.duration');
    });
    it('forwards pause and user seeking while retaining Folia queue ownership', async () => {
        const source = await soloistSource(song, 'g'.repeat(22), 'high'); state.audioSrc = source.url;
        const audio = media(source.url); audio.dispatchEvent(new Event('playing')); await flush();
        audio.currentTime = 42; audio.dispatchEvent(new Event('seeking')); await flush();
        expect(commands).toContainEqual({ type: 'command', command: 'seek', position_ms: 42000 });
        audio.pause(); await flush();
        expect(commands.at(-1)).toEqual({ type: 'command', command: 'pause' });
        expect(commands).toContainEqual({ type: 'command', command: 'set_repeat_track', enabled: false });
        expect(commands).toContainEqual({ type: 'command', command: 'set_repeat_context', enabled: false });
    });
    it('seeks to the restored position after the new remote track is confirmed', async () => {
        const source = await soloistSource(song, 'c'.repeat(22), 'high');
        state.audioSrc = source.url;
        const audio = media(source.url); audio.currentTime = 120;
        audio.dispatchEvent(new Event('playing')); await flush();
        sockets.at(-1)!.event({ type: 'playback_state', item: { uri: `spotify:track:${'z'.repeat(22)}` }, position: { position_ms: 0 } });
        expect(audio.currentTime).toBe(120);
        sockets.at(-1)!.event({ type: 'track_changed', item: { uri: `spotify:track:${'c'.repeat(22)}` } });
        await flush();
        expect(commands).toContainEqual({ type: 'command', command: 'seek', position_ms: 120000 });
    });
    it('pauses the local timeline on disconnect and preserves its position', async () => {
        const source = await soloistSource(song, 'd'.repeat(22), 'high'); state.audioSrc = source.url;
        const audio = media(source.url); audio.currentTime = 75;
        audio.dispatchEvent(new Event('playing')); await flush();
        sockets.at(-1)!.close(); await flush();
        expect(audio.paused).toBe(true); expect(audio.currentTime).toBe(75);
    });
    it('pauses the lyric clock when Soloist rejects an asynchronous command', async () => {
        const source = await soloistSource(song, 'h'.repeat(22), 'high'); state.audioSrc = source.url;
        const audio = media(source.url); audio.currentTime = 25;
        audio.dispatchEvent(new Event('playing')); await flush();
        sockets.at(-1)!.event({ type: 'error', message: 'test dispatch refusal' });
        await flush();
        expect(audio.paused).toBe(true); expect(audio.currentTime).toBe(25);
    });
    it('closes a logged-out connection before replacing it on retry', async () => {
        await soloistSource(song, 'e'.repeat(22), 'high');
        const old = sockets.at(-1)!;
        old.event({ type: 'auth_state', logged_in: false });
        await soloistSource(song, 'f'.repeat(22), 'high');
        expect(old.readyState).toBe(3); expect(sockets).toHaveLength(2);
    });
    it('marks evicted URLs invalid so prefetch can request a fresh timeline', async () => {
        const sources = [];
        for (const letter of ['i', 'j', 'k', 'l', 'm']) sources.push(await soloistSource(song, letter.repeat(22), 'high'));
        expect(isSoloistSourceValid(sources[0].url)).toBe(false);
        expect(isSoloistSourceValid(sources.at(-1)!.url)).toBe(true);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(sources[0].url);
    });
    it('returns a setup error before constructing timeline media', async () => {
        state.prepare.mockResolvedValue({ ok: false, message: 'key' });
        await expect(soloistSource(song, 'a'.repeat(22), 'high')).rejects.toMatchObject({ message: 'soloist.errors.key' });
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(commands).toHaveLength(0);
    });
    it('lets only the selected source control playback and releases hooks on disposal', async () => {
        const first = await soloistSource(song, 'a'.repeat(22), 'high');
        state.audioSrc = first.url;
        const outgoing = media(first.url);
        outgoing.dispatchEvent(new Event('playing'));
        await flush();
        expect(commands).toContainEqual({ type: 'command', command: 'play', uri: `spotify:track:${'a'.repeat(22)}` });
        const next = await soloistSource(song, 'b'.repeat(22), 'high');
        state.audioSrc = next.url;
        state.hooks.forEach(fn => fn({ audioSrc: next.url }, { audioSrc: first.url }));
        const current = media(next.url);
        current.dispatchEvent(new Event('playing'));
        outgoing.dispatchEvent(new Event('playing'));
        await flush();
        expect(commands.filter(c => c.command === 'play').at(-1)).toMatchObject({ uri: `spotify:track:${'b'.repeat(22)}` });
        expect(commands.filter(c => c.command === 'set_volume').at(-1)).toMatchObject({ volume: 70 });
        disposeSoloistTransport();
        expect(state.hooks).toHaveLength(0);
        const count = commands.length;
        current.dispatchEvent(new Event('playing'));
        await flush();
        expect(commands).toHaveLength(count);
        outgoing.remove(); current.remove();
    });
});
