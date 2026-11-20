'use strict';

// Serialized into the Apple page: recheck edit permission, then append the songs once. A catalog song goes in
// by its catalog id; an upload, which has no catalog song, goes in as the library song it is (`i.` id).
async function addPlaylistTracks(call, params) {
    const failure = result => {
        const status = Number(result?.status);
        return { ok: false, error: status === 401 ? 'auth-required' : 'upstream-error', httpStatus: Number.isInteger(status) ? status : null };
    };
    const succeeded = result => Number.isInteger(result?.status) && result.status >= 200 && result.status < 300
        && !result?.data?.errors?.length && !result?.errors?.length;
    try {
        const path = 'v1/me/library/playlists/' + encodeURIComponent(params.playlistId);
        const detail = await call(path, { extend: 'tags' });
        if (!succeeded(detail)) return failure(detail);
        const playlist = detail?.data?.data?.find(item => item.id === params.playlistId && item.type === 'library-playlists');
        if (!playlist) return { ok: false, error: 'invalid-response' };
        if (playlist.attributes?.canEdit !== true || playlist.attributes?.tags?.includes('favorited')) {
            return { ok: false, error: 'unsupported' };
        }
        const result = await call(path + '/tracks', { representation: 'resources' }, {
            fetchOptions: { method: 'POST', body: JSON.stringify({ data: params.catalogIds.map(id => ({ id, type: id.startsWith('i.') ? 'library-songs' : 'songs' })) }) },
        });
        if (!succeeded(result)) return failure(result);
        return { ok: true, data: {} };
    } catch (error) {
        // Never retry an append automatically: the server may already have accepted it. MusicKit may throw
        // Apple's refusal rather than return it: one that carries a status is a refusal, not a lost request.
        const status = [error?.status, error?.response?.status, error?.data?.status].find(value => typeof value === 'number');
        if (Number.isInteger(status)) return failure({ status });
        return { ok: false, error: 'request-failed' };
    }
}

module.exports = { addPlaylistTracks };
