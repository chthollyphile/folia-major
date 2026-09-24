// mods/sample-video-layer/client.mjs
// A muted video behind the lyrics (`player.stage.back`: above the background,
// under the lyrics), synced to what Folia is playing:
//   - play / pause follow playback.stateChanged;
//   - a seek in Folia (playback.seeked) seeks the video;
//   - a new song restarts it; slow drift is corrected every couple of seconds.
// The source is a local file picked through folium.ui.pickFile or the URL in
// the settings section. The pick is persisted (Folium 1.1): its grant id is
// kept in folium.storage and restored on the next start. Opacity and fit are
// settings.

const DRIFT_CHECK_MS = 2000;
const DRIFT_TOLERANCE_SEC = 0.35;
const GRANT_KEY = 'videoGrant';

export default function activate(folium) {
  let pickedUrl = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  // Folium 1.0 hosts have no restoreFile: the pick then lasts for the session only.
  const canPersist = typeof folium.ui.restoreFile === 'function';

  const forgetPick = async () => {
    const grantId = await folium.storage.get(GRANT_KEY);
    if (grantId) await folium.ui.releaseFile(grantId);
    await folium.storage.delete(GRANT_KEY);
    pickedUrl = null;
  };

  // The file picked in an earlier session, if it is still there.
  if (canPersist) {
    void (async () => {
      const grantId = await folium.storage.get(GRANT_KEY);
      if (!grantId) return;
      const file = await folium.ui.restoreFile(grantId);
      if (!file) {
        // The file is gone. Only clear the key if a newer pick has not replaced it meanwhile.
        if ((await folium.storage.get(GRANT_KEY)) === grantId) await folium.storage.delete(GRANT_KEY);
        return;
      }
      // A pick made while this was in flight wins.
      if (pickedUrl === null) {
        pickedUrl = file.url;
        notify();
      }
    })().catch(() => {});
  }

  const settings = folium.registries.settingsSections.register({
    id: 'video-layer',
    label: { 'zh-CN': '歌词后方视频层', en: 'Video behind lyrics' },
    settings: [
      { key: 'enabled', type: 'boolean', label: { 'zh-CN': '显示视频层', en: 'Show video layer' }, defaultValue: true },
      {
        key: 'videoUrl',
        type: 'text',
        label: { 'zh-CN': '视频 URL（未选本地文件时使用）', en: 'Video URL (used when no local file is picked)' },
        placeholder: 'https://example.com/loop.mp4',
        defaultValue: '',
      },
      { key: 'opacity', type: 'number', label: { 'zh-CN': '不透明度', en: 'Opacity' }, min: 0.1, max: 1, step: 0.05, defaultValue: 0.6 },
      {
        key: 'fit',
        type: 'select',
        label: { 'zh-CN': '填充方式', en: 'Fit' },
        options: [
          { value: 'cover', label: { 'zh-CN': '铺满（裁切）', en: 'Cover (crop)' } },
          { value: 'contain', label: { 'zh-CN': '完整显示', en: 'Contain' } },
        ],
        defaultValue: 'cover',
      },
    ],
  });

  folium.registries.commands.register({
    id: 'pick-video',
    label: { 'zh-CN': '视频层：选择本地视频', en: 'Video layer: pick a local video' },
    keywords: ['video', 'mv', '视频', '背景视频'],
    run: async () => {
      const file = await folium.ui.pickFile({ accept: 'video', persist: canPersist });
      if (!file) return 'cancelled';
      if (canPersist) {
        await forgetPick();
        await folium.storage.set(GRANT_KEY, file.grantId);
      }
      pickedUrl = file.url;
      settings.params.set({ enabled: true });
      notify();
      return file.name;
    },
  });

  folium.registries.commands.register({
    id: 'clear-video',
    label: { 'zh-CN': '视频层：清除本地视频', en: 'Video layer: clear the local video' },
    keywords: ['video', '视频', '清除'],
    run: async () => {
      if (canPersist) await forgetPick();
      pickedUrl = null;
      notify();
      return 'cleared';
    },
  });

  folium.registries.stageLayers.register({
    id: 'video',
    slot: 'player.stage.back',
    mount(container) {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      container.appendChild(video);

      const position = () => folium.playback.getState().position;
      const align = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        const target = position() % video.duration;
        if (Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SEC) video.currentTime = target;
      };
      const followState = () => {
        if (folium.playback.getState().state === 'playing') void video.play().catch(() => {});
        else video.pause();
      };
      const applySettings = () => {
        const values = settings.params.get();
        const source = pickedUrl ?? (values.videoUrl || null);
        video.style.opacity = String(values.opacity);
        video.style.objectFit = values.fit === 'contain' ? 'contain' : 'cover';
        video.style.display = values.enabled && source ? 'block' : 'none';
        if (source && video.dataset.source !== source) {
          video.dataset.source = source;
          video.src = source;
          video.addEventListener('loadedmetadata', () => { align(); followState(); }, { once: true });
        }
      };

      applySettings();
      listeners.add(applySettings);
      const offSettings = settings.params.subscribe(applySettings);
      const offState = folium.events.on('playback.stateChanged', followState);
      const offSeek = folium.events.on('playback.seeked', align);
      const offSong = folium.events.on('playback.songChanged', () => { video.currentTime = 0; });
      const drift = setInterval(align, DRIFT_CHECK_MS);

      return () => {
        clearInterval(drift);
        offSettings();
        offState();
        offSeek();
        offSong();
        listeners.delete(applySettings);
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };
    },
  });
}
