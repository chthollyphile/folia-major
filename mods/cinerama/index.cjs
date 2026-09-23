// mods/cinerama/index.cjs
// Node-side entry. Cinerama is a pure renderer contribution: the animation lives
// in visualizer.mjs and runs over folia-mod:// in the renderer.
//
// 设置面板也由模组自带（settingsPanel.mjs 起 DOM、hostPanel.mjs 挂进宿主锚点），
// 渲染层交付物全在本目录内，不需要任何主进程/渲染端的模组专属接线。主进程这边只剩
// 激活时打一行版本日志。

'use strict';

module.exports = function activate(api) {
    /*
     * 版本进日志：和面板里看到的版本号对不上，就说明跑的是另一份安装副本。
     * 读 manifest 而不是写字面值——`api.manifest` 是冻结的 manifest 副本，
     * 写死的版本号会成为第二份真相（改一处必须记着改另一处）。
     */
    api.log.info(`cinerama ${api.manifest?.version ?? 'unknown'} loaded`
        + ' (renderer contribution: cinerama-screen, settings panel in the host slot)');
};
