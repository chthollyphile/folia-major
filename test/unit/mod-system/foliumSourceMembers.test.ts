// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { OnlineMusicProvider } from '@/types/onlineMusic';
import { FOLIUM_SOURCE_MEMBER_DESTINATIONS } from '@/mods/folium/registries/sourceMembers';
import { buildFoliumSourceProvider, readFoliumSourceParts } from '@/mods/folium/registries/sources';
import { createFoliumSourceTextBook } from '@/mods/folium/registries/sourceText';
import { FOLIUM_SOURCE_CAPABILITY_MEMBERS, FOLIUM_SOURCE_CAPABILITY_VERSIONS } from '@/mods/folium/sources/capabilities';
import type { FoliumSourceCapabilities, FoliumSourceDef } from '@/mods/folium/sources/contract';
import { parseContract } from '../../../dev/folium/api-docs.mjs';

// test/unit/mod-system/foliumSourceMembers.test.ts
// Gate 4 of Folium 2.0 S3: every member of the host's internal provider contract (src/types/onlineMusic.ts) has a
// place for a Folium 2.0 source (registries/sourceMembers.ts), the place is in the public contract, and the
// adapter really gives the member when a source implements everything. A member added to the internal contract
// without a place in the table fails the first case (and the type check of the table).

const ROOT = path.resolve(__dirname, '../../..');
type Parsed = { title: string; items: Array<{ name: string; members?: Array<{ name: string }> }> }[];
const internal = (parseContract(fs.readFileSync(path.join(ROOT, 'src/types/onlineMusic.ts'), 'utf8')) as Parsed).flatMap((section) => section.items);
const publicItems = (parseContract(fs.readFileSync(path.join(ROOT, 'src/mods/folium/sources/contract.ts'), 'utf8')) as Parsed).flatMap((section) => section.items);
const membersOf = (items: typeof internal, name: string) => items.find((item) => item.name === name)?.members?.map((member) => member.name) ?? null;

// The public interface of each standard capability, by its id.
const CAPABILITY_INTERFACES: Record<string, string> = {
    search: 'FoliumSourceSearch',
    songs: 'FoliumSourceSongs',
    'playback.audio': 'FoliumSourceAudioPlayback',
    'playback.external': 'FoliumSourceExternalPlayback',
    'playback.surface': 'FoliumSourceSurfacePlayback',
    reports: 'FoliumSourceReports',
    lyrics: 'FoliumSourceLyrics',
    auth: 'FoliumSourceAuth',
    library: 'FoliumSourceLibrary',
    catalog: 'FoliumSourceCatalog',
    recommendations: 'FoliumSourceRecommendations',
    explore: 'FoliumSourceExplore',
    mutations: 'FoliumSourceMutations',
    covers: 'FoliumSourceCovers',
    raw: 'FoliumSourceRaw',
};

// The value a source would give for a member that is not a method.
const VALUES: Record<string, unknown> = {
    access: 'anonymous',
    metadataMatch: true,
    songsPerRequest: 10,
    counterpartSources: ['other'],
    audioQualityLevels: ['standard', 'high'],
    audioQualityNotice: 'set elsewhere',
    previewNotice: 'a clip',
    crossSource: { linesOnly: false },
    prefersOwnWordByWord: true,
    showsKeptAccountAtStart: true,
    localService: { subscribe: () => () => {}, getStatus: () => ({ failed: false, error: null, restarting: false }), restart: async () => true },
    personalFmModes: true,
    preferenceEntries: ['explore'],
    backend: { name: 'x', version: '1' },
    reservedParams: [],
    credentialFields: [],
};

/* A source that implements every member of every capability this host implements. */
const everything = (): FoliumSourceDef => {
    const capabilities: Record<string, unknown> = {};
    for (const [id, versions] of Object.entries(FOLIUM_SOURCE_CAPABILITY_VERSIONS)) {
        if (versions.length === 0) continue;
        capabilities[`${id}@1`] = Object.fromEntries(FOLIUM_SOURCE_CAPABILITY_MEMBERS[id as keyof typeof FOLIUM_SOURCE_CAPABILITY_MEMBERS]
            .map((member) => [member, member in VALUES ? VALUES[member] : () => null]));
    }
    return {
        id: 'all',
        displayName: 'All',
        shortName: 'All',
        mark: { letter: 'A', color: '#000' },
        getAvailability: () => ({ configured: true }),
        describeFailure: () => null,
        capabilities: capabilities as FoliumSourceCapabilities,
        itemKinds: { video: { lyrics: 'none', likable: false, reported: false } },
        routeOf: () => 'surface',
    };
};

