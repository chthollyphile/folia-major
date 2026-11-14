import type { SongResult, UnifiedSong } from '@/types';
import type { JsonValue, OnlineMusicProvider, OnlineRawRequestProvider, ProviderAvailability, ProviderRawEndpoint } from '@/types/onlineMusic';
import type { FoliumSourceDef, FoliumSourceRaw } from '../../sources/contract';
import { isFoliumSourceSong, toHostSong, toSourceSong } from '../sourceDtos';
import { createSourceAdapterKit, lastOf, record, type SourceAdapterContext, type SourceAdapterKit } from './kit';
import { deriveFoliumSourceCapabilities, type FoliumSourceParts } from './parts';
import { buildExternal, buildPlayback, buildReports, buildSearch } from './playback';
import { buildLyrics } from './lyrics';
import { buildAuth } from './auth';
import { buildLibrary, buildMutations } from './library';
import { buildCatalog, buildExplore } from './catalog';
import { buildRecommendations } from './recommendations';

// src/mods/folium/registries/sourceAdapter/provider.ts
// The host's internal provider (src/types/onlineMusic.ts) of one Folium 2.0 source, from its definition read into
// parts (parts.ts). Where each internal member comes from is registries/sourceMembers.ts:
//   - the registration fields are the provider's own: the names through the source's text book (a key per text,
//     sourceText.ts), `getAvailability`, `describeFailure`; `watch` only collects who listens, for `handle.notify`;
//   - the capability flags are derived (parts.ts); `songMetadata` is not given, the host reads the song's own
//     DTO-made fields (getProviderSongMetadata falls back to them); `normalizeSong` takes a DTO or a song of this
//     source;
//   - each capability is its internal sub-object, built in this folder's files, member for member.
// Sync members the host calls on its hot paths are made once (kit.sync), and nothing in them allocates once the
// host object's DTO and the source's answer are known (sourceDtos.ts, kit.lastOf).

const buildRaw = (kit: SourceAdapterKit, raw: FoliumSourceRaw): OnlineRawRequestProvider => {
    const checkParams = raw.checkParams?.bind(raw);
    const describeEndpoint = raw.describeEndpoint.bind(raw);
    const built = {
        describeEndpoint: kit.sync('describeEndpoint', (endpoint: string): ProviderRawEndpoint | null => describeEndpoint(endpoint), () => null),
        ...(checkParams ? {
            checkParams: kit.sync('checkParams', (endpoint: string, params: Record<string, JsonValue>) => checkParams(endpoint, params), () => 'invalid-params'),
        } : {}),
        request: (endpoint: string, params: Record<string, JsonValue>, signal: AbortSignal) => kit.run('request', () => raw.request(endpoint, params, signal)),
    };
    // Read where the host reads them; a getter of the source's answers now.
    Object.defineProperties(built, {
        backend: { enumerable: true, get: () => raw.backend },
        reservedParams: { enumerable: true, get: () => raw.reservedParams },
        credentialFields: { enumerable: true, get: () => raw.credentialFields },
    });
    return built as unknown as OnlineRawRequestProvider;
};

const availabilityOf = (kit: SourceAdapterKit) => lastOf((value: unknown): ProviderAvailability => {
    const answer = record(value);
    return {
        configured: answer?.configured !== false,
        ...(answer?.reason === 'not-configured' || answer?.reason === 'runtime-unavailable' ? { reason: answer.reason } : {}),
        ...(answer?.message !== undefined ? { messageKey: kit.key(answer.message, 'availability.message') } : {}),
    };
});

/** The provider of a source: `def` read into `parts` (readFoliumSourceParts). */
export const buildFoliumSourceProvider = (
    context: SourceAdapterContext,
    def: FoliumSourceDef,
    parts: FoliumSourceParts,
): OnlineMusicProvider => {
    const kit = createSourceAdapterKit(context);
    const { hostId, text } = context;
    const shortName = def.shortName ?? def.displayName;
    const shortNameKey = text.key(shortName, 'shortName');
    const mark = record(def.mark);
    const getAvailability = def.getAvailability?.bind(def);
    const describeFailure = def.describeFailure?.bind(def);
    const getPageUrl = parts.songs?.getPageUrl?.bind(parts.songs);
    const availability = availabilityOf(kit);
    return {
        id: hostId,
        // In the UI language now, as the host's own names are.
        get displayName() {
            return text.now(def.displayName, 'displayName') || hostId;
        },
        get shortName() {
            return text.now(shortName, 'shortName') || hostId;
        },
        ...(shortNameKey ? { shortNameKey } : {}),
        ...(mark && typeof mark.letter === 'string' && typeof mark.color === 'string' ? { mark: { letter: mark.letter, color: mark.color } } : {}),
        ...(getAvailability ? { getAvailability: kit.sync('getAvailability', () => availability(getAvailability()), (): ProviderAvailability => ({ configured: true })) } : {}),
        watch: (tell) => {
            context.tells.add(tell);
            return () => {
                context.tells.delete(tell);
            };
        },
        ...(describeFailure ? {
            describeFailure: (operation, error) => {
                try {
                    return describeFailure(operation, error) ?? null;
                } catch (failure) {
                    console.warn(`[Folium] ${kit.label} describeFailure threw`, failure);
                    return null;
                }
            },
        } : {}),
        capabilities: deriveFoliumSourceCapabilities(parts),
        normalizeSong: (raw): UnifiedSong => {
            const candidate = record(raw);
            const ref = record(candidate?.sourceRef);
            if (ref?.kind === 'online' && ref.providerId === hostId) return raw as UnifiedSong;
            if (isFoliumSourceSong(raw)) return toHostSong(hostId, raw);
            throw new Error(`${hostId}: cannot normalize song`);
        },
        ...(getPageUrl ? { getSongPageUrl: kit.sync('getPageUrl', (song: SongResult) => getPageUrl(toSourceSong(song)), () => null) } : {}),
        ...(parts.search ? { search: buildSearch(kit, parts.search) } : {}),
        ...(parts.songs || parts.audio ? { playback: buildPlayback(kit, parts.songs, parts.audio) } : {}),
        ...(parts.external ? { externalPlayback: buildExternal(kit, parts.external) } : {}),
        ...(parts.reports ? { playbackReports: buildReports(kit, parts.reports) } : {}),
        ...(parts.lyrics ? { lyrics: buildLyrics(kit, parts.lyrics) } : {}),
        ...(parts.auth ? { auth: buildAuth(kit, parts.auth) } : {}),
        ...(parts.library ? { library: buildLibrary(kit, parts.library) } : {}),
        ...(parts.catalog ? { catalog: buildCatalog(kit, parts.catalog) } : {}),
        ...(parts.recommendations ? { recommendations: buildRecommendations(kit, parts.recommendations) } : {}),
        ...(parts.explore ? { explore: buildExplore(kit, parts.explore) } : {}),
        ...(parts.mutations ? { mutations: buildMutations(kit, parts.mutations) } : {}),
        ...(parts.raw ? { raw: buildRaw(kit, parts.raw) } : {}),
    };
};
