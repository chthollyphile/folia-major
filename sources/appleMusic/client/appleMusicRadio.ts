import type { FoliumSourceCollection, FoliumSourcePage, FoliumSourceSong } from '@folia/folium';
import { normalizeAppleMusicSong } from './appleMusicNormalize';
import { appleMusicError, requestAppleMusic } from './appleMusicTransport';

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
        throw appleMusicError('invalid-response', 'Apple Music station response is invalid');
    }
    return page.items;
}
export function appleMusicLiveStationId(song: FoliumSourceSong): string | null {
    const id = song.data?.resourceType === 'stations' ? song.id : '';
    return STATION_ID.test(id) ? id : null;
}
function stationSong(station: Station): FoliumSourceSong {
    const song = normalizeAppleMusicSong({ ...station, type: 'songs', attributes: { ...station.attributes, durationInMillis: 0 } });
    return { ...song, id: station.id, data: { resourceType: 'stations', isLive: true } };
}
export async function getAppleMusicLiveStations(): Promise<FoliumSourceCollection[]> {
    const stations = stationsOf(await requestAppleMusic('stations')).filter(row => row.attributes.isLive === true);
    return stations.map(row => {
        const coverUrl = row.attributes.artwork?.url?.replaceAll('{w}', '512').replaceAll('{h}', '512');
        return { id: row.id, type: 'radio', name: row.attributes.name || row.id,
            ...(coverUrl ? { coverUrl } : {}), trackCount: 1,
            data: { resourceType: 'stations', isLive: true } };
    });
}
export async function getAppleMusicLiveStationTracks(id: string, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> {
    if (!STATION_ID.test(id)) throw appleMusicError('unsupported', 'Apple Music station identity is invalid');
    if (offset > 0) return { items: [], hasMore: false, nextOffset: offset, total: 1 };
    const rows = stationsOf(await requestAppleMusic('station', { stationId: id }));
    const station = rows.find(row => row.id === id && row.attributes.isLive === true);
    if (!station) throw appleMusicError('unavailable', 'Apple Music live station is unavailable');
    return { items: [stationSong(station)], hasMore: false, nextOffset: 1, total: 1 };
}
