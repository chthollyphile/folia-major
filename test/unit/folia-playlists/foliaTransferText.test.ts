import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

// test/unit/folia-playlists/foliaTransferText.test.ts
// 转存与「从原歌单更新」做完之后说什么、歌单详情里的出处怎么写。

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderLabel: (id: string) => ({ alpha: 'Alpha', beta: 'Beta' } as Record<string, string>)[id] ?? id,
        getProviderNaming: () => ({}),
        isSourceSwitchedOn: () => true,
        subscribeProviders: () => () => {},
        getProviderRegistryVersion: () => 0,
    },
}));
vi.mock('@/services/navidromeService', () => ({ getNavidromeConfig: () => ({}) }));

import {
    describeFoliaNothingSavable,
    describeFoliaOriginUnreadable,
    describeFoliaProvenance,
    describeFoliaRefreshResult,
    describeFoliaSaveResult,
    getFoliaSourceLabel,
} from '@/components/folia-playlists/foliaTransferText';
import { FoliaOriginUnreadableError } from '@/library/app/foliaOriginSongs';
import { FoliaNothingToSaveError } from '@/utils/foliaPlaylistTransfer';

// 译文就是「键 + 参数」，断言看得出用了哪句、带了什么数。
const t = ((key: string, options?: Record<string, unknown>) => (
    options ? `${key}${JSON.stringify(options)}` : key
)) as unknown as TFunction;

describe('what is said after saving a collection', () => {
    it('says how many were saved when no target was chosen', () => {
        expect(describeFoliaSaveResult({ swapped: 0, notSwapped: 12, duplicates: 0, rejected: 0 }, 'Mine', undefined, t)).toEqual({
            type: 'success', text: 'foliaTransfer.saved{"name":"Mine","count":12}', note: undefined,
        });
    });

    it('says how many are now played by the target and how many kept their source', () => {
        const message = describeFoliaSaveResult({ swapped: 7, notSwapped: 5, duplicates: 2, rejected: 0 }, 'Mine', 'beta', t);
        expect(message.text).toBe('foliaTransfer.savedVia{"name":"Mine","count":12,"source":"Beta","swapped":7,"kept":5}');
        expect(message.note).toContain('foliaTransfer.duplicatesNote{"count":2}');
    });

    it('says so plainly when the target could not be asked', () => {
        const message = describeFoliaSaveResult({ swapped: 0, notSwapped: 12, duplicates: 0, rejected: 0, playViaUnavailable: 'not-configured' }, 'Mine', 'beta', t);
        expect(message.type).toBe('success');
        expect(message.text).toBe('foliaTransfer.savedNotAsked{"name":"Mine","count":12,"source":"Beta","reason":"foliaTransfer.targetNotConfigured"}');
        expect(message.note).toBe('foliaTransfer.playViaRetryNote');
    });

    it('says in the main text how many the target could not be asked about when only some failed', () => {
        const message = describeFoliaSaveResult({ swapped: 7, notSwapped: 5, duplicates: 0, rejected: 0, playViaFailed: 3 }, 'Mine', 'beta', t);
        expect(message.type).toBe('success');
        expect(message.text).toBe('foliaTransfer.savedViaPartly{"name":"Mine","count":12,"source":"Beta","swapped":7,"kept":5,"failed":3}');
        expect(message.note).toBe('foliaTransfer.playViaRetryNote');
    });

    it('says no playlist was created when none of the songs can go into one', () => {
        expect(describeFoliaNothingSavable(new FoliaNothingToSaveError(4), t)).toEqual({
            type: 'error', text: 'foliaTransfer.nothingSavable{"count":4}', note: 'foliaTransfer.noPlaylistCreated',
        });
    });

    it('is a failure when there was nothing to save', () => {
        expect(describeFoliaSaveResult({ swapped: 0, notSwapped: 0, duplicates: 0, rejected: 0 }, 'Mine', undefined, t))
            .toEqual({ type: 'error', text: 'foliaTransfer.savedNothing' });
    });
});

