// mods/visualizer52hz/client.mjs
// 52Hz: a PixiJS lyric animation. The current line appears whole and lights
// up character by character, and rings spread outward along the outline of its
// glyphs, one on every beat, thicker and brighter where the music was loud, so
// the screen fills with a tree-ring record of the song. Songs without lyrics
// grow their rings from random piths (see stage.mjs).
//
// What it exercises in Folium: a visualizer with a settings schema, the audio
// analyser (ctx.audio), lyric-clock-driven rendering on the host's frame loop
// (ctx.onFrame) that also works in previews and the export window, and a
// third-party library shipped inside
// the mod (vendor/pixi.min.mjs), since mod clients cannot resolve bare imports,
// and a Ponder tutorial through the experimental `ponder.targets` (ponder.mjs).

import { mount52Hz } from './stage.mjs';
import { ponderTarget } from './ponder.mjs';

const settings = [
  {
    key: 'reach',
    type: 'number',
    label: { 'zh-CN': '扩散速度', en: 'Spread speed' },
    description: { 'zh-CN': '波纹向外传播的速度；无论快慢，抵达屏幕边缘时都已淡出', en: 'How fast rings travel outward; at any speed they have faded out by the screen edge' },
    min: 0.4,
    max: 2,
    step: 0.05,
    defaultValue: 1,
  },
  {
    key: 'beatSensitivity',
    type: 'number',
    label: { 'zh-CN': '节拍灵敏度', en: 'Beat sensitivity' },
    description: { 'zh-CN': '年轮在节拍上产生；越大越容易判定为节拍，年轮越密', en: 'Rings are born on beats; higher detects more beats, so rings come closer together' },
    min: 0.4,
    max: 2.5,
    step: 0.05,
    defaultValue: 1,
  },
  {
    key: 'sensitivity',
    type: 'number',
    label: { 'zh-CN': '响度灵敏度', en: 'Loudness sensitivity' },
    description: { 'zh-CN': '响度决定年轮的粗细和亮度', en: 'Loudness sets how thick and bright a ring is' },
    min: 0.2,
    max: 3,
    step: 0.05,
    defaultValue: 1,
  },
  {
    key: 'opacity',
    type: 'number',
    label: { 'zh-CN': '波纹不透明度', en: 'Ring opacity' },
    min: 0.1,
    max: 1,
    step: 0.05,
    defaultValue: 0.8,
  },
  {
    key: 'fontScale',
    type: 'number',
    label: { 'zh-CN': '字号', en: 'Text size' },
    min: 0.6,
    max: 1.6,
    step: 0.05,
    defaultValue: 1,
  },
];

export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'rings',
    label: { 'zh-CN': '52Hz', en: '52Hz' },
    order: 430,
    mount: (container, ctx) => mount52Hz(folium, container, ctx),
    settings,
  });
  // Ponder is main-window only.
  if (folium.env.context === 'main') {
    folium.experimental['ponder.targets'].register(ponderTarget);
  }
}
