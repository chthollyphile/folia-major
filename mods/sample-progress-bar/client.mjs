// mods/sample-progress-bar/client.mjs
// Folium acceptance demo 1: change the progress bar purely from a mod.
//
//   - a bookmark button in the `progress.trailing` slot: saves the current
//     position for the current song (folium.storage);
//   - a stylesheet for the public progress parts: thicker track, gradient fill,
//     a visible square thumb (toggle in settings);
//   - a layer over the track: markers fetched from an external URL every few
//     seconds (folium.net.fetch), plus the bookmarks; clicking one seeks there.
//
// Settings (URL, refresh interval, style toggle) are a settings section on the
// settings page (Lab → mod system). The marker feed is JSON:
//   [{ "time": 42.5, "label": "Chorus", "color": "#f59e0b" }, ...]
// or { "markers": [...] }. `{songId}`, `{title}` and `{artist}` in the URL are
// replaced with the current song, so one endpoint can serve per-song data.
// All three progress bars in the app (floating controls ×2, Lattice) pick the
// extensions up, because they all render the same host ProgressBar.

const STYLE_CSS = `
[data-folium-part="progress.track"] {
  height: 8px;
  border-radius: 3px;
}
[data-folium-part="progress.fill"] {
  background: linear-gradient(90deg, #8b5cf6, #06b6d4 55%, #22c55e);
}
[data-folium-part="progress.thumb"] {
  opacity: 1;
  width: 10px;
  height: 16px;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.35);
}
`;

const BOOKMARK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

