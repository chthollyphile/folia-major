import { afterEach, describe, expect, it, vi } from 'vitest';
import { lyricProxyWebUrl, requestLyricProxyOnDesktop } from '@/services/lyricProxy';

// test/unit/services/lyricProxy.test.ts
// The app's own relay: the web address it builds and when the desktop bridge is called.

describe('lyricProxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('builds the web address with the whole target encoded into one parameter', () => {
        const target = 'http://complexsearch.kugou.com/v2/search/song?keyword=周杰伦 晴天&page=1#top';

        const address = lyricProxyWebUrl(target);

        expect(address).toBe(
            '/api/lyric-proxy?url=http%3A%2F%2Fcomplexsearch.kugou.com%2Fv2%2Fsearch%2Fsong%3Fkeyword%3D%E5%91%A8%E6%9D%B0%E4%BC%A6%20%E6%99%B4%E5%A4%A9%26page%3D1%23top',
        );
        expect(new URL(address, 'http://localhost').searchParams.get('url')).toBe(target);
    });

    it('calls the desktop bridge with the target and the request it was given', async () => {
        const answer = { ok: true, status: 200, bodyText: 'body' };
        const fetchLyricProxy = vi.fn().mockResolvedValue(answer);
        vi.stubGlobal('window', { electron: { fetchLyricProxy } });
        const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };

        await expect(requestLyricProxyOnDesktop('https://u.y.qq.com/cgi-bin/musicu.fcg', init)).resolves.toBe(answer);

        expect(fetchLyricProxy).toHaveBeenCalledTimes(1);
        expect(fetchLyricProxy).toHaveBeenCalledWith('https://u.y.qq.com/cgi-bin/musicu.fcg', init);
    });

    it('returns null when the desktop shell has no relay bridge', () => {
        vi.stubGlobal('window', { electron: {} });

        expect(requestLyricProxyOnDesktop('https://m.kugou.com/app/i/getSongInfo.php')).toBeNull();
    });

    it('returns null on the web', () => {
        vi.stubGlobal('window', {});
        expect(requestLyricProxyOnDesktop('https://m.kugou.com/app/i/getSongInfo.php')).toBeNull();

        vi.stubGlobal('window', undefined);
        expect(requestLyricProxyOnDesktop('https://m.kugou.com/app/i/getSongInfo.php')).toBeNull();
    });
});
