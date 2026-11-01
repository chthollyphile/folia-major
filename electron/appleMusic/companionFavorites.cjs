'use strict';

// Serialized into the signed-in Apple page; issue only favorite requests, never a library-song deletion.
async function updateFavorite(call, params) {
    try {
        const result = await call('v1/me/favorites', { 'ids[songs]': params.catalogId }, {
            fetchOptions: { method: params.liked ? 'POST' : 'DELETE' },
        });
        const status = Number(result?.status);
        if (!Number.isInteger(status) || status < 200 || status >= 300 || result?.data?.errors?.length || result?.errors?.length) {
            return { ok: false, error: status === 401 ? 'auth-required' : 'upstream-error', httpStatus: Number.isInteger(status) ? status : null };
        }
        return { ok: true, data: {} };
    } catch {
        return { ok: false, error: 'request-failed' };
    }
}

module.exports = { updateFavorite };
