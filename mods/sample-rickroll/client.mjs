// mods/sample-rickroll/client.mjs
// Folium acceptance demo 2: an external page on the player page, purely from a mod.
//
// A `player.stage.front` layer (above the lyrics, below the player chrome) holds
// a small floating window with a YouTube embed created by folium.ui.embed. The
// layer itself is click-through; only the window takes the pointer, so the
// player stays usable around it. A command ("Rick Roll") shows or hides it.
//
// The embed only works because mod.json lists the origin in `embedOrigins` and
// declares `net.embed`; remove either and ui.embed throws, which the mods panel
// shows under this mod.

const VIDEO_URL = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0';

export default function activate(folium) {
  let visible = true;
  const listeners = new Set();
  const setVisible = (next) => {
    visible = next;
    listeners.forEach((listener) => listener());
  };

  folium.registries.stageLayers.register({
    id: 'video-window',
    slot: 'player.stage.front',
    mount(container) {
      const frame = document.createElement('div');
      frame.style.cssText = [
        'position:absolute', 'right:24px', 'bottom:120px',
        'width:min(40vw, 480px)', 'aspect-ratio:16 / 9',
        'border-radius:14px', 'overflow:hidden',
        'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
        'background:#000',
        // The layer is click-through; the window is not.
        'pointer-events:auto',
      ].join(';');
      container.appendChild(frame);

      let disposeEmbed = null;
      const sync = () => {
        frame.style.display = visible ? 'block' : 'none';
        if (visible && !disposeEmbed) {
          disposeEmbed = folium.ui.embed(frame, VIDEO_URL, { title: 'Never Gonna Give You Up' });
        } else if (!visible && disposeEmbed) {
          // Removing the iframe stops playback, unlike hiding it.
          disposeEmbed();
          disposeEmbed = null;
        }
      };
      sync();
      listeners.add(sync);
      return () => {
        listeners.delete(sync);
        disposeEmbed?.();
        frame.remove();
      };
    },
  });

  folium.registries.commands.register({
    id: 'toggle',
    label: { 'zh-CN': '开关外挂视频窗口', en: 'Rick Roll: toggle video window' },
    keywords: ['rickroll', 'rick roll', 'video', '视频'],
    run: () => {
      setVisible(!visible);
      folium.ui.toast(visible ? 'Video window on' : 'Video window off', { durationMs: 1200 });
    },
  });
}
