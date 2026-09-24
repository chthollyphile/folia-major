// mods/sample-transparent-mov-export/index.cjs
// Node half of the sample: the export itself. The command and its form live in
// client.mjs; it calls this handler over folium.rpc with the validated values.
//
// The spec only carries output choices. The host renders the song on screen
// with its live mode, tuning, lyrics, theme and Folium settings — the mod never
// hands host data back in, so it needs no runtime.playback permission.

'use strict';

module.exports = function activate(api) {
    api.log.info(`transparent-mov-export ${api.manifest.version} loaded (folium ${api.host.folium.major}.${api.host.folium.minor})`);

    api.rpc.handle('export', async (values) => {
        const result = await api.render.exportVideo({
            codec: values.codec === 'prores' ? 'prores' : 'vp9',
            width: Number(values.width),
            height: Number(values.height),
            fps: Number(values.fps),
            startSec: Number(values.startSec) || 0,
            // 0 leaves the end open; the export service falls back to the
            // end of the lyric timeline plus a short outro.
            endSec: Number(values.endSec) || 0,
            background: 'transparent',
        });
        if (!result.ok) {
            throw new Error(result.error || 'export-failed');
        }
        api.log.info('export finished', result.outputPath);
        return {
            outputPath: result.outputPath,
            frameCount: result.frameCount,
            warnings: result.warnings ?? [],
        };
    });
};
