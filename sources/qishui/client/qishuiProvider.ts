import type { FoliumSourceDef, FoliumSourceLoginState, FoliumSourcePage, FoliumText } from '@folia/folium';
import { getQishuiLastFailure, qishuiRefusalOf, requestQishui } from './qishuiTransport';
import { normalizeQishuiCollection, normalizeQishuiUser } from './qishuiNormalize';
import { createQishuiCatalog } from './qishuiCatalog';
import { toQishuiLyrics } from './qishuiLyrics';
import { clearQishuiExplore, createQishuiExplore } from './qishuiExplore';
import { clearQishuiRecommendations, createQishuiRecommendations } from './qishuiRecommendations';
import { qishuiMutations } from './qishuiMutations';
import { clearQishuiPlayback, createQishuiAudio, qishuiSongs, readQishuiSongs } from './qishuiPlayback';
import { describeQishuiFailure } from './qishuiFailure';

// sources/qishui/client/qishuiProvider.ts
// 汽水音源的定义（folium.sources.register 收的那份）：每个能力族一组成员，形状是公开契约的。宿主的开关由实现了
// 哪些能力推导（适配层 parts.ts），和迁之前手写的开关表一致：没有专辑，有歌手、歌单、推荐、探索、私人 FM 模式。
// 模组只在桌面版的主窗口里跑（模组系统的桥只有 Electron 有），所以没有迁之前「网页版没有桥」的那一支。

/** What the definition needs of the host besides the transport: the mod's own texts, as keys and written out now. */
export interface QishuiSourceEnv {
    text(key: string): FoliumText;
    translate(key: string): string;
}

const isNetworkError = (error: unknown) => (error as { code?: unknown } | null)?.code === 'network';

// What belongs to one sign-in: the explore stream's memory, the scene catalogue and the playability checks.
// Dropped together whenever the account changes: confirmed, signed out, or the sign-in ran out.
function clearAccountState() { clearQishuiExplore(); clearQishuiRecommendations(); clearQishuiPlayback(); }

/** The source of the manifest's `sources[0]` (id `qishui`). */
export const createQishuiSource = (env: QishuiSourceEnv): FoliumSourceDef => {
    const { catalog, library } = createQishuiCatalog(env);
    return {
        id: 'qishui',
        // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
        displayName: '汽水音乐',
        shortName: env.text('name.short'),
        mark: { letter: '汽', color: '#19a58c' },
        describeFailure: describeQishuiFailure,
        capabilities: {
            // Searching needs no account, but the federated search lists a source with sign-in only once signed in,
            // as it did the built-in provider (crossSource.ts: a platform with auth and no declaration).
            'search@1': {
                access: 'account',
                async searchSongs(query, limit, offset) {
                    if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset };
                    const page = await requestQishui<FoliumSourcePage<unknown>>('search', { query, limit, offset });
                    return { ...page, items: await readQishuiSongs(page.items) };
                },
                // 车机接口搜得到歌单（search_playlists，条目是 search 结果里的 playlist 实体，与 user_playlists 同一种），
                // 没有专辑。读不出 id 的条目跳过，不让一条坏数据拖垮整页。
                async searchPlaylists(query, limit, offset) {
                    if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset };
                    const page = await requestQishui<FoliumSourcePage<unknown>>('search_playlists', { query, limit, offset });
                    const items = page.items.flatMap(item => {
                        try { return [normalizeQishuiCollection(item)]; } catch (error) {
                            console.warn('[QishuiProvider] Skipped a searched playlist without an id', error);
                            return [];
                        }
                    });
                    return { ...page, items };
                },
            },
            'songs@1': qishuiSongs,
            'playback.audio@1': createQishuiAudio(env.text('previewNotice')),
            'lyrics@1': {
                // A lyric source of other songs too (the match windows, the automatic pick), under its full name.
                crossSource: { name: env.text('name.lyrics') },
                getLyrics: async song => toQishuiLyrics(await requestQishui('lyrics', { id: song.id })),
                // Track ids are 1-30 digits, past what a number holds exactly: kept as text.
                songIdOf: id => (/^\d{1,30}$/.test(id) ? id : null),
            },
            'auth@1': {
                describeLoginFailure(_step, error) {
                    if (isNetworkError(error)) return { case: 'unreachable' };
                    const refusal = qishuiRefusalOf(error);
                    if (!refusal) return null;
                    return { ...(refusal.stage === 'account' ? { case: 'account-not-read' as const } : {}),
                        ...(refusal.upstreamCode ? { code: refusal.upstreamCode } : {}), ...(refusal.stage ? { mainCode: refusal.stage } : {}) };
                },
                async getLoginDiagnostics() {
                    const failure = getQishuiLastFailure();
                    return failure ? [{ label: 'failure',
                        value: `stage=${failure.stage ?? '-'} code=${failure.code} upstreamCode=${failure.upstreamCode ?? '-'}` }] : [];
                },
                getLoginTexts: () => ({ title: env.text('login.title'), note: env.text('login.note') }),
                signInRanOut: clearAccountState,
                async getLoginStatus() { const user = await requestQishui('login_status'); return user ? normalizeQishuiUser(user) : null; },
                async startLogin() { return (await requestQishui<{ key: string }>('login_qr_key')).key; },
                async createQr(key) { return (await requestQishui<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
                async checkLogin(key) {
                    try {
                        const result = await requestQishui<FoliumSourceLoginState>('login_qr_check', { key });
                        if (result.state === 'confirmed') clearAccountState();
                        return result;
                    } catch (error) {
                        if (isNetworkError(error)) return { state: 'error', transient: true, failure: { case: 'unreachable' } };
                        throw error;
                    }
                },
                async cancelLogin(key) { await requestQishui('login_qr_cancel', { key }); },
                getLoginTtlMs: () => 300000,
                async logout() { clearAccountState(); await requestQishui('logout'); },
            },
            'catalog@1': catalog,
            'library@1': library,
            'explore@1': createQishuiExplore(env.text('recommended')),
            'recommendations@1': createQishuiRecommendations(env),
            'mutations@1': qishuiMutations,
        },
    };
};
