import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqGuessYouLike.test.ts
// 猜你喜欢作为 QQ 的额外电台：回包形状取自 qq-music-api 3.3.6 的 /user/guess-you-like/modes（primaryModes、scenes、
// recommended，条目 { id, name, cover, poolId? }）与 /user/guess-you-like/tracks；编号与名字是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));
vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    requestQq: requestMock,
}));

import { clearQqGuessYouLikeCatalog, QQ_GUESS_YOU_LIKE_STATION } from '@/services/onlineMusic/qq/qqGuessYouLike';
import { qqRecommendations } from '@/services/onlineMusic/qq/qqRecommendations';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import { OnlineProviderError } from '@/types/onlineMusic';

const mode = (id: string, name: string, poolId?: string) => ({ id, name, cover: `https://fixture.invalid/${id}.png`, ...(poolId ? { poolId } : {}) });
const MODES = {
    code: 200,
    station: 'guess-you-like',
    primaryModes: [mode('1', '探索模式', '7101'), mode('2', '默认'), mode('3', '熟悉', '7103')],
    scenes: [mode('11', '助眠', '7111'), mode('12', 'R&B', '7112')],
    // The suggestions often repeat the top row: they are not offered twice.
    recommended: [mode('3', '熟悉', '7103'), mode('13', '动感 DJ', '7113')],
    selectedIds: [],
};
const song = (mid: string, id: number) => ({ mid, id, name: `歌 ${mid}`, singer: [], album: {}, file: { media_mid: `${mid}-media` }, interval: 200 });
const station = (options: { mode?: string; submode?: string | null } = {}) => ({ station: QQ_GUESS_YOU_LIKE_STATION, mode: 'DEFAULT', submode: null, ...options });

const answer = (overrides: Record<string, unknown> = {}) => requestMock.mockImplementation(async (operation: string, params?: { pool?: string }) => {
    if (operation in overrides) {
        const value = overrides[operation];
        if (value instanceof Error) throw value;
        return value;
    }
    if (operation === 'user_guess_you_like_modes') return MODES;
    if (operation === 'user_guess_you_like_tracks') return { code: 200, songs: [song(`pool${params?.pool}`, 2)] };
    if (operation === 'user_guess_you_like') return { code: 200, songs: [song('default', 1)] };
    if (operation === 'user_personal_fm') return { code: 200, songs: [song('fm', 3)] };
    if (operation === 'recommend_playlists') return { code: 200, playlists: [] };
    throw new Error(`unexpected ${operation}`);
});

