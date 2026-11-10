// mods/more-progress-buttons/client.mjs
// More buttons beside the host progress bar (Folium 1.3):
//
//   - left (`progress.leading`): shuffle the play queue;
//   - right (`progress.trailing`): open the volume panel, like the displayed song.
//
// Each button can be switched off in settings. The buttons take room from the
// track, so by default the mod widens the floating capsule by exactly what its
// visible buttons use, through the public `--folium-player-bar-extra` variable.

// Mirrors the host slot layout: a button box, the gap between buttons in a
// slot, and the gap between a slot and the time label.
const BUTTON_PX = 22;
const BUTTON_GAP_PX = 4;
const SLOT_GAP_PX = 12;

const BUTTONS = [
  { id: 'shuffle', slot: 'progress.leading', setting: 'showShuffle', icon: 'shuffle', title: { zh: '打乱队列', en: 'Shuffle queue' } },
  { id: 'volume', slot: 'progress.trailing', order: 510, setting: 'showVolume', icon: 'volume-2', title: { zh: '音量', en: 'Volume' } },
  { id: 'like', slot: 'progress.trailing', order: 520, setting: 'showLike', icon: 'heart', title: { zh: '喜爱', en: 'Like' } },
];

const isChinese = () => /^zh/i.test(document.documentElement.lang || navigator.language || '');
const text = (label) => (isChinese() ? label.zh : label.en);

/* Width the visible buttons take from the track, per the host slot layout. */
const extraWidth = (visible) => {
  const perSlot = new Map();
  visible.forEach((button) => perSlot.set(button.slot, (perSlot.get(button.slot) ?? 0) + 1));
  let total = 0;
  perSlot.forEach((count) => {
    total += count * BUTTON_PX + (count - 1) * BUTTON_GAP_PX + SLOT_GAP_PX;
  });
  return total;
};

export default function activate(folium) {
  if (folium.env.context !== 'main') return undefined;
  if ((folium.host.folium.minor ?? 0) < 3) {
    folium.log.warn('more-progress-buttons needs Folium 1.3 or later');
    return undefined;
  }

  const settings = folium.registries.settingsSections.register({
    id: 'buttons',
    label: { 'zh-CN': '更多进度条按钮', en: 'More progress bar buttons' },
    description: { 'zh-CN': '选择显示哪些按钮。', en: 'Choose which buttons to show.' },
    settings: [
      { key: 'showShuffle', type: 'boolean', label: { 'zh-CN': '左侧：打乱队列', en: 'Left: shuffle queue' }, defaultValue: true },
      { key: 'showVolume', type: 'boolean', label: { 'zh-CN': '右侧：音量', en: 'Right: volume' }, defaultValue: true },
      { key: 'showLike', type: 'boolean', label: { 'zh-CN': '右侧：喜爱', en: 'Right: like' }, defaultValue: true },
      {
        key: 'stretchBar',
        type: 'boolean',
        label: { 'zh-CN': '拉长进度条', en: 'Lengthen the progress bar' },
        description: { 'zh-CN': '加宽悬浮胶囊，补回按钮占掉的进度条长度。', en: 'Widen the floating capsule to give the track back the room the buttons take.' },
        defaultValue: true,
      },
    ],
  });

  // ---- actions
  const actions = {
    shuffle: () => {
      // The host confirms a shuffle itself; only say why nothing happened.
      if (!folium.playback.shuffleQueue()) {
        folium.ui.toast(text({ zh: '当前队列无法打乱', en: 'This queue cannot be shuffled' }), { type: 'info', durationMs: 1500 });
      }
    },
    volume: () => folium.ui.openVolume(),
    like: () => { folium.playback.toggleLike(); },
  };

  // ---- one button, drawn into a slot container
  const mountButton = (def) => (container, ctx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = text(def.title);
    button.setAttribute('aria-label', button.title);
    button.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;'
      + `width:${BUTTON_PX}px;height:${BUTTON_PX}px;border-radius:6px;opacity:0.7;transition:opacity 120ms;`;
    let icon = null;
    let hovered = false;
    let disposed = false;

    const paint = () => {
      button.style.color = ctx.getColors().text;
      if (def.id !== 'like') {
        button.style.opacity = hovered ? '1' : '0.7';
        return;
      }
      const { liked, canLike } = folium.playback.getState();
      button.style.cursor = canLike ? 'pointer' : 'not-allowed';
      button.style.opacity = !canLike ? '0.3' : hovered || liked ? '1' : '0.7';
      if (icon) icon.setAttribute('fill', liked ? 'currentColor' : 'none');
    };

    void folium.ui.icon(def.icon, { size: 15 }).then((svg) => {
      if (disposed || !svg) return;
      icon = svg;
      button.appendChild(svg);
      paint();
    });
    button.addEventListener('mouseenter', () => { hovered = true; paint(); });
    button.addEventListener('mouseleave', () => { hovered = false; paint(); });
    button.addEventListener('click', () => actions[def.id]());
    container.appendChild(button);

    const offColors = ctx.subscribe(paint);
    const offEvents = def.id === 'like'
      ? ['playback.likeChanged', 'playback.songChanged', 'playback.stateChanged'].map((type) => folium.events.on(type, paint))
      : [];
    paint();
    return () => {
      disposed = true;
      offColors();
      offEvents.forEach((off) => off());
      button.remove();
    };
  };

  // ---- register what the settings ask for
  const handles = new Map();
  let widthHandle = null;
  const sync = () => {
    const params = settings.params.get();
    const visible = BUTTONS.filter((def) => params[def.setting] !== false);
    BUTTONS.forEach((def) => {
      const want = visible.includes(def);
      if (want && !handles.has(def.id)) {
        handles.set(def.id, folium.registries.controlButtons.register({
          id: def.id,
          slot: def.slot,
          order: def.order,
          mount: mountButton(def),
        }));
      } else if (!want && handles.has(def.id)) {
        handles.get(def.id).unregister();
        handles.delete(def.id);
      }
    });

    widthHandle?.unregister();
    widthHandle = null;
    const extra = params.stretchBar !== false ? extraWidth(visible) : 0;
    if (extra > 0) {
      widthHandle = folium.registries.styles.register({ id: 'stretch', css: `:root { --folium-player-bar-extra: ${extra}px; }` });
    }
  };

  const offSettings = settings.params.subscribe(sync);
  sync();
  return () => offSettings();
}
