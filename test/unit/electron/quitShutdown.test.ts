import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createQuitShutdownGate } = require('../../../electron/quitShutdown.cjs');

// Which quit asks the bridges to shut down. A quit the bridges' work held is asked for again: that
// one must not ask them twice (the player outside Folia is closed once), and a quit that was
// cancelled halfway must not leave a latch behind for the next one.

describe('the bridges a quit asks', () => {
    it('asks on every quit of its own, and not again for the quit it held', () => {
        const gate = createQuitShutdownGate();
        expect(gate.asks()).toBe(true);
        // The quit they held arrives again: their work was asked for by the quit it held.
        gate.resume();
        expect(gate.asks()).toBe(false);
        // A later quit is a quit of its own again.
        expect(gate.asks()).toBe(true);
    });

    it('asks again for a quit that was cancelled halfway', () => {
        const gate = createQuitShutdownGate();
        expect(gate.asks()).toBe(true);
        // No resume came: another handler took the quit, or a window refused to close. The next quit
        // asks the bridges again instead of finding a latch set by the one that never happened.
        expect(gate.asks()).toBe(true);
    });

    it('asks nothing while the quit they held is still under way', () => {
        const gate = createQuitShutdownGate();
        expect(gate.asks()).toBe(true);
        // A second quit arrives while the bridges work: it is the quit they were asked for.
        expect(gate.asks({ holding: true })).toBe(false);
    });

    it('consumes the resume it was given', () => {
        const gate = createQuitShutdownGate();
        gate.resume();
        expect(gate.asks()).toBe(false);
        expect(gate.asks()).toBe(true);
    });

    it('does not hand the held quit\'s resume to the quit after it', () => {
        const gate = createQuitShutdownGate();
        expect(gate.asks()).toBe(true);
        // The bridges' work holds this quit; they settle and ask for it again.
        gate.resume();
        // A quit arrives while that one is still under way: it asks nothing, and the mark it carried
        // must not stop the next quit from asking (the player outside Folia would stay open).
        expect(gate.asks({ holding: true })).toBe(false);
        expect(gate.asks()).toBe(true);
    });
});
