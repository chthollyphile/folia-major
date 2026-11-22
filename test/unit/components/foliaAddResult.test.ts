import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { describeFoliaAddResult } from '@/components/folia-playlists/foliaAddResult';

// test/unit/components/foliaAddResult.test.ts
// 往 Folia 歌单里加完歌之后的提示：加了几首、几首已在歌单里；一首都没加进去时不算成功。

const t = ((key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`) as unknown as TFunction;

describe('describeFoliaAddResult', () => {
    it('says how many were added and how many were already there', () => {
        expect(describeFoliaAddResult({ added: 3, duplicates: 2, rejected: 0 }, 'Mix', t)).toEqual({
            type: 'success',
            text: 'foliaPlaylist.addedSome:{"name":"Mix","added":3,"duplicates":2}',
            note: undefined,
        });
        expect(describeFoliaAddResult({ added: 3, duplicates: 0, rejected: 1 }, 'Mix', t)).toEqual({
            type: 'success',
            text: 'foliaPlaylist.added:{"name":"Mix","added":3}',
            note: 'foliaPlaylist.rejectedNote:{"count":1}',
        });
        expect(describeFoliaAddResult({ added: 3, duplicates: 0, rejected: 0 }, 'Mix', t).note).toBeUndefined();
    });

    it('is a plain note when every song was already there, and a failure when none could go in', () => {
        expect(describeFoliaAddResult({ added: 0, duplicates: 4, rejected: 0 }, 'Mix', t).type).toBe('info');
        expect(describeFoliaAddResult({ added: 0, duplicates: 0, rejected: 2 }, 'Mix', t)).toEqual({
            type: 'error',
            text: 'foliaPlaylist.noneAdded:{}',
        });
    });
});
