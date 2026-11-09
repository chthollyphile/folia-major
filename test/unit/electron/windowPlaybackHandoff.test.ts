import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/windowPlaybackHandoff.test.ts
// Locks down the short-lived main-process playback handoff store.

const require = createRequire(import.meta.url);
const { createWindowPlaybackHandoffStore } = require('../../../electron/windowPlaybackHandoff.cjs') as {
    createWindowPlaybackHandoffStore: (options?: {
        ttlMs?: number;
        now?: () => number;
        storage?: {
            get: (key: string) => unknown;
            set: (key: string, value: unknown) => void;
            delete: (key: string) => void;
        };
        storageKey?: string;
    }) => {
        clear: () => void;
        consume: (consumer?: unknown) => unknown | null;
        carryForward: (consumer: unknown, readSince?: number) => boolean;
        peek: () => unknown | null;
        save: (handoff: unknown) => boolean;
    };
};

// Minimal electron-store-like backing so the disk-backed path can be exercised in-process.
const createMemoryStorage = (): {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    delete: (key: string) => void;
} => {
    const data = new Map<string, unknown>();
    return {
        get: (key) => data.get(key),
        set: (key, value) => { data.set(key, value); },
        delete: (key) => { data.delete(key); },
    };
};

describe('windowPlaybackHandoffStore', () => {
    it('consumes a saved handoff only once', () => {
        let now = 1000;
        const store = createWindowPlaybackHandoffStore({ ttlMs: 5000, now: () => now });
        const handoff = { version: 1, capturedAt: now };

        expect(store.save(handoff)).toBe(true);
        expect(store.peek()).toBe(handoff);
        expect(store.consume()).toBe(handoff);
        expect(store.consume()).toBeNull();
    });

    it('drops expired handoffs', () => {
        let now = 1000;
        const store = createWindowPlaybackHandoffStore({ ttlMs: 100, now: () => now });

        store.save({ version: 1, capturedAt: now });
        now = 1101;

        expect(store.peek()).toBeNull();
        expect(store.consume()).toBeNull();
    });

    it('clears the current handoff when saving invalid payloads', () => {
        const store = createWindowPlaybackHandoffStore();

        store.save({ version: 1, capturedAt: 1 });
        expect(store.save(null)).toBe(false);

        expect(store.consume()).toBeNull();
    });

    it('persists a handoff to storage so a fresh store instance can restore it', () => {
        let now = 1000;
        const storage = createMemoryStorage();

        const first = createWindowPlaybackHandoffStore({ ttlMs: 5000, now: () => now, storage });
        expect(first.save({ version: 1, capturedAt: now })).toBe(true);

        // Simulate a process relaunch: a brand-new store over the same backing restores it,
        // and the restore consumes (clears) the persisted entry exactly once.
        const relaunched = createWindowPlaybackHandoffStore({ ttlMs: 5000, now: () => now, storage });
        expect(relaunched.peek()).toEqual({ version: 1, capturedAt: now });
        expect(relaunched.consume()).toEqual({ version: 1, capturedAt: now });
        expect(relaunched.consume()).toBeNull();
    });

    it('drops a persisted handoff that expired while the process was away', () => {
        let now = 1000;
        const storage = createMemoryStorage();

        createWindowPlaybackHandoffStore({ ttlMs: 100, now: () => now, storage })
            .save({ version: 1, capturedAt: now });
        now = 5000;

        const relaunched = createWindowPlaybackHandoffStore({ ttlMs: 100, now: () => now, storage });
        expect(relaunched.consume()).toBeNull();
        expect(relaunched.peek()).toBeNull();
    });

    it('persists an in-memory-only store only when a backing storage is provided', () => {
        const store = createWindowPlaybackHandoffStore();

        expect(store.save({ version: 1, capturedAt: 1 })).toBe(true);
        expect(store.consume()).toEqual({ version: 1, capturedAt: 1 });
    });

    // A window replaced before it answered for itself (the main process asked before its page was
    // listening, and it read the handoff meanwhile) passes on the handoff it was restoring.
    describe('carrying a read handoff forward', () => {
        const outgoing = { id: 'window 2' };
        const other = { id: 'window 1' };

        it('passes on what the outgoing window read, once, with a fresh lifetime', () => {
            let now = 1000;
            const store = createWindowPlaybackHandoffStore({ ttlMs: 5000, now: () => now });
            const handoff = { version: 1, capturedAt: now };
            store.save(handoff);
            now = 2000;
            expect(store.consume(outgoing)).toBe(handoff);

            now = 4000;
            expect(store.carryForward(outgoing, 1500)).toBe(true);
            now = 8500;
            expect(store.consume()).toBe(handoff);
            expect(store.carryForward(outgoing, 1500)).toBe(false);
        });

        it('passes on nothing the window read before it was asked: it answers for itself then', () => {
            let now = 1000;
            const store = createWindowPlaybackHandoffStore({ ttlMs: 60000, now: () => now });
            store.save({ version: 1, capturedAt: now });
            now = 2000;
            store.consume(outgoing);
            // Asked half a minute later (the page was busy): what it read then is long out of date.
            expect(store.carryForward(outgoing, 30000)).toBe(false);
            expect(store.carryForward(outgoing)).toBe(false);
            expect(store.consume()).toBeNull();
        });

        it('forgets what a window read once a page reads nothing (a reload after a crash)', () => {
            const store = createWindowPlaybackHandoffStore();
            store.save({ version: 1, capturedAt: 1 });
            store.consume(outgoing);
            expect(store.consume(outgoing)).toBeNull();
            expect(store.carryForward(outgoing, 0)).toBe(false);
        });

        it('passes on nothing another window read', () => {
            const store = createWindowPlaybackHandoffStore();
            store.save({ version: 1, capturedAt: 1 });
            store.consume(other);
            expect(store.carryForward(outgoing, 0)).toBe(false);
            expect(store.carryForward(null, 0)).toBe(false);
            expect(store.consume()).toBeNull();
        });

        it('keeps a newer handoff waiting rather than the one read before it', () => {
            const store = createWindowPlaybackHandoffStore();
            store.save({ version: 1, capturedAt: 1 });
            store.consume(outgoing);
            const newer = { version: 1, capturedAt: 2 };
            store.save(newer);
            expect(store.carryForward(outgoing, 0)).toBe(false);
            expect(store.consume()).toBe(newer);
            // The newer answer replaced what was read: nothing older comes back after it.
            expect(store.carryForward(outgoing, 0)).toBe(false);
        });

        it('passes on nothing read longer ago than a handoff lives', () => {
            let now = 1000;
            const store = createWindowPlaybackHandoffStore({ ttlMs: 5000, now: () => now });
            store.save({ version: 1, capturedAt: now });
            store.consume(outgoing);
            now = 6001;
            expect(store.carryForward(outgoing, 0)).toBe(false);
            expect(store.consume()).toBeNull();
        });
    });
});