describe('QQ Guess You Like station', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
        clearQqGuessYouLikeCatalog();
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('offers a station card before the playlists, its cover from the first song of a default batch', async () => {
        answer({ user_guess_you_like: { code: 200, songs: [{ ...song('cover', 1), album: { mid: 'cover-album', name: '专辑' } }] } });
        const [card] = await qqRecommendations.getRecommendedCollections!(10);
        expect(card).toMatchObject({
            providerId: 'qq', type: 'radio',
            personalFm: { mode: 'DEFAULT', scene: null, station: QQ_GUESS_YOU_LIKE_STATION },
        });
        expect(card.coverUrl).toContain('cover-album');
    });

    it('plays the batch read for the cover first, once, when the card starts in the default mode', async () => {
        answer();
        await qqRecommendations.getRecommendedCollections!(10);
        const reads = () => requestMock.mock.calls.filter(call => call[0] === 'user_guess_you_like').length;
        expect(reads()).toBe(1);
        expect((await qqRecommendations.getPersonalFm!(station())).map(entry => entry.qqMid)).toEqual(['default']);
        expect(reads()).toBe(1);
        await qqRecommendations.getPersonalFm!(station());
        expect(reads()).toBe(2);
    });

    it('does not keep a cover batch that comes back after the account was cleared', async () => {
        let release!: (value: unknown) => void;
        answer();
        const base = requestMock.getMockImplementation()!;
        requestMock.mockImplementation((operation: string, params?: { pool?: string }) => (operation === 'user_guess_you_like' && !release
            ? new Promise(resolve => { release = resolve; })
            : base(operation, params)));
        const loading = qqRecommendations.getRecommendedCollections!(10);
        await vi.waitFor(() => expect(release).toBeDefined());
        clearQqGuessYouLikeCatalog();
        release({ code: 200, songs: [song('old-account', 9)] });
        await loading;
        // The next start reads a batch of its own instead of the one of the account before.
        expect((await qqRecommendations.getPersonalFm!(station())).map(entry => entry.qqMid)).toEqual(['default']);
    });

    it('borrows the cover of the default mode when no song can be read', async () => {
        answer({ user_guess_you_like: new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502) });
        const [card] = await qqRecommendations.getRecommendedCollections!(10);
        expect(card).toMatchObject({ coverUrl: 'https://fixture.invalid/2.png', personalFm: { station: QQ_GUESS_YOU_LIKE_STATION } });
    });

    it('uses the first available mode cover when the default has none', async () => {
        answer({
            user_guess_you_like: new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502),
            user_guess_you_like_modes: { ...MODES, primaryModes: [mode('1', '探索模式', '7101'), { ...mode('2', '默认'), cover: '' }] },
        });
        const [card] = await qqRecommendations.getRecommendedCollections!(10);
        expect(card.coverUrl).toBe('https://fixture.invalid/1.png');
    });

    it('has no card when signed out', async () => {
        transportState.hasSession = false;
        answer();
        expect(await qqRecommendations.getRecommendedCollections!(10)).toEqual([]);
    });

    it('maps the listening modes: explore and familiar by name, the rest as scenes, each pool once', async () => {
        answer();
        const catalog = await qqRecommendations.getPersonalFmCatalog!(QQ_GUESS_YOU_LIKE_STATION);
        expect(catalog.modes.map(entry => entry.id)).toEqual(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD']);
        // Named after the radio, so the picker reads "Guess You Like mode".
        expect(catalog.name).toEqual({ labelKey: 'home.qqGuessYouLike', labelFallback: 'Guess You Like' });
        // Scenes on the rows their names belong to, and the suggestions not already offered on a row of their own.
        expect(catalog.scenes.map(entry => [entry.id, entry.labelFallback, entry.category])).toEqual([
            ['7111', '助眠', 'activity'], ['7112', 'R&B', 'genre'], ['7113', '动感 DJ', 'qq-suggested'],
        ]);
        expect(catalog.categories.map(category => category.id)).toEqual(['activity', 'genre', 'qq-suggested']);
    });

    it('groups the scenes by name into mood, moment, genre and language rows, the unknown ones under other', async () => {
        answer({
            user_guess_you_like_modes: {
                ...MODES,
                primaryModes: [...MODES.primaryModes, mode('4', '音乐视频', '7104')],
                scenes: [
                    mode('21', '动感DJ', '7121'), mode('22', '宅家', '7122'), mode('23', 'R&B', '7123'), mode('24', '助眠', '7124'),
                    mode('25', '粤语', '7125'), mode('26', '深夜emo', '7126'), mode('27', '新歌', '7127'), mode('28', 'KPOP', '7128'),
                    mode('29', '放松', '7129'), mode('30', 'AI尝鲜', '7130'), mode('31', '经典再绎', '7131'),
                ],
                // Every suggestion is already offered above, so there is no suggestion row.
                recommended: [mode('22', '宅家', '7122'), mode('3', '熟悉', '7103')],
            },
        });
        const catalog = await qqRecommendations.getPersonalFmCatalog!(QQ_GUESS_YOU_LIKE_STATION);
        // Row by row, each row in the order QQ gave; the flat order is the order the picker walks.
        expect(catalog.scenes.map(entry => [entry.labelFallback, entry.category])).toEqual([
            ['深夜emo', 'mood'], ['放松', 'mood'],
            ['宅家', 'activity'], ['助眠', 'activity'],
            ['动感DJ', 'genre'], ['R&B', 'genre'], ['KPOP', 'genre'], ['AI尝鲜', 'genre'],
            ['粤语', 'language'],
            ['新歌', 'qq-other'], ['经典再绎', 'qq-other'], ['音乐视频', 'qq-other'],
        ]);
        expect(catalog.categories).toEqual([
            { id: 'mood', labelKey: 'personalFmMode.category.mood', labelFallback: 'Mood' },
            { id: 'activity', labelKey: 'personalFmMode.category.activity', labelFallback: 'Moment' },
            { id: 'genre', labelKey: 'personalFmMode.category.genre', labelFallback: 'Genre' },
            { id: 'language', labelKey: 'personalFmMode.category.language', labelFallback: 'Language' },
            { id: 'qq-other', labelKey: 'home.qqGuessYouLikeOther', labelFallback: 'Other' },
        ]);
    });

    it('falls back to the default mode alone when the catalogue cannot be read, and reads it again later', async () => {
        answer({ user_guess_you_like_modes: new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502) });
        const catalog = await qqRecommendations.getPersonalFmCatalog!(QQ_GUESS_YOU_LIKE_STATION);
        expect(catalog.modes.map(entry => entry.id)).toEqual(['DEFAULT']);
        expect(catalog.name?.labelKey).toBe('home.qqGuessYouLike');
        // A mode chosen before still plays: the default batch, not nothing.
        const batch = await qqRecommendations.getPersonalFm!(station({ mode: 'FAMILIAR' }));
        expect(batch.map(entry => entry.qqMid)).toEqual(['default']);
        answer();
        expect((await qqRecommendations.getPersonalFmCatalog!(QQ_GUESS_YOU_LIKE_STATION)).modes).toHaveLength(4);
    });

    it('reads a batch by the pool of the chosen mode, and the default batch for the default mode', async () => {
        answer();
        expect((await qqRecommendations.getPersonalFm!(station())).map(entry => entry.qqMid)).toEqual(['default']);
        expect((await qqRecommendations.getPersonalFm!(station({ mode: 'EXPLORE' }))).map(entry => entry.qqMid)).toEqual(['pool7101']);
        expect((await qqRecommendations.getPersonalFm!(station({ mode: 'SCENE_RCMD', submode: '7112' }))).map(entry => entry.qqMid)).toEqual(['pool7112']);
        expect(requestMock.mock.calls.filter(call => call[0] === 'user_guess_you_like_tracks').map(call => call[1])).toEqual([{ pool: '7101' }, { pool: '7112' }]);
    });

    it('reads the default batch on a backend without the mode route', async () => {
        answer({ user_guess_you_like_tracks: new OnlineProviderError('unsupported', 'QQMusicApi has no user_guess_you_like_tracks route', 'qq', undefined, 404) });
        expect((await qqRecommendations.getPersonalFm!(station({ mode: 'SCENE_RCMD', submode: '7112' }))).map(entry => entry.qqMid)).toEqual(['default']);
    });

    it.each([
        ['the pool request fails', new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502)],
        ['the pool gives no songs', new OnlineProviderError('network', 'QQMusicApi failed: HTTP 422', 'qq', undefined, 422)],
    ])('plays the default batch for a scene chosen before when %s, with the catalogue unreadable too', async (_what, failure) => {
        answer({
            user_guess_you_like_modes: new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502),
            user_guess_you_like_tracks: failure,
        });
        const batch = await qqRecommendations.getPersonalFm!(station({ mode: 'SCENE_RCMD', submode: '7112' }));
        expect(batch.map(entry => entry.qqMid)).toEqual(['default']);
    });

    it('leaves the Personal FM as it was: no modes, its own route', async () => {
        answer();
        expect(await qqRecommendations.getPersonalFmCatalog!()).toBe(DEFAULT_PERSONAL_FM_CATALOG);
        expect((await qqRecommendations.getPersonalFm!({ mode: 'EXPLORE', submode: null })).map(entry => entry.qqMid)).toEqual(['fm']);
        await expect(qqRecommendations.getPersonalFmCatalog!('another-station')).rejects.toThrow('no such station');
    });
});