describe('songs@1 counterparts through the adapter', () => {
    const build = (songs: Record<string, unknown>) => {
        // Not a spread: a getter among the members has to stay a getter.
        const def = { ...everything(), capabilities: { 'songs@1': Object.assign(songs, { getSong: async () => null }) } as FoliumSourceCapabilities };
        const parts = readFoliumSourceParts('mod-a', def.capabilities, () => {});
        return buildFoliumSourceProvider(
            { modId: 'mod-a', hostId: 'folium.mod-a.all', text: createFoliumSourceTextBook('mod-a', 'folium.mod-a.all'), tells: new Set() },
            def,
            parts,
        ) as OnlineMusicProvider;
    };
    const query = { sourceId: 'other', id: '1', title: 'T', artists: ['A'] };

    it('reads the declared sources each time, and has neither member without getCounterparts', () => {
        let declared: unknown = ['other', 3, ''];
        const provider = build({ get counterpartSources() { return declared; }, getCounterparts: async () => [] });
        expect(provider.playback?.counterpartSources).toEqual(['other']);
        declared = ['other', 'more'];
        expect(provider.playback?.counterpartSources).toEqual(['other', 'more']);
        declared = 'nope';
        expect(provider.playback?.counterpartSources).toBeUndefined();

        const without = build({ counterpartSources: ['other'] });
        expect(without.playback?.getCounterparts).toBeUndefined();
        expect(without.playback?.counterpartSources).toBeUndefined();
    });

    it('hands the source copies, and reads its answer as its own songs, one for each song asked', async () => {
        const seen: unknown[] = [];
        const provider = build({
            counterpartSources: ['other'],
            getCounterparts: async (songs: Array<{ artists: string[] }>) => {
                seen.push(...songs);
                songs[0].artists.push('changed');
                return [{ id: 'x:1', title: 'T', artists: [{ id: '', name: 'A', ref: false }] }, 'junk', { id: 'x:3', title: 'extra', artists: [] }];
            },
        });
        const asked = [query, { ...query, id: '2' }];
        const answer = await provider.playback!.getCounterparts!(asked);
        expect(seen[0]).not.toBe(asked[0]);
        expect(asked[0].artists).toEqual(['A']);
        expect(answer).toHaveLength(2);
        expect(answer[0]).toMatchObject({ id: 'x:1', name: 'T', sourceRef: { kind: 'online', providerId: 'folium.mod-a.all', mediaId: 'x:1' } });
        expect(answer[1]).toBeNull();
    });

    it('takes an answer that is not a list as none', async () => {
        const provider = build({ counterpartSources: ['other'], getCounterparts: async () => 'nope' });
        await expect(provider.playback!.getCounterparts!([query]).then(found => found.every(song => song === null))).resolves.toBe(true);
    });
});

