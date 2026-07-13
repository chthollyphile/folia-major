import { describe, expect, it } from 'vitest';
import type { LocalLibraryEntity } from '../../../src/types/localLibrary';
import { normalizeLocalLibraryName } from '../../../src/utils/localLibraryNames';
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

