import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import { externalQueueSuccessors } from '../../../src/services/onlineMusic/externalQueue';

// A prepared tail follows Folia order and stops at provider boundaries or repeated identities.
const song = (id: string, providerId = 'appleMusic') => ({ id, sourceRef: { kind: 'online', providerId, mediaId: id } }) as SongResult;
describe('external queue successors', () => {
    const a = song('1'), b = song('2'), c = song('3'), d = song('4');
    it('prepares at most two consecutive songs', () => {
        expect(externalQueueSuccessors(a, [a, b, c, d], 'off', false)).toEqual([b, c]);
        expect(externalQueueSuccessors(a, [a, b, song('9', 'qq'), c], 'off', false)).toEqual([b]);
    });
    it('handles repeat-all but leaves repeat-one, FM and duplicate tracks to Folia', () => {
        expect(externalQueueSuccessors(c, [a, b, c], 'all', false)).toEqual([a, b]);
        expect(externalQueueSuccessors(a, [a, b], 'one', false)).toEqual([]);
        expect(externalQueueSuccessors(a, [a, b], 'off', true)).toEqual([]);
        expect(externalQueueSuccessors(a, [a, a, b], 'off', false)).toEqual([]);
        expect(externalQueueSuccessors(a, [b, c], 'all', false)).toEqual([]);
    });
});
