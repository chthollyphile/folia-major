'use strict';

// Serialized into the signed-in Apple page; issue only favorite requests, never a library-song deletion.
// A catalog song is favorited by its catalog id. A song the user uploaded has only a library id (`i.`):
// it is favorited as a library song, and where Apple's favorites endpoint refuses that request's shape,
// its library rating is set to "love" instead (the older form of the same mark). Unliking an upload
// clears both, since either route may be the one that liked it.
async function updateFavorite(call, params) {
    // MusicKit answers a refused request either with its status or by throwing an error that carries it.
    const send = async (path, query, fetchOptions) => {
        try { return await call(path, query, { fetchOptions }); } catch (error) {
            const status = [error?.status, error?.response?.status, error?.data?.status].find(value => typeof value === 'number');
            return { status: Number.isInteger(status) ? status : null, thrown: true };
        }
    };
    const statusOf = result => (typeof result?.status === 'number' && Number.isInteger(result.status) ? result.status : null);
    const succeeded = result => {
        const status = statusOf(result);
        return status !== null && status >= 200 && status < 300 && !result?.data?.errors?.length && !result?.errors?.length;
    };
    const failure = (result, route) => {
        const status = statusOf(result);
        if (status === 401) return { ok: false, error: 'auth-required', httpStatus: 401, route };
        // A throw with no status is a request that never got an answer.
        if (status === null && result?.thrown) return { ok: false, error: 'request-failed', route };
        return { ok: false, error: 'upstream-error', httpStatus: status, route };
    };
    // Only Apple refusing the request itself sends an upload to its rating; a busy, failing or silent
    // server is reported as it is, so a failed unlike never reads as done.
    const refusedShape = result => [400, 403, 404, 405, 422].includes(statusOf(result));
    const library = params.catalogId.startsWith('i.');
    const favorite = await send('v1/me/favorites', { [library ? 'ids[library-songs]' : 'ids[songs]']: params.catalogId },
        { method: params.liked ? 'POST' : 'DELETE' });
    if (!library) return succeeded(favorite) ? { ok: true, data: { route: 'favorites' } } : failure(favorite, 'favorites');
    if (params.liked && succeeded(favorite)) return { ok: true, data: { route: 'favorites' } };
    if (!succeeded(favorite) && !refusedShape(favorite)) return failure(favorite, 'favorites');
    const ratingPath = 'v1/me/ratings/library-songs/' + encodeURIComponent(params.catalogId);
    const rating = await send(ratingPath, {}, params.liked
        ? { method: 'PUT', body: JSON.stringify({ type: 'rating', attributes: { value: 1 } }) }
        : { method: 'DELETE' });
    // Clearing a rating that was never set answers 404: the song is not loved, which is what was asked.
    if (succeeded(rating) || (!params.liked && statusOf(rating) === 404)) {
        return { ok: true, data: { route: succeeded(favorite) ? 'favorites' : 'rating' } };
    }
    return failure(rating, 'rating');
}

module.exports = { updateFavorite };
