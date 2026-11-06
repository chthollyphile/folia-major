import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '../../types';
import type { DailySongPreview, OnlineProviderId } from '../../types/onlineMusic';

// Keeps one account-owned daily preview; Omni alone publishes completed, accepted recommendation reads.

type DailyPreviewRead = { providerId: OnlineProviderId; ownerGeneration: number; sequence: number };

export const createDailySongPreviews = (activeProviderId: () => OnlineProviderId) => {
    const ownerOf = () => {
        const providerId = activeProviderId();
        const user = useOnlineProviderAccountStore.getState().accounts[providerId]?.user;
        return { providerId, userId: user ? String(user.id) : null };
    };
    let owner = ownerOf();
    let ownerGeneration = 0;
    let nextSequence = 0;
    let acceptedSequence = 0;
    let snapshot: DailySongPreview | null = null;
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.warn('[Omni] daily song preview listener failed', error);
            }
        }
    };

    // Account identity, rather than the user object's reference or token freshness, owns a preview.
    const checkOwner = () => {
        const nextOwner = ownerOf();
        if (owner.providerId === nextOwner.providerId && owner.userId === nextOwner.userId) return;
        owner = nextOwner;
        ownerGeneration += 1;
        acceptedSequence = 0;
        if (snapshot !== null) {
            snapshot = null;
            notify();
        }
    };
    const unsubscribeAccount = useOnlineProviderAccountStore.subscribe(checkOwner);

    return {
        begin(): DailyPreviewRead {
            checkOwner();
            return { providerId: owner.providerId, ownerGeneration, sequence: ++nextSequence };
        },
        publish(read: DailyPreviewRead, firstSong: UnifiedSong | undefined): void {
            checkOwner();
            if (read.ownerGeneration !== ownerGeneration || read.sequence <= acceptedSequence) return;
            acceptedSequence = read.sequence;
            if (snapshot?.providerId === owner.providerId && snapshot.firstSong === firstSong) return;
            snapshot = { providerId: owner.providerId, firstSong };
            notify();
        },
        getSnapshot: (): DailySongPreview | null => snapshot,
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        checkOwner,
        dispose(): void {
            unsubscribeAccount();
            listeners.clear();
        },
    };
};
