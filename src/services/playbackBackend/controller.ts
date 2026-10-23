import { getPlaybackBackend, selectedPlaybackBackend, subscribePlaybackBackends } from './registry';
import { prepareBackendSource } from './source';
import type { PlaybackBackendDefinition, PlaybackBackendEvent, PlaybackBackendSession, PlaybackBackendStatus } from './types';

// Serializes transport intent around asynchronous opens; stale sessions cannot move the host clock.

type PreparedSource = Awaited<ReturnType<typeof prepareBackendSource>>;
type PrepareSource = (url: string, sourceId: string, allowHttp: boolean) => Promise<PreparedSource>;

export const createBackendController = (prepare: PrepareSource = prepareBackendSource) => {
    const listeners = new Set<(event: PlaybackBackendEvent) => void>();
    let session: PlaybackBackendSession | null = null;
    let definition: PlaybackBackendDefinition | null = null;
    let generation = 0;
    let revision = 0;
    let wantsPlay = false;
    let volume = 1;
    let prepared: PreparedSource | null = null;
    let sourceId = '';
    let sourceUrl = '';
    let ready: Promise<void> = Promise.resolve();
    let status: PlaybackBackendStatus = { sourceId, state: 'stopped', position: 0, duration: 0 };
    let capturedAt = performance.now();

    const notify = (event: PlaybackBackendEvent) => listeners.forEach(listener => {
        try { listener(event); }
        catch (error) { console.error('[PlaybackBackend] Listener failed', error); }
    });
    const release = async (source: PreparedSource | null) => {
        try { await source?.release(); }
        catch (error) { console.warn('[PlaybackBackend] Releasing source failed', error); }
    };
    const report = (event: PlaybackBackendEvent, token: number) => {
        if (token !== generation) return;
        const eventSource = event.type === 'status' ? event.status?.sourceId : event.sourceId;
        if (!sourceId || eventSource !== sourceId) return;
        if (event.type === 'status') {
            if (!Number.isFinite(event.status.position) || event.status.position < 0
                || !Number.isFinite(event.status.duration) || event.status.duration < 0
                || !['loading', 'playing', 'paused', 'stopped'].includes(event.status.state)) return;
            status = { ...event.status };
            capturedAt = performance.now();
        } else {
            wantsPlay = false;
            status = { ...status, state: event.type === 'ended' ? 'stopped' : 'paused',
                ...(event.type === 'error' && status.output ? { output: { ...status.output, exclusiveActive: null } } : {}),
            };
        }
        notify(event);
    };

    const setBackend = async (next: PlaybackBackendDefinition | null, force = false) => {
        if (definition === next && !force) return;
        const token = ++generation;
        revision++;
        wantsPlay = false;
        const previous = session;
        const previousSource = prepared;
        session = null;
        definition = next;
        prepared = null;
        sourceId = '';
        sourceUrl = '';
        status = { sourceId: '', state: 'stopped', position: 0, duration: 0 };
        notify({ type: 'status', status });
        const previousReady = ready;
        ready = (async () => {
            await previousReady.catch(() => {});
            try { await previous?.dispose(); }
            finally { await release(previousSource); }
            if (token === generation && next) session = next.create(event => report(event, token));
        })();
        await ready;
    };

    const open = (url: string) => {
        if (url === sourceUrl && sourceId) return ready;
        const currentRevision = ++revision;
        const token = generation;
        wantsPlay = false;
        sourceUrl = url;
        sourceId = `source-${token}-${currentRevision}`;
        const id = sourceId;
        status = { sourceId: id, state: 'loading', position: 0, duration: 0 };
        capturedAt = performance.now();
        notify({ type: 'status', status });
        const previousReady = ready;
        ready = (async () => {
            await previousReady.catch(() => {});
            if (token !== generation || currentRevision !== revision) return;
            if (!session || !definition) throw new Error('playback-backend-unavailable');
            const active = session;
            await active.pause();
            const next = await prepare(url, id, definition.capabilities.http);
            if (token !== generation || currentRevision !== revision) { await release(next); return; }
            const previous = prepared;
            prepared = next;
            try {
                await active.open(next.source);
                if (token === generation && currentRevision === revision && definition?.capabilities.volume) await active.setVolume(volume);
            } catch (error) {
                if (prepared === next) prepared = null;
                await release(next);
                throw error;
            } finally { await release(previous); }
        })().catch(error => {
            if (token === generation && currentRevision === revision) {
                sourceUrl = '';
                wantsPlay = false;
                status = { ...status, state: 'paused' };
            }
            throw error;
        });
        return ready;
    };

    const play = async () => {
        wantsPlay = true;
        const token = generation;
        const id = sourceId;
        await ready;
        if (token !== generation || id !== sourceId || !wantsPlay) return false;
        if (!session) throw new Error('playback-backend-unavailable');
        await session.play();
        // A pause may have arrived while the backend was starting.
        if (!wantsPlay && token === generation) await session.pause();
        return token === generation && id === sourceId && wantsPlay;
    };
    const pause = async () => {
        wantsPlay = false;
        const token = generation;
        await ready.catch(() => {});
        if (token === generation) await session?.pause();
    };
    const seek = async (seconds: number) => {
        if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('invalid-backend-seek');
        const id = sourceId;
        await ready;
        if (id !== sourceId || !session) return;
        if (!definition?.capabilities.seek) throw new Error('backend-seek-unsupported');
        await session.seek(seconds);
    };
    const setVolume = async (value: number) => {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('invalid-backend-volume');
        volume = value;
        if (session && definition?.capabilities.volume) await session.setVolume(value);
    };

    return {
        setBackend, open, play, pause, seek, setVolume,
        stop: () => setBackend(definition, true),
        getStatus: () => status,
        getPosition: () => status.state === 'playing'
            ? Math.min(status.duration || Infinity, status.position + Math.min(1, (performance.now() - capturedAt) / 1000))
            : status.position,
        subscribe: (listener: (event: PlaybackBackendEvent) => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
};

export const backendPlayback = createBackendController();
export const usesPlaybackBackend = () => selectedPlaybackBackend() !== null;
subscribePlaybackBackends(() => {
    void backendPlayback.setBackend(getPlaybackBackend()?.definition ?? null).catch(error => {
        console.error('[PlaybackBackend] Backend change failed', error);
    });
});
