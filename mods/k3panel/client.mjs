// mods/k3panel/client.mjs
// K3Panel: a declarative Sonnet deep-tuning surface. It registers one Folium
// tuning targeting the builtin "sonnet" mode; the host renders the sliders under
// Sonnet's settings card, persists the values, carries them into exports, and
// Sonnet reads them every frame through useFoliumTunings — no Node code at all.
//
// The keys are Sonnet's declared Folium tunables (see sonnet/entry.tsx). Each is
// a multiplier: 1 is the builtin look, so the defaults change nothing.

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

const CAMERA = { 'zh-CN': '相机与运动', en: 'Camera & motion' };
const TRANSITION = { 'zh-CN': '转场', en: 'Transitions' };

export default function activate(folium) {
  folium.registries.tunings.register({
    id: 'sonnet-deep-tuning',
    target: 'sonnet',
    label: { 'zh-CN': '商籁深度精调（K3Panel）', en: 'Sonnet deep tuning (K3Panel)' },
    params: KNOBS.map((knob) => ({
      key: knob.key,
      type: 'number',
      label: { 'zh-CN': knob.zh, en: knob.en },
      group: knob.key.startsWith('transition') ? TRANSITION : CAMERA,
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: 1,
    })),
  });
}
