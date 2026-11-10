import { describe, expect, it } from 'vitest';
import { matchesDirectorySearch } from '@/library/core/directory/directorySearch';

// test/unit/library/core/directorySearch.test.ts

describe('directory basic search', () => {
    const item = {
        name: 'Live',
        path: 'Library/Rock/Live',
        description: 'Concerts',
    };

    it('matches names, metadata, and full folder paths', () => {
        expect(matchesDirectorySearch(item, 'live')).toBe(true);
        expect(matchesDirectorySearch(item, 'concert')).toBe(true);
        expect(matchesDirectorySearch(item, 'library rock')).toBe(true);
        expect(matchesDirectorySearch(item, 'other')).toBe(false);
    });

    it('treats slash text as ordinary basic search', () => {
        expect(matchesDirectorySearch(item, '/path')).toBe(false);
        expect(matchesDirectorySearch({ ...item, path: 'Library/path' }, '/path')).toBe(true);
    });
});