describe('what is said after updating from the original', () => {
    it('counts what was added, what left the original, and what was switched', () => {
        const message = describeFoliaRefreshResult({ added: 2, swapped: 1, detached: 1, duplicates: 0, rejected: 0 }, 'Mine', 'beta', t);
        expect(message.type).toBe('success');
        expect(message.text).toBe('foliaTransfer.refreshedAddedDetached{"name":"Mine","count":2,"detached":1}');
        expect(message.note).toContain('foliaTransfer.swappedNote{"source":"Beta","count":1}');
    });

    it('puts the songs the target could not be asked about first in the note', () => {
        const message = describeFoliaRefreshResult({ added: 2, swapped: 1, detached: 0, duplicates: 0, rejected: 0, playViaFailed: 4 }, 'Mine', 'beta', t);
        expect(message.type).toBe('success');
        expect(message.note).toBe('foliaTransfer.playViaPartlyFailedNote{"source":"Beta","count":4} foliaTransfer.swappedNote{"source":"Beta","count":1}');
    });

    it('is only a note when nothing changed, or when the original came back empty', () => {
        expect(describeFoliaRefreshResult({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0 }, 'Mine', undefined, t))
            .toEqual({ type: 'info', text: 'foliaTransfer.refreshedNoNew{"name":"Mine","count":0,"detached":0}', note: undefined });
        expect(describeFoliaRefreshResult({ added: 0, swapped: 0, detached: 2, duplicates: 0, rejected: 0 }, 'Mine', undefined, t).text)
            .toBe('foliaTransfer.refreshedNoNewDetached{"name":"Mine","count":0,"detached":2}');
        expect(describeFoliaRefreshResult({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0, originEmpty: true }, 'Mine', 'beta', t))
            .toEqual({ type: 'info', text: 'foliaTransfer.originEmpty{"name":"Mine"}' });
    });

    it('still reports the update when the target could not be asked this time', () => {
        const message = describeFoliaRefreshResult({ added: 3, swapped: 0, detached: 0, duplicates: 0, rejected: 0, playViaUnavailable: 'failed' }, 'Mine', 'beta', t);
        expect(message.text).toBe('foliaTransfer.refreshedAdded{"name":"Mine","count":3,"detached":0}');
        expect(message.note).toBe('foliaTransfer.playViaNotAsked{"source":"Beta","reason":"foliaTransfer.targetFailed"}');
    });
});

describe('what is said when the original cannot be read', () => {
    it('names the source that is gone, and that nothing was changed', () => {
        expect(describeFoliaOriginUnreadable(new FoliaOriginUnreadableError('source-missing'), 'alpha', t))
            .toEqual({ type: 'error', text: 'foliaTransfer.originSourceMissing{"source":"Alpha"}', note: 'foliaTransfer.nothingWritten' });
        expect(describeFoliaOriginUnreadable(new FoliaOriginUnreadableError('source-off'), 'alpha', t).text)
            .toBe('foliaTransfer.originSourceOff{"source":"Alpha"}');
        expect(describeFoliaOriginUnreadable(new FoliaOriginUnreadableError('navidrome-unconfigured'), 'navidrome', t).text)
            .toBe('foliaPlaylist.navidromeUnconfigured');
    });

    it('says a failed read may be a sign-in or a playlist that is gone', () => {
        const message = describeFoliaOriginUnreadable(new FoliaOriginUnreadableError('read-failed', new Error('boom')), 'alpha', t);
        expect(message.type).toBe('error');
        expect(message.text).toContain('foliaTransfer.originReadFailed{"source":"Alpha"}');
        expect(message.note).toBe('foliaTransfer.originReadFailedNote');
    });
});

describe('the provenance line of a saved playlist', () => {
    it('names the source and the original, when it was saved or last updated, and who plays it now', () => {
        const saved = describeFoliaProvenance({ sourceId: 'alpha', collectionId: 'p', name: 'Road', savedAt: Date.UTC(2026, 0, 2) }, t, 'en');
        expect(saved).toContain('foliaTransfer.fromPlaylist{"source":"Alpha","name":"Road"}');
        expect(saved).toContain('foliaTransfer.savedAt{');
        expect(saved).not.toContain('playedVia');

        const updated = describeFoliaProvenance({
            sourceId: 'alpha', collectionId: 'a', name: 'LP', savedAt: 1, refreshedAt: Date.UTC(2026, 0, 3), playVia: 'beta', collectionType: 'album',
        }, t, 'en');
        expect(updated).toContain('foliaTransfer.fromAlbum{"source":"Alpha","name":"LP"}');
        expect(updated).toContain('foliaTransfer.refreshedAt{');
        expect(updated).not.toContain('foliaTransfer.savedAt');
        expect(updated).toContain('foliaTransfer.playedVia{"source":"Beta"}');
        expect(getFoliaSourceLabel('navidrome', t)).toBe('navidrome.title');
    });
});
