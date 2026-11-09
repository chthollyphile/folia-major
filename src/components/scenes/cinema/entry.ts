import { defineScene } from '../definition';

// src/components/scenes/cinema/entry.ts
// 影厅：第一个场景。清单在这里（纯数据）；画面的代码和 three.js 第一次显示时才加载（cinemaRuntime.ts）。
// 荧幕的宽高比是 cinemaLayout.ts 的 SCREEN（14 × 7.57）。

export default defineScene({
    manifest: {
        format: 1,
        engine: '^1.0',
        id: 'cinema',
        version: '1.0.0',
        name: { 'zh-CN': '影厅', en: 'Cinema', in: 'Bioskop' },
        description: { 'zh-CN': '老式影院，歌词和背景显示在荧幕上。', en: 'A classic cinema with your lyrics and background on the screen.', in: 'Bioskop klasik dengan lirik dan latar Anda di layar.' },
        order: 10,
        surfaces: [{ id: 'screen', aspect: 14 / 7.57, occludable: true }],
        lyrics: { style: { surface: 'screen' } },
        background: { host: { surface: 'screen' } },
        viewpoints: 'anchors',
        sound: { acoustics: 'mesh', music: 'speakers' },
        quality: {
            default: 'medium',
            presets: {
                low: { dpr: 1 },
                medium: { dpr: 1.25 },
                high: { dpr: 1.5 },
            },
        },
        settings: [
            {
                key: 'houseLights',
                type: 'boolean',
                label: { 'zh-CN': '开灯', en: 'House lights', in: 'Lampu ruangan' },
                defaultValue: false,
            },
            {
                key: 'curtainsOnPause',
                type: 'boolean',
                label: { 'zh-CN': '幕布', en: 'Curtains', in: 'Tirai' },
                defaultValue: true,
            },
        ],
    },
    load: () => import('./cinemaRuntime').then(module => module.createCinemaRuntime),
});
