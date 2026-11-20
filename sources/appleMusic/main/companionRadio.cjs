'use strict';

// Runs inside Apple's page: ask its personal station for a bounded batch without changing playback.
async function readPersonalStation(call, store) {
    const stations = await call('v1/catalog/' + encodeURIComponent(store) + '/stations', { 'filter[identity]': 'personal', limit: 1 });
    if (Number(stations?.status) >= 400 || stations?.data?.errors?.length) return stations;
    const rows = stations?.data?.data;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.type !== 'stations'
        || typeof rows[0]?.id !== 'string' || !/^ra\.[a-zA-Z0-9._-]{1,196}$/.test(rows[0].id)) {
        return { status: 502, data: { errors: [{}] } };
    }
    // The same fixed POST endpoint is used by Apple's MusicKit loadStationNextTracks.
    return call('v1/me/stations/next-tracks/' + encodeURIComponent(rows[0].id), { limit: 2 }, { fetchOptions: { method: 'POST' } });
}

module.exports = { readPersonalStation };
