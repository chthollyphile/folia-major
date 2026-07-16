import { describe, expect, it } from 'vitest';
import type { LocalLibraryEntity } from '../../../src/types/localLibrary';
import {
    getImportedArtistNames,
    getMatchedArtistNames,
    normalizeLocalLibraryName,
    splitLocalLibraryArtistNames,
} from '../../../src/utils/localLibraryNames';
import { resolveLocalLibraryEntity } from '../../../src/utils/localLibraryResolver';

// test/unit/localLibrary/localLibraryResolver.test.ts
// Covers normalization, alias reuse, ambiguity, and legacy-name safety as pure logic.

const entity = (id: string, name: string): LocalLibraryEntity => ({
    id,
    kind: 'artist',
    displayName: name,
    aliases: [name],
    normalizedAliases: [normalizeLocalLibraryName(name)],
    createdAt: 1,
    updatedAt: 1,
});

describe('localLibraryResolver', () => {
    it('normalizes Unicode width, case, and whitespace', () => {
        expect(normalizeLocalLibraryName('  ＡＲＴＩＳＴ　 Name  ')).toBe('artist name');
    });

    it('reuses a unique alias match', () => {
        const existing = entity('artist-1', 'Björk');
        expect(resolveLocalLibraryEntity({
            entities: [existing],
            kind: 'artist',
            name: ' BJÖRK ',
        })).toEqual({ entity: existing, created: false });
    });

    it('uses the current assignment to disambiguate duplicate aliases', () => {
        const first = entity('artist-1', '同名');
        const second = entity('artist-2', '同名');
        expect(resolveLocalLibraryEntity({
            entities: [first, second],
            kind: 'artist',
            name: '同名',
            currentEntityId: second.id,
        })?.entity.id).toBe(second.id);
    });

    it('creates needsReview identity when ambiguity has no reliable context', () => {
        const result = resolveLocalLibraryEntity({
            entities: [entity('artist-1', '同名'), entity('artist-2', '同名')],
            kind: 'artist',
            name: '同名',
            createId: () => 'review-entity',
        });
        expect(result).toMatchObject({ created: true, entity: { id: 'review-entity', needsReview: true } });
    });

    it('keeps a legacy joined artist string as one alias', () => {
        const result = resolveLocalLibraryEntity({
            entities: [],
            kind: 'artist',
            name: 'A, B / C',
            createId: () => 'legacy-entity',
        });
        expect(result?.entity.aliases).toEqual(['A, B / C']);
    });
});

describe('explicitly separated local artist names', () => {
    it('splits ASCII/full-width semicolons and slashes while preserving order', () => {
        expect(splitLocalLibraryArtistNames('小山百代/三森すずこ')).toEqual(['小山百代', '三森すずこ']);
        expect(splitLocalLibraryArtistNames('小山百代 ／ 三森すずこ')).toEqual(['小山百代', '三森すずこ']);
        expect(splitLocalLibraryArtistNames('小山百代;三森すずこ')).toEqual(['小山百代', '三森すずこ']);
        expect(splitLocalLibraryArtistNames('小山百代；三森すずこ')).toEqual(['小山百代', '三森すずこ']);
    });

    it('does not guess comma, ideographic comma, ampersand, or feat separators', () => {
        expect(splitLocalLibraryArtistNames('A, B、C & D feat. E')).toEqual(['A, B、C & D feat. E']);
    });

    it('applies the slash rule to imported and legacy matched strings', () => {
        const song = {
            id: 'duet',
            fileName: 'duet.flac',
            filePath: 'Library/duet.flac',
            duration: 1,
            fileSize: 1,
            mimeType: 'audio/flac',
            addedAt: 1,
            title: 'duet',
            titleOrigin: 'manual-match' as const,
            importedMetadata: { title: 'duet', titleSource: 'filename' as const, artistNames: ['小山百代/三森すずこ'] },
            onlineMetadata: { source: 'netease' as const, artists: [{ name: '小山百代／三森すずこ' }], matchMode: 'manual' as const, matchedAt: 1 },
        };
        expect(getImportedArtistNames(song)).toEqual(['小山百代', '三森すずこ']);
        expect(getMatchedArtistNames(song)).toEqual(['小山百代', '三森すずこ']);
    });
});
