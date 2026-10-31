import type { OnlineMusicProvider, ProviderPage, LoginState } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { requestQishui, getQishuiAvailability, getQishuiLastFailure, QishuiRequestError } from './qishuiTransport';
import { normalizeQishuiSong, normalizeQishuiUser, normalizeQishuiCollection } from './qishuiNormalize';
import { qishuiCatalog, qishuiLibrary } from './qishuiCatalog';
import { parseQishuiLyrics } from './qishuiLyrics';
import { diagnosticLine } from '../login/loginDiagnosticReport';
import { qishuiExplore, clearQishuiExplore } from './qishuiExplore';
import { qishuiRecommendations, clearQishuiRecommendations } from './qishuiRecommendations';
import { qishuiMutations, qishuiSongId as songId } from './qishuiMutations';
import { qishuiPlayback, clearQishuiPlayback, readQishuiSongs } from './qishuiPlayback';
import { describeQishuiFailure } from './qishuiFailure';

// Car platform adapter; account and catalogue operations share the existing Omni entry points.
// What belongs to one sign-in: the explore stream's memory, the scene catalogue and the playability checks.
// Dropped together whenever the account changes: confirmed, signed out, or the sign-in ran out.
function clearAccountState() { clearQishuiExplore(); clearQishuiRecommendations(); clearQishuiPlayback(); }
export const qishuiProvider: OnlineMusicProvider = {
    id: 'qishui', displayName: '汽水音乐', shortName: '汽水音乐', mark: { letter: '汽', color: '#000000', icon: 'qishui' },
    getAvailability: getQishuiAvailability,
    capabilities: { search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        userLibrary: true, playlists: true, albums: false, artists: true, recommendations: true,
        mutations: true, likes: true, playlistTrackMutations: true, explore: true, personalFmModes: true },
    normalizeSong: normalizeQishuiSong, normalizeUser: normalizeQishuiUser, normalizeCollection: normalizeQishuiCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    describeFailure: describeQishuiFailure,
    getSongPageUrl: song => `https://music.douyin.com/qishui/share/track?track_id=${encodeURIComponent(songId(song))}`,
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset };
            const page = await requestQishui<ProviderPage<unknown>>('search', { query, limit, offset });
            return { ...page, items: await readQishuiSongs(page.items) };
        },
    },
    playback: qishuiPlayback,
    lyrics: { getLyrics: async song => parseQishuiLyrics(await requestQishui('lyrics', { id: songId(song) })) },
    auth: {
        describeLoginFailure(_step, error) {
            if (error instanceof OnlineProviderError && error.code === 'network') return { case: 'unreachable' };
            if (!(error instanceof QishuiRequestError)) return null;
            return { ...(error.stage === 'account' ? { case: 'account-not-read' as const } : {}),
                ...(error.upstreamCode ? { code: error.upstreamCode } : {}), mainCode: error.stage || undefined };
        },
        async getLoginDiagnostics() {
            const failure = getQishuiLastFailure();
            return failure ? [diagnosticLine`stage=${failure.stage} code=${failure.code} upstreamCode=${failure.upstreamCode}`] : [];
        },
        getLoginTexts: () => ({ title: 'home.loginTitleQishui', note: 'home.loginNoteQishui' }),
        signInRanOut: clearAccountState,
        async getLoginStatus() { const user = await requestQishui('login_status'); return user ? normalizeQishuiUser(user) : null; },
        async startLogin() { return (await requestQishui<{ key: string }>('login_qr_key')).key; },
        async createQr(key) { return (await requestQishui<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
        async checkLogin(key) {
            try {
                const result = await requestQishui<LoginState>('login_qr_check', { key });
                if (result.state === 'confirmed') clearAccountState();
                return result;
            } catch (error) {
                if (error instanceof OnlineProviderError && error.code === 'network') return { state: 'error', transient: true, failure: { case: 'unreachable' } };
                throw error;
            }
        },
        async cancelLogin(key) { await requestQishui('login_qr_cancel', { key }); },
        getLoginTtlMs: () => 300000,
        async logout() { clearAccountState(); await requestQishui('logout'); },
    },
    catalog: qishuiCatalog, library: qishuiLibrary, explore: qishuiExplore,
    recommendations: qishuiRecommendations,
    mutations: qishuiMutations,
};