describe('every member of the internal contract has a place for a Folium 2.0 source', () => {
    it('the table places exactly the members the internal contract has', () => {
        let count = 0;
        for (const [name, destinations] of Object.entries(FOLIUM_SOURCE_MEMBER_DESTINATIONS)) {
            const members = membersOf(internal, name);
            expect(members, name).not.toBeNull();
            expect(Object.keys(destinations).sort(), name).toEqual([...members!].sort());
            count += members!.length;
        }
        // The member matrix's count (dev/folium/folium-2-member-matrix.md §1): 13 + 13 + 111 + 3 + 25, and the three
        // the host took in S6 for playback.surface after the matrix was made (routeOf, itemKinds, externalPlayback.mount).
        // And the two of songs@1 that name a counterpart of another source's song (counterpartSources, getCounterparts),
        // and the words in place of the quality pick list (audioQualityNoticeKey, playback.audio@1.audioQualityNotice).
        expect(count).toBe(165 + 3 + 2 + 1);
        // No sub-interface of the provider is left out of the table.
        const slots = Object.entries(FOLIUM_SOURCE_MEMBER_DESTINATIONS.OnlineMusicProvider)
            .filter(([slot, destination]) => slot !== 'capabilities' && (destination.startsWith('derived from') || destination === 'dto'))
            .map(([slot]) => slot);
        expect(slots.length).toBe(13);
    });

    it('each place is in the public contract', () => {
        const def = membersOf(publicItems, 'FoliumSourceDef')!;
        for (const [name, destinations] of Object.entries(FOLIUM_SOURCE_MEMBER_DESTINATIONS)) {
            for (const [member, destination] of Object.entries(destinations)) {
                const where = `${name}.${member} -> ${destination}`;
                const capability = /^([a-z][a-z.]*)@(\d+)\.(\w+)$/.exec(destination) ?? /: ([a-z][a-z.]*)@(\d+)\.(\w+)/.exec(destination);
                if (capability) {
                    const [, id, , target] = capability;
                    expect(Object.hasOwn(CAPABILITY_INTERFACES, id), where).toBe(true);
                    const publicMembers = membersOf(publicItems, CAPABILITY_INTERFACES[id]);
                    expect(publicMembers, where).toContain(target);
                    expect(FOLIUM_SOURCE_CAPABILITY_MEMBERS[id as keyof typeof FOLIUM_SOURCE_CAPABILITY_MEMBERS], where).toContain(target);
                } else if (destination.startsWith('field ')) {
                    expect(def, where).toContain(destination.slice('field '.length));
                } else {
                    expect(destination, where).toMatch(/^(derived|handle\.notify|dto|adapter|none)\b/);
                }
            }
        }
        // handle.notify is on the handle the contract gives back.
        expect(membersOf(publicItems, 'FoliumSourceHandle')).toContain('notify');
    });

    it('the members of the capability table are the members of each public interface', () => {
        for (const [id, interfaceName] of Object.entries(CAPABILITY_INTERFACES)) {
            const publicMembers = membersOf(publicItems, interfaceName)!;
            const own = id === 'playback.surface'
                ? [...membersOf(publicItems, 'FoliumSourceExternalPlayback')!, ...publicMembers]
                : publicMembers;
            expect([...FOLIUM_SOURCE_CAPABILITY_MEMBERS[id as keyof typeof FOLIUM_SOURCE_CAPABILITY_MEMBERS]].sort(), id).toEqual([...own].sort());
        }
    });

    it('the adapter gives every placed member when a source implements everything', () => {
        const def = everything();
        const warnings: string[] = [];
        const parts = readFoliumSourceParts('mod-a', def.capabilities, (message) => warnings.push(message));
        expect(warnings).toEqual([]);
        const provider = buildFoliumSourceProvider(
            { modId: 'mod-a', hostId: 'folium.mod-a.all', text: createFoliumSourceTextBook('mod-a', 'folium.mod-a.all'), tells: new Set() },
            def,
            parts,
        ) as OnlineMusicProvider & Record<string, unknown>;
        const objectOf: Record<string, unknown> = {
            OnlineMusicProvider: provider,
            OnlineSearchProvider: provider.search,
            OnlinePlaybackProvider: provider.playback,
            OnlineExternalPlaybackProvider: provider.externalPlayback,
            OnlinePlaybackReportProvider: provider.playbackReports,
            OnlineLyricsProvider: provider.lyrics,
            OnlineAuthProvider: provider.auth,
            LoginLocalService: provider.auth?.localService,
            OnlineLibraryProvider: provider.library,
            OnlineCatalogProvider: provider.catalog,
            OnlineRecommendationProvider: provider.recommendations,
            OnlineExploreProvider: provider.explore,
            OnlineMutationProvider: provider.mutations,
            OnlineRawRequestProvider: provider.raw,
            ProviderCapabilities: provider.capabilities,
        };
        for (const [name, destinations] of Object.entries(FOLIUM_SOURCE_MEMBER_DESTINATIONS)) {
            if (name === 'OnlineSongMetadataProvider') continue;
            const object = objectOf[name] as Record<string, unknown> | undefined;
            expect(object, name).toBeDefined();
            for (const [member, destination] of Object.entries(destinations)) {
                const placed = !destination.startsWith('none') && destination !== 'dto';
                expect(member in object!, `${name}.${member}`).toBe(placed);
            }
        }
        // The DTO stands for songMetadata: the host's reader falls back to the song's own fields.
        expect('songMetadata' in provider).toBe(false);
        // Every flag it derives is true for a source that has everything; personalFmModes is written out.
        expect(Object.values(provider.capabilities).every(Boolean)).toBe(true);
    });
});
