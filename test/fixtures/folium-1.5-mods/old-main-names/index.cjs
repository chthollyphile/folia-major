// test/fixtures/folium-1.5-mods/old-main-names/index.cjs
// A main entry written the way Folium 1.5 allowed, with every main name Folium 2
// removes: api.storage.data, api.lifecycle.onDeactivate, api.experimental and
// an activate that returns { dispose }. Written for the deprecation tests; the
// in-repo samples used none of these.

'use strict';

module.exports = function activate(api) {
    api.rpc.handle('roundTrip', async (value) => {
        await api.storage.data.set('value', value);
        return api.storage.data.get('value');
    });
    api.rpc.handle('snapshot', () => api.runtime.getPlaybackSnapshot());
    api.lifecycle.onDeactivate(() => {
        globalThis.__oldMainNames.push('onDeactivate');
    });
    globalThis.__oldMainNames.push(`experimental:${Object.keys(api.experimental).length}`);
    return {
        dispose() {
            globalThis.__oldMainNames.push('dispose');
        },
    };
};
