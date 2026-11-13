// dev/folium/sample-source-full/index.cjs
// The main entry of the contract test source: it hands out the made-up session the client's sign-in ends with,
// over `folium.rpc`, and keeps it sealed with the system's credential store where there is one (`api.seal`, a
// source mod's member). Nothing here connects anywhere.

'use strict';

/** @param {import('../../../mods/folium').FoliumSourceMainApi} api */
module.exports = function activate(api) {
    let issued = 0;
    api.rpc.handle('session.issue', (nickname) => {
        issued += 1;
        const user = { id: 'fixture-user', nickname: typeof nickname === 'string' && nickname ? nickname : 'Fixture Listener' };
        // A source keeps its session sealed; this one only shows that it can.
        const sealed = api.seal.available() ? api.seal.seal(JSON.stringify(user)) : null;
        api.log.info(`session ${issued} issued${sealed ? ' (sealed)' : ''}`);
        return user;
    });
    api.onBeforeUnload(() => {
        api.log.info('unloading: nothing to hand back');
    });
};
