import { describe, expect, it, vi } from 'vitest';

// test/unit/automix/profileRegrid.test.ts
// The one predicate that decides whether an already-measured track gets measured a second time.
//
// Worth its own file because two of its three clauses fail silently and expensively: drop the
// "want" clause and crossfade pays for a beat model whose answer it throws away, drop the "can"
// clause and a machine with no weights re-decodes every track on every prefetch pass forever.

const canRunBeatThis = vi.fn(() => true);
vi.mock('@/services/automix/beatThis', () => ({
    canRunBeatThis: () => canRunBeatThis(),
    analyseBeatGrid: vi.fn(),
}));

const { needsGrid } = await import('@/services/automix/profileService');

const profile = (gridless?: boolean) => ({ gridless } as never);

describe('needsGrid', () => {
    it('re-measures a track no model ever saw, once automix wants a grid', () => {
        expect(needsGrid({ wantGrid: true } as never, profile(true))).toBe(true);
    });

    it('re-measures a profile from before the field existed', () => {
        // Not a corner case: the weights are a new optional download, so every cache built before
        // this was built without a model. Reading their silence as "already gridded" would mean
        // downloading the model changed nothing for anything already analysed.
        expect(needsGrid({ wantGrid: true } as never, profile(undefined))).toBe(true);
    });

    it('leaves a track the model already ran on alone, grid or no grid', () => {
        // `gridless: false` means it RAN. Whether it found beats is not this predicate's business,
        // and treating "ran, found nothing" as unfinished re-decodes that track forever.
        expect(needsGrid({ wantGrid: true } as never, profile(false))).toBe(false);
    });

    it('leaves it alone in crossfade mode', () => {
        expect(needsGrid({ wantGrid: false } as never, profile(true))).toBe(false);
    });

    it('leaves it alone when this build cannot run the model', () => {
        canRunBeatThis.mockReturnValueOnce(false);
        expect(needsGrid({ wantGrid: true } as never, profile(true))).toBe(false);
    });

    it('never retries a track whose analysis failed outright', () => {
        expect(needsGrid({ wantGrid: true } as never, null)).toBe(false);
    });
});
