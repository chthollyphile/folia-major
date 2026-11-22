import type { SongResult } from '../../types';
import type { ProviderItemKind, ProviderPlaybackRoute } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { canPlaySongExternally, getOnlineMusicProvider, playsSongOnSurface } from './providerRegistry';
import { getSourceState } from './sourceStates';

// src/services/onlineMusic/itemTraits.ts
// What the host does with one item of the queue (Folium 2 plan §4.4), asked in one place instead of in each
// feature: whether its lyrics are fetched and matched, whether it can be liked, whether its plays are reported,
// and which way it sounds (the host's audio, which the equalizer, automix and the audio cache work on, or a
// provider's player). An online item may be of a kind its source declares (`SongResult.itemKind`, the
// source's `itemKinds`); a song, any item that is not online, and a kind its source does not declare (the
// source is gone, or no longer has it) have a song's traits, and a trait a source leaves out is a song's too.

export type ItemLyrics = NonNullable<ProviderItemKind['lyrics']>;

/** What the host does with one item. */
export interface ItemTraits {
    /** `song`, or the kind its source declares. */
    readonly kind: string;
    /** `none`: no lyrics are fetched or matched; `own`: only its source's own, never matched from another; `match`: as a song's. */
    readonly lyrics: ItemLyrics;
    /** It can be liked (its source still has to be able to like at all: omni.canLikeSong). */
    readonly likable: boolean;
    /** A play of it is reported to its source (where its source reports at all: omni.canReportPlayback). */
    readonly reported: boolean;
    /**
     * Which way it sounds: `audio` through the host's own audio (equalizer, automix, the audio cache and the
     * spectrum work on it), `external` or `surface` in its provider's player (`surface` with a picture on the
     * player page), which none of those reach.
     */
    readonly route: ProviderPlaybackRoute;
}

const SONG_KIND = 'song';

const songTraits = (route: ProviderPlaybackRoute): ItemTraits => Object.freeze({ kind: SONG_KIND, lyrics: 'match', likable: true, reported: true, route });

const SONG_TRAITS: Readonly<Record<ProviderPlaybackRoute, ItemTraits>> = Object.freeze({
    audio: songTraits('audio'),
    external: songTraits('external'),
    surface: songTraits('surface'),
});

// The traits of a declared kind, one object a kind and route for as long as the provider keeps its table:
// rows ask while they are drawn.
const keptKinds = new WeakMap<ProviderItemKind, Map<string, ItemTraits>>();

const kindTraits = (kind: string, declared: ProviderItemKind, route: ProviderPlaybackRoute): ItemTraits => {
    let byRoute = keptKinds.get(declared);
    if (!byRoute) {
        byRoute = new Map();
        keptKinds.set(declared, byRoute);
    }
    const key = `${kind}\u0000${route}`;
    const known = byRoute.get(key);
    if (known) return known;
    const traits: ItemTraits = Object.freeze({
        kind,
        lyrics: declared.lyrics ?? 'match',
        likable: declared.likable ?? true,
        reported: declared.reported ?? true,
        route,
    });
    byRoute.set(key, traits);
    return traits;
};

/** The way `song` sounds now; a song of a source that is not shown has no player here, as omni.canPlayExternally says. */
const routeOf = (song: SongResult, providerId: string): ProviderPlaybackRoute => {
    if (getSourceState(providerId) !== 'enabled' || !canPlaySongExternally(song)) return 'audio';
    return playsSongOnSurface(song) ? 'surface' : 'external';
};

/** What the host does with `song`. Synchronous and cheap: queue rows and the transport ask it as they draw. */
export const itemTraits = (song: SongResult): ItemTraits => {
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online') return SONG_TRAITS.audio;
    const route = routeOf(song, source.providerId);
    const kind = typeof song.itemKind === 'string' && song.itemKind ? song.itemKind : SONG_KIND;
    if (kind === SONG_KIND) return SONG_TRAITS[route];
    const declared = getOnlineMusicProvider(source.providerId)?.itemKinds?.[kind];
    return declared ? kindTraits(kind, declared, route) : SONG_TRAITS[route];
};

/** `song` sounds through the host's own audio: the equalizer, automix and the audio cache can work on it. */
export const soundsInHost = (song: SongResult): boolean => itemTraits(song).route === 'audio';
