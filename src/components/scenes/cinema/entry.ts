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
        description: { 'zh-CN': '一座老影院：封面和歌词放在荧幕上，暂停是中场休息。', en: 'An old picture house: the cover and the lyrics on the screen, a pause is an intermission.', in: 'Bioskop tua: sampul dan lirik di layar, jeda adalah waktu istirahat.' },
        order: 10,
        surfaces: [{ id: 'screen', aspect: 14 / 7.57, occludable: true, tone: 'dark' }],
        lyrics: { own: true, style: { surface: 'screen' } },
        background: { own: true, host: { surface: 'screen' } },
        subtitles: 'host',
        seats: 'anchors',
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
                label: { 'zh-CN': '开着厅里的灯', en: 'House lights on', in: 'Lampu ruangan menyala' },
                defaultValue: false,
            },
        ],
    },
    load: () => import('./cinemaRuntime').then(module => module.createCinemaRuntime),
});
