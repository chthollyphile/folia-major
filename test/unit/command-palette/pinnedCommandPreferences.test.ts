import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PINNED_COMMAND_IDS,
    PINNED_COMMANDS_STORAGE_KEY,
    normalizePinnedCommandIds,
    readPinnedCommandIds,
    resolvePinnedCommandSlots,
    writePinnedCommandIds,
} from '../../../src/stores/pinnedCommandPreferences';
import type { CommandPaletteCommand } from '../../../src/components/command-palette/types';

// test/unit/command-palette/pinnedCommandPreferences.test.ts
// Covers defaults, fixed slot positions, deduplication, and storage recovery.

const createStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
};

// The store reads through storagePrimitives, which checks for a window and then uses the
// global localStorage, so both are stubbed.
const stubStorage = (storage: ReturnType<typeof createStorage>) => {
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('localStorage', storage);
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('pinned command preferences', () => {
    it('uses the three requested defaults when no preference exists', () => {
        stubStorage(createStorage());

        expect(readPinnedCommandIds()).toEqual([
            'playback-prev',
            'playback-next',
            'panel-queue',
        ]);
        expect(readPinnedCommandIds()).not.toBe(DEFAULT_PINNED_COMMAND_IDS);
    });

    it('recovers from invalid JSON with defaults', () => {
        stubStorage(createStorage({ [PINNED_COMMANDS_STORAGE_KEY]: '{invalid' }));

        expect(readPinnedCommandIds()).toEqual(DEFAULT_PINNED_COMMAND_IDS);
    });

    it('keeps three positional slots, removes duplicates, and ignores overflow', () => {
        expect(normalizePinnedCommandIds(['queue', 'queue', 'search-current', 'playback-next'])).toEqual([
            'queue',
            null,
            'search-current',
        ]);
        expect(normalizePinnedCommandIds([null])).toEqual([null, null, null]);
    });

    it('preserves unknown ids for safe resolution against the live registry', () => {
        const commandIds = normalizePinnedCommandIds(['removed-command', 'queue', null]);
        expect(commandIds).toEqual([
            'removed-command',
            'queue',
            null,
        ]);
        const queueCommand = {
            id: 'queue',
            group: 'playback',
            title: 'Queue',
            description: 'Queue',
            keywords: ['queue'],
            execute: () => true,
        } satisfies CommandPaletteCommand;
        expect(resolvePinnedCommandSlots(commandIds, [queueCommand])).toEqual([
            null,
            queueCommand,
            null,
        ]);
    });

    it('persists only the normalized three-slot array', () => {
        const storage = createStorage();
        stubStorage(storage);

        writePinnedCommandIds(['queue', 'queue', 'playback-next']);

        expect(storage.setItem).toHaveBeenCalledWith(
            PINNED_COMMANDS_STORAGE_KEY,
            JSON.stringify(['queue', null, 'playback-next']),
        );
    });
});
