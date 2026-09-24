import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// test/unit/electron/appleMusic.test.ts

const require = createRequire(import.meta.url);
const { validateDeveloperToken } = require('../../../electron/appleMusic/credentials.cjs');
const { validateRequest } = require('../../../electron/appleMusic/host.cjs');
const token = (exp: number, alg = 'ES256') => [JSON.stringify({ alg }), JSON.stringify({ exp })].map(s => Buffer.from(s).toString('base64url')).join('.') + '.signature';

describe('isolated Apple Music host boundary', () => {
    it('rejects malformed, expired and incorrectly signed-format developer tokens', () => {
        expect(() => validateDeveloperToken('secret')).toThrow('developer-token-invalid');
        expect(() => validateDeveloperToken(token(100), 100000)).toThrow('developer-token-expired');
        expect(() => validateDeveloperToken(token(1000, 'none'), 100000)).toThrow('developer-token-invalid');
        expect(validateDeveloperToken(token(1000), 100000)).toBe(token(1000));
    });
    it('allows known catalog and library operations and rejects arbitrary calls', () => {
        for (const path of ['/v1/me/storefront', '/v1/me/library/playlists?limit=1', '/v1/catalog/us/songs/42/lyrics']) expect(() => validateRequest('api', { path })).not.toThrow();
        for (const path of ['https://evil.example', '/v1/me/library/../account', '/v1/me/account', '/v1/catalog/us/\\evil']) expect(() => validateRequest('api', { path })).toThrow();
        for (const path of ['/v1/me/ratings/songs/42', '/v1/me/ratings/library-songs?ids=i.a,i.b', '/v1/me/recommendations', '/v1/me/recent/played/tracks', '/v1/me/history/heavy-rotation', '/v1/me/library?ids[songs]=42']) expect(() => validateRequest('api', { path })).not.toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/ratings/songs/42', method: 'PUT', body: { attributes: { value: 1 } } })).not.toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/ratings/songs/42', method: 'DELETE' })).not.toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/ratings/songs/42', method: 'PATCH' })).toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/storefront', body: { any: 1 } })).toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/ratings/songs/42', method: 'PUT', body: [1] })).toThrow();
        expect(() => validateRequest('api', { path: '/v1/me/recommendationsx/../account' })).toThrow();
        expect(() => validateRequest('execute', { code: 'anything' })).toThrow();
        expect(() => validateRequest('command', { command: 'volume', value: 2 })).toThrow();
        expect(() => validateRequest('command', { command: 'seek', value: NaN })).toThrow();
        expect(() => validateRequest('command', { command: 'unauthorize' })).toThrow();
        expect(() => validateRequest('start', { id: '42"});' })).toThrow();
        expect(() => validateRequest('start', { id: 'i.library' })).not.toThrow();
        expect(() => validateRequest('start', { id: '42', bitrate: 64, continueIfCurrent: true })).not.toThrow();
        expect(() => validateRequest('start', { id: '42', bitrate: 128 })).toThrow();
        expect(() => validateRequest('start', { id: '42', continueIfCurrent: 'yes' })).toThrow();
        expect(() => validateRequest('queueNext', { id: 'i.next' })).not.toThrow();
        expect(() => validateRequest('queueNext', { id: '1");x(' })).toThrow();
    });
});
