import type { UnifiedSong } from '../../../types';

// QQ 的首页预览保留一批刷歌；入口凭临时票据重复领取，续歌仍读新批次，票据不包含会话。

export const createQqRecommendationPreview = (
    load: () => Promise<UnifiedSong[]>,
    readSession: () => string | null,
) => {
    type Batch = { token: string; promise: Promise<UnifiedSong[]> };
    type Session = { key: string; held?: Batch; taken?: Batch; previews: Map<string, Batch> };
    let session: Session | undefined;
    let batches = 0;

    const current = (): Session | undefined => {
        const key = readSession();
        if (!key) {
            session = undefined;
            return undefined;
        }
        if (session?.key !== key) session = { key, previews: new Map() };
        return session;
    };

    const batchFor = (owner: Session): Batch => {
        if (owner.held) return owner.held;
        const batch: Batch = { token: String(++batches), promise: Promise.resolve([]) };
        batch.promise = (async () => load())().then(songs => {
            if (owner.taken === batch) owner.taken = undefined;
            if (current() !== owner) return [];
            if (songs.length === 0 && owner.held === batch) owner.held = undefined;
            return songs;
        }, (error: unknown) => {
            if (owner.taken === batch) owner.taken = undefined;
            if (owner.held === batch) owner.held = undefined;
            if (current() !== owner) return [];
            throw error;
        });
        owner.held = batch;
        return batch;
    };

    return {
        async reserve(): Promise<{ songs: UnifiedSong[]; playbackToken?: string }> {
            const owner = current();
            if (!owner) return { songs: [] };
            const batch = owner.held ?? owner.taken ?? batchFor(owner);
            const songs = await batch.promise;
            if (!songs.length || current() !== owner) return { songs: [] };
            owner.previews.set(batch.token, batch);
            // Retain recent displayed pages and held walls, without accumulating every refresh in this session.
            if (owner.previews.size > 64) {
                const oldestToken = owner.previews.keys().next().value;
                if (oldestToken !== undefined) owner.previews.delete(oldestToken);
            }
            return { songs, playbackToken: batch.token };
        },
        take(previewToken?: string): Promise<UnifiedSong[]> {
            const owner = current();
            if (!owner) return Promise.resolve([]);
            const batch = previewToken === undefined ? batchFor(owner) : owner.previews.get(previewToken);
            // An old card cannot silently start a fresh, undisplayed batch after its ticket expires.
            if (!batch) return Promise.resolve([]);
            if (owner.held === batch) owner.held = undefined;
            owner.taken = batch;
            // A reservation may have settled this promise before playback took it; release that consumed batch too.
            return batch.promise.then(songs => current() === owner ? songs : []).finally(() => {
                if (owner.taken === batch) owner.taken = undefined;
            });
        },
    };
};
