// mods/k3panel/index.cjs
// K3Panel: a declarative Sonnet deep-tuning surface. Every param declares
// `modulate: { mode: 'sonnet' }`, which the renderer treats as a live
// renderer-side knob writing straight into the shared modulation store
// (src/mods/visualizerModulation.ts) — no main-process round-trip, so the
// Pixi scene updates on the very next frame while you drag. The run handler is
// a stub: modulate params never reach it.

'use strict';

// Maps a modulation key to its slider metadata. min/max are multipliers; 1 is
// the identity (no change), so defaults keep the builtin Sonnet look intact.
const KNOBS = [
    { key: 'cameraScale', zh: '相机幅度', en: 'Camera intensity' },
    { key: 'motionScale', zh: '逐字入场幅度', en: 'Glyph motion' },
    { key: 'breathScale', zh: '呼吸浮动', en: 'Breath float' },
    { key: 'parallaxScale', zh: '3D 视差', en: 'Parallax depth' },
    { key: 'mgSwimScale', zh: '动图漂移', en: 'MG drift' },
    { key: 'driftScale', zh: '间隙漂移', en: 'Gap drift' },
    { key: 'caScale', zh: '色差强度', en: 'Chromatic aberration' },
    { key: 'ghostScale', zh: '残影扩散', en: 'Echo ghost' },
    { key: 'transitionMotionScale', zh: '转场位移/缩放', en: 'Transition motion' },
    { key: 'transitionBlurScale', zh: '转场模糊', en: 'Transition blur' },
    { key: 'transitionGlitchScale', zh: '转场故障', en: 'Transition glitch' },
];

module.exports = function activate(api) {
    api.log.info('k3panel loaded (renderer modulation: sonnet)');

    api.commands.register({
        id: 'k3panel-tune-sonnet',
        label: { 'zh-CN': '商籁深度精调', en: 'Sonnet deep tuning' },
        description: {
            'zh-CN': '精细调整商籁动画的相机、逐字运动、视差与转场等原版设置未暴露的参数，拖动实时生效。',
            en: 'Fine-tune Sonnet camera, per-glyph motion, parallax and transitions not exposed by the builtin settings. Live.',
        },
        permissions: [],
        params: KNOBS.map((knob) => ({
            key: knob.key,
            label: { 'zh-CN': knob.zh, en: knob.en },
            type: 'number',
            min: 0,
            max: 3,
            step: 0.01,
            defaultValue: 1,
            modulate: { mode: 'sonnet' },
        })),
        run: async () => ({ ok: true }),
    });
};