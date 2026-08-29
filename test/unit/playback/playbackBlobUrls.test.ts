import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retireBlobUrl } from '../../../src/services/playbackBlobUrls';

// A blend keeps the previous track sounding on the other deck, and a URL revoked while that deck
// still holds it leaves the deck unable to seek - silently, with no error event. So the only thing
// that may be revoked is a URL no deck is on.
describe('retireBlobUrl', () => {
    let revoke: ReturnType<typeof vi.fn>;

    /** Pretends the two automix decks are rendering these sources. */
    const decksHolding = (...sources: string[]) => {
        vi.stubGlobal('document', {
            querySelectorAll: () => sources.map(src => ({
                getAttribute: (name: string) => (name === 'src' ? src : null),
                currentSrc: src,
            })),
        });
    };

    beforeEach(() => {
        revoke = vi.fn();
        vi.stubGlobal('URL', { revokeObjectURL: revoke });
        // Drain whatever an earlier case left held, so each starts from an empty ledger.
        decksHolding();
        retireBlobUrl(null);
        revoke.mockClear();
    });

    it('keeps a URL the outgoing deck is still sounding', () => {
        decksHolding('blob:outgoing', 'blob:incoming');
        retireBlobUrl('blob:outgoing');
        expect(revoke).not.toHaveBeenCalled();
    });

    it('revokes it at the next handover, once no deck is on it', () => {
        decksHolding('blob:outgoing', 'blob:incoming');
        retireBlobUrl('blob:outgoing');

        decksHolding('blob:incoming', 'blob:third');
        retireBlobUrl('blob:incoming');
        expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:outgoing');
    });

    // The regression: cancelling a blend by seeking sends the app BACK to the outgoing track, so
    // `blobUrlRef` still names the abandoned incoming one. A ledger that counts generations retires
    // that and revokes the URL the active deck is playing - the silent stall, one arm later.
    it('survives a cancelled blend, where the app steps back instead of forward', () => {
        decksHolding('blob:outgoing', 'blob:incoming');
        retireBlobUrl('blob:outgoing');

        // Cancelled: the outgoing deck keeps playing, the incoming deck is blanked. The next arm
        // hands over the ABANDONED url, because that is what the app was on when it was cancelled.
        decksHolding('blob:outgoing');
        retireBlobUrl('blob:incoming');

        expect(revoke).not.toHaveBeenCalledWith('blob:outgoing');
    });

    it('never revokes the URL it is being handed', () => {
        decksHolding();
        retireBlobUrl('blob:one');
        retireBlobUrl('blob:one');
        expect(revoke).not.toHaveBeenCalled();
    });

    it('sweeps everything let go since the last handover', () => {
        decksHolding('blob:one', 'blob:two');
        retireBlobUrl('blob:one');
        retireBlobUrl('blob:two');

        decksHolding('blob:three');
        retireBlobUrl('blob:three');
        expect(revoke.mock.calls.flat().sort()).toEqual(['blob:one', 'blob:two']);
    });
});
