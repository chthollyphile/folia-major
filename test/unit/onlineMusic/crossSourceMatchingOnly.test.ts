// @builtin-sources
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isParticipantReady,
    participantSkipReason,
    participants,
    resolveParticipants,
    type CrossSourceDeclaration,
    type CrossSourceState,
} from '@/services/onlineMusic/crossSource';
import { canSourceMatchOnly, getSourceState, setSourceStates, subscribeSourceStates } from '@/services/onlineMusic/sourceStates';
import { getSourceDeclaration } from '@/services/onlineMusic/sourceDeclarations';
import { isSourceEnabled, isSourceMatchingOnly } from '@/services/onlineMusic/sourceReadiness';
import { isSongSourceMissing } from '@/services/onlineMusic/songAvailability';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { resolveSearchSources } from '@/components/app/search/searchSources';
import { omni } from '@/services/onlineMusic/omni';
import type { SongResult } from '@/types';

// test/unit/onlineMusic/crossSourceMatchingOnly.test.ts
// Folium 2.0 S2 (dev/folium/folium-2-plan.md §5.3, §7.1): the source states in the window. A source is
// enabled, used only for matching, or disabled; no record reads as enabled. A source used only for matching
// takes part in the lyric and the metadata match when that needs no account (anonymously: its account is not
// read), and is left out of everything else as `matching-only`; for playback and the interface it counts as
// not enabled, and its songs show as having no source.

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({ searchQQLyrics: vi.fn(async () => []), fetchQQLyrics: vi.fn(async () => null) }));

afterEach(() => {
    setSourceStates({});
    useOnlineProviderAccountStore.setState({ accounts: {} });
});

const declaration = (overrides: Partial<CrossSourceDeclaration> = {}): CrossSourceDeclaration => ({
    sourceId: 'alpha', access: 'anonymous', checksAvailability: false, ...overrides,
});
const matchingOnly: CrossSourceState = { enabled: false, matchingOnly: true, availability: { configured: true }, signedIn: false };

describe('the two new rows of the table (pure)', () => {
    it('uses a matching-only source for the lyric and the metadata match when it needs no account', () => {
        expect(resolveParticipants([declaration()], () => matchingOnly, 'lyrics')).toEqual({ ready: ['alpha'], skipped: [] });
        expect(resolveParticipants([declaration()], () => matchingOnly, 'metadata')).toEqual({ ready: ['alpha'], skipped: [] });
    });

    it('skips it as matching-only for the federated search, and wherever the feature needs an account', () => {
        expect(resolveParticipants([declaration()], () => matchingOnly, 'search').skipped).toEqual([{ sourceId: 'alpha', reason: 'matching-only' }]);
        expect(resolveParticipants([declaration({ access: 'account' })], () => ({ ...matchingOnly, signedIn: true }), 'lyrics').skipped)
            .toEqual([{ sourceId: 'alpha', reason: 'matching-only' }]);
    });

    it('still says not-enabled for a source neither enabled nor matching-only', () => {
        expect(resolveParticipants([declaration()], () => ({ ...matchingOnly, matchingOnly: false }), 'lyrics').skipped)
            .toEqual([{ sourceId: 'alpha', reason: 'not-enabled' }]);
    });
});

describe('the source states table', () => {
    it('reads no record as enabled, keeps only the three states, and tells listeners of a real change', () => {
        const heard = vi.fn();
        const off = subscribeSourceStates(heard);
        expect(getSourceState('qq')).toBe('enabled');
        setSourceStates({ qq: 'matching', kugou: 'disabled', odd: 'off' });
        expect(getSourceState('qq')).toBe('matching');
        expect(getSourceState('kugou')).toBe('disabled');
        expect(getSourceState('odd')).toBe('enabled');
        setSourceStates({ qq: 'matching', kugou: 'disabled' });
        expect(heard).toHaveBeenCalledTimes(1);
        off();
    });

    it('lets the platforms that match anonymously be matching-only (the S2 reading of the lyric registry)', () => {
        expect(['netease', 'qq', 'kugou', 'qishui'].filter(canSourceMatchOnly)).toEqual(['netease', 'qq', 'kugou', 'qishui']);
        // 波点是注册着的音源模组（文件头的 @builtin-sources）：它不能只用于匹配，是它的声明说的，不是因为它不在。
        expect(getSourceDeclaration('bodian')).toBeDefined();
        expect(['spotify', 'appleMusic', 'ytm', 'bodian', 'fnmusic', 'amll'].filter(canSourceMatchOnly)).toEqual([]);
    });

    it('makes a matching-only or disabled registered platform not enabled, and its songs have no source', () => {
        const song = { id: 1, name: 's', sourceRef: { kind: 'online', providerId: 'qq', id: '1' } } as unknown as SongResult;
        expect(isSourceEnabled('qq')).toBe(true);
        expect(isSongSourceMissing(song)).toBe(false);
        setSourceStates({ qq: 'matching' });
        expect(isSourceEnabled('qq')).toBe(false);
        expect(isSourceMatchingOnly('qq')).toBe(true);
        expect(isSongSourceMissing(song)).toBe(true);
        setSourceStates({ qq: 'disabled' });
        expect(isSourceMatchingOnly('qq')).toBe(false);
        expect(isSongSourceMissing(song)).toBe(true);
    });
});

describe('the live features with QQ and NetEase only for matching', () => {
    it('keeps them in the lyric and the metadata match, anonymously, and out of the federated search', () => {
        setSourceStates({ qq: 'matching', netease: 'matching' });
        // A signed-in account there is not read.
        useOnlineProviderAccountStore.setState({ accounts: { qq: { status: 'authenticated', user: { id: 'u', nickname: 'n' } } } as never });
        expect(participants('metadata').ready).toEqual(['netease', 'qq', 'kugou']);
        expect(participants('lyrics').ready).toEqual(expect.arrayContaining(['netease', 'qq']));
        expect(participants('search').skipped).toEqual(expect.arrayContaining([
            { sourceId: 'netease', reason: 'matching-only' },
            { sourceId: 'qq', reason: 'matching-only' },
        ]));
        expect(isParticipantReady('search', 'qq')).toBe(false);
        expect(participantSkipReason('search', 'qq')).toBe('matching-only');
        expect(isParticipantReady('lyrics', 'qq')).toBe(true);
    });

    it('leaves a matching-only source out of the search page\'s other sources', () => {
        setSourceStates({ kugou: 'matching' });
        // The search page lists what omni lists for the interface (omni.getProviderSummaries), which leaves it out.
        const listed = new Set(omni.getProviderSummaries().map(provider => provider.providerId));
        expect(listed.has('kugou')).toBe(false);
        const sources = resolveSearchSources({
            providers: [
                { providerId: 'netease', requiresAccount: false, availability: { configured: true }, status: 'anonymous' },
                { providerId: 'kugou', requiresAccount: false, availability: { configured: true }, status: 'anonymous' },
                // Any other platform searched without an account. (It was Bodian until Bodian became a source mod in
                // Folium 2.0 S5: its search declares `access: 'account'`, as the built-in rule had it for a platform with sign-in.)
                { providerId: 'qishui', requiresAccount: false, availability: { configured: true }, status: 'anonymous' },
            ].filter(provider => listed.has(provider.providerId)) as never,
            activeProviderId: 'netease',
            hasLocalSongs: false,
            navidromeReady: false,
        });
        expect(sources).toContain('qishui');
        expect(sources).not.toContain('kugou');
    });
});