// Shared state for every progress bar instance: markers from the feed and bookmarks.
const createState = () => {
  const listeners = new Set();
  const state = { feed: [], bookmarks: [], error: null };
  return {
    get: () => state,
    set: (patch) => {
      Object.assign(state, patch);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const normalizeFeed = (payload) => {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.markers) ? payload.markers : [];
  return list
    .filter((item) => item && Number.isFinite(Number(item.time)))
    .map((item) => ({
      time: Number(item.time),
      label: typeof item.label === 'string' ? item.label : '',
      color: typeof item.color === 'string' ? item.color : '#f59e0b',
    }));
};

export default function activate(folium) {
  const shared = createState();

  const settings = folium.registries.settingsSections.register({
    id: 'progress-extras',
    label: { 'zh-CN': '进度条增强', en: 'Progress bar extras' },
    description: { 'zh-CN': '标记数据源、刷新间隔与样式。', en: 'Marker feed, refresh interval and style.' },
    settings: [
      {
        key: 'feedUrl',
        type: 'text',
        label: { 'zh-CN': '标记数据 URL', en: 'Marker feed URL' },
        description: { 'zh-CN': '返回 JSON 标记数组；可用 {songId} {title} {artist} 占位。', en: 'Returns a JSON marker array; {songId} {title} {artist} are substituted.' },
        placeholder: 'http://127.0.0.1:8787/markers?song={songId}',
        defaultValue: '',
      },
      {
        key: 'refreshSec',
        type: 'number',
        label: { 'zh-CN': '刷新间隔（秒）', en: 'Refresh interval (s)' },
        min: 2,
        max: 120,
        defaultValue: 5,
      },
      {
        key: 'styleEnabled',
        type: 'boolean',
        label: { 'zh-CN': '启用进度条样式', en: 'Restyle the progress bar' },
        defaultValue: true,
      },
    ],
  });

  // ---- storage: bookmarks per song
  const bookmarkKey = () => {
    const song = folium.playback.getState().song;
    return song ? `bookmarks:${song.source ?? 'x'}:${song.id ?? song.title}` : null;
  };
  const loadBookmarks = async () => {
    const key = bookmarkKey();
    const saved = key ? await folium.storage.get(key) : null;
    shared.set({ bookmarks: Array.isArray(saved) ? saved.filter(Number.isFinite) : [] });
  };
  const addBookmark = async (seconds) => {
    const key = bookmarkKey();
    if (!key) return;
    const next = [...shared.get().bookmarks, seconds].sort((a, b) => a - b);
    shared.set({ bookmarks: next });
    await folium.storage.set(key, next);
    folium.ui.toast(`Bookmark ${formatTime(seconds)}`, { type: 'success', durationMs: 1500 });
  };

  // ---- external dynamic data
  let timer = null;
  let generation = 0;
  const resolveUrl = (template) => {
    const song = folium.playback.getState().song;
    return template
      .replaceAll('{songId}', encodeURIComponent(song?.id ?? ''))
      .replaceAll('{title}', encodeURIComponent(song?.title ?? ''))
      .replaceAll('{artist}', encodeURIComponent(song?.artist ?? ''));
  };
  const fetchFeed = async () => {
    const { feedUrl } = settings.params.get();
    if (!feedUrl) {
      shared.set({ feed: [], error: null });
      return;
    }
    const mine = ++generation;
    try {
      const response = await folium.net.fetch(resolveUrl(feedUrl), { timeoutMs: 8000 });
      if (mine !== generation) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      shared.set({ feed: normalizeFeed(response.json()), error: null });
    } catch (error) {
      if (mine !== generation) return;
      shared.set({ error: String(error?.message ?? error) });
      folium.log.warn('marker feed failed', error);
    }
  };
  const restartPolling = () => {
    if (timer !== null) clearInterval(timer);
    const { refreshSec } = settings.params.get();
    timer = setInterval(fetchFeed, Math.max(2, Number(refreshSec) || 5) * 1000);
    void fetchFeed();
  };

  // ---- styles, toggled by the setting
  let styleHandle = null;
  const syncStyle = () => {
    const enabled = Boolean(settings.params.get().styleEnabled);
    if (enabled && !styleHandle) {
      styleHandle = folium.registries.styles.register({ id: 'progress-look', css: STYLE_CSS });
    } else if (!enabled && styleHandle) {
      styleHandle.unregister();
      styleHandle = null;
    }
  };

  // ---- the button
  folium.registries.controlButtons.register({
    id: 'bookmark',
    slot: 'progress.trailing',
    mount(container, ctx) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = 'Bookmark this moment';
      button.innerHTML = BOOKMARK_ICON;
      button.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;opacity:0.7;';
      const paint = () => { button.style.color = ctx.getColors().text; };
      paint();
      button.addEventListener('mouseenter', () => { button.style.opacity = '1'; });
      button.addEventListener('mouseleave', () => { button.style.opacity = '0.7'; });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void addBookmark(ctx.currentTime.get());
      });
      container.appendChild(button);
      const off = ctx.subscribe(paint);
      return () => {
        off();
        button.remove();
      };
    },
  });

  // ---- the layer over the track
  folium.registries.progressLayers.register({
    id: 'markers',
    mount(container, ctx) {
      const root = document.createElement('div');
      root.style.cssText = 'position:absolute;inset:0;';
      container.appendChild(root);

      const tick = (seconds, color, title, shape) => {
        const element = document.createElement('div');
        const size = shape === 'dot' ? 8 : 3;
        element.title = title;
        element.style.cssText = [
          'position:absolute',
          `left:${(ctx.timeToRatio(seconds) * 100).toFixed(3)}%`,
          `top:50%`,
          `width:${size}px`,
          `height:${shape === 'dot' ? 8 : 14}px`,
          `margin-left:${-size / 2}px`,
          `margin-top:${shape === 'dot' ? -4 : -7}px`,
          `border-radius:${shape === 'dot' ? '50%' : '1px'}`,
          `background:${color}`,
          'box-shadow:0 0 0 1px rgba(0,0,0,0.35)',
          // Only the markers take clicks; the rest of the track keeps seeking normally.
          'pointer-events:auto',
          'cursor:pointer',
        ].join(';');
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          ctx.seek(seconds);
        });
        return element;
      };

      const render = () => {
        const { feed, bookmarks } = shared.get();
        root.replaceChildren();
        if (!(ctx.getDuration() > 0)) return;
        feed.forEach((marker) => root.appendChild(
          tick(marker.time, marker.color, `${formatTime(marker.time)} ${marker.label}`.trim(), 'bar'),
        ));
        bookmarks.forEach((seconds) => root.appendChild(
          tick(seconds, '#ffffff', `Bookmark ${formatTime(seconds)}`, 'dot'),
        ));
      };

      render();
      const offShared = shared.subscribe(render);
      const offCtx = ctx.subscribe(render);
      return () => {
        offShared();
        offCtx();
        root.remove();
      };
    },
  });

  // ---- wiring
  const offSettings = settings.params.subscribe(() => {
    syncStyle();
    restartPolling();
  });
  const offSong = folium.events.on('playback.songChanged', () => {
    void loadBookmarks();
    void fetchFeed();
  });
  syncStyle();
  restartPolling();
  void loadBookmarks();

  return () => {
    offSettings();
    offSong();
    if (timer !== null) clearInterval(timer);
    generation += 1;
  };
}
