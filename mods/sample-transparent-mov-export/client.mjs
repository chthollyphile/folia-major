// mods/sample-transparent-mov-export/client.mjs
// Renderer half of the sample: registers the command (its params become the
// form in the mods panel) and forwards the validated values to the main entry,
// which owns the export (it needs Node: ffmpeg, a hidden window, files).

export default function activate(folium) {
  folium.registries.commands.register({
    id: 'export-transparent-mov',
    label: { 'zh-CN': '导出透明视频', en: 'Export transparent video' },
    description: {
      'zh-CN': '按当前歌曲的动画模式与参数原样渲染，仅去除背景，导出带 Alpha 通道的透明视频（需要 ffmpeg，仅桌面端，Windows 保留完整 Alpha 通道）。',
      en: 'Renders the current song with its live visualizer mode and tuning, drops the background, and exports a transparent video with alpha (requires ffmpeg; desktop only; full alpha on Windows).',
    },
    params: [
      {
        key: 'codec',
        label: { 'zh-CN': '编码格式', en: 'Codec' },
        description: {
          'zh-CN': 'VP9（默认）：文件小约 10 倍，WebM 容器，剪映/达芬奇较新版本可识别透明，若你的剪辑软件不吃 WebM 请换 ProRes。ProRes 4444：MOV，文件大但几乎全兼容。',
          en: 'VP9 (default): ~10x smaller WebM; newer CapCut/Resolve recognize alpha, else use ProRes. ProRes 4444: MOV, large but nearly universally compatible.',
        },
        type: 'select',
        options: [
          { value: 'vp9', label: { 'zh-CN': 'VP9（小文件 WebM）', en: 'VP9 (small WebM)' } },
          { value: 'prores', label: { 'zh-CN': 'ProRes 4444（兼容 MOV）', en: 'ProRes 4444 (compatible MOV)' } },
        ],
        defaultValue: 'vp9',
      },
      { key: 'width', label: { 'zh-CN': '宽度（像素）', en: 'Width (px)' }, type: 'number', min: 320, max: 3840, defaultValue: 1920 },
      { key: 'height', label: { 'zh-CN': '高度（像素）', en: 'Height (px)' }, type: 'number', min: 180, max: 2160, defaultValue: 1080 },
      { key: 'fps', label: { 'zh-CN': '帧率', en: 'Frame rate' }, type: 'number', min: 10, max: 60, defaultValue: 30 },
      {
        key: 'startSec',
        label: { 'zh-CN': '开始时间（秒）', en: 'Start time (sec)' },
        description: { 'zh-CN': '从歌曲的该时刻开始渲染。', en: 'Render from this song position.' },
        type: 'number',
        min: 0,
        max: 900,
        defaultValue: 0,
      },
      {
        key: 'endSec',
        label: { 'zh-CN': '结束时间（秒，0 = 歌词结束）', en: 'End time (sec, 0 = lyric end)' },
        description: { 'zh-CN': '0 表示自动渲染到歌词结束。', en: '0 renders until the lyrics finish.' },
        type: 'number',
        min: 0,
        max: 900,
        defaultValue: 0,
      },
    ],
    run: ({ values }) => folium.rpc.call('export', values),
  });
}
