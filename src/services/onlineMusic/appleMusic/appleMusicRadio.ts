import type { SongResult, UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { normalizeAppleMusicSong } from './appleMusicNormalize';
import { requestAppleMusic } from './appleMusicTransport';

// Live station cards use one external item each; their changing broadcasts are never timed songs.
const STATION_ID = /^ra\.[a-zA-Z0-9._-]{1,196}$/;
interface Station {
    id: string;
    type: 'stations';
    attributes: { name?: string; isLive?: boolean; artwork?: { url?: string }; playParams?: { id?: string } };
}
function stationsOf(value: unknown): Station[] {
    const page = value as { items?: Station[] } | null;
    if (!Array.isArray(page?.items) || page.items.length > 20 || page.items.some(row => !row || row.type !== 'stations' || !STATION_ID.test(row.id) || !row.attributes)) {
        throw new OnlineProviderError('invalid-response', 'Apple Music station response is invalid', 'appleMusic');
    }
    return page.items;
}
export function appleMusicLiveStationId(song: SongResult): string | null {
    const source = song.sourceRef;
    const id = source?.kind === 'online' && source.providerId === 'appleMusic' && source.providerData?.resourceType === 'stations' ? source.mediaId : '';
    return STATION_ID.test(id) ? id : null;
}
function stationSong(station: Station): UnifiedSong {
    const song = normalizeAppleMusicSong({ ...station, type: 'songs', attributes: { ...station.attributes, durationInMillis: 0 } });
    return { ...song, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: station.id,
        providerData: { resourceType: 'stations', isLive: true } } };
}
export async function getAppleMusicLiveStations(): Promise<ProviderCollection[]> {
    const stations = stationsOf(await requestAppleMusic('stations')).filter(row => row.attributes.isLive === true);
    return stations.map(row => ({ providerId: 'appleMusic', id: row.id, type: 'radio', name: row.attributes.name || row.id,
        coverUrl: row.attributes.artwork?.url?.replaceAll('{w}', '512').replaceAll('{h}', '512'), trackCount: 1,
        providerData: { resourceType: 'stations', isLive: true } }));
}
export async function getAppleMusicLiveStationTracks(id: string, offset: number): Promise<ProviderPage<UnifiedSong>> {
    if (!STATION_ID.test(id)) throw new OnlineProviderError('unsupported', 'Apple Music station identity is invalid', 'appleMusic');
    if (offset > 0) return { items: [], hasMore: false, nextOffset: offset, total: 1 };
    const rows = stationsOf(await requestAppleMusic('station', { stationId: id }));
    const station = rows.find(row => row.id === id && row.attributes.isLive === true);
    if (!station) throw new OnlineProviderError('unavailable', 'Apple Music live station is unavailable', 'appleMusic');
    return { items: [stationSong(station)], hasMore: false, nextOffset: 1, total: 1 };
}
