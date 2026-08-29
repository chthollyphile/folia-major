// mods/sample-aurora-visualizer/index.cjs
// Sample visualizer mod: the Node-side entry only logs activation; the actual
// animation lives in visualizer.mjs and runs in the renderer over
// folia-mod://. Commands are optional for pure visualizer mods.

'use strict';

module.exports = function activate(api) {
    api.log.info('sample-aurora-visualizer loaded (renderer contribution: aurora-text)');
};