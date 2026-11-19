// dev/folium/sample-video-source/index.cjs
// The main entry of the sample video source: it serves the clips in `media/` at
// folia-mod://sample-video-source/_media/clips/<file>, with Range (the host serves a `{ file }` answer so), which the
// client's <video> needs to seek. Only the three files there are served; nothing connects anywhere.

'use strict';

const path = require('path');

const CLIP_FILES = new Set(['clip-a.webm', 'clip-b.webm', 'clip-c.webm']);

/** @param {import('../../../mods/folium').FoliumSourceMainApi} api */
module.exports = function activate(api) {
    api.media.serve('clips', ({ path: requested }) => {
        if (!CLIP_FILES.has(requested)) return null;
        return { file: path.join(__dirname, 'media', requested), contentType: 'video/webm' };
    });
    api.log.info('serving the sample clips');
};
