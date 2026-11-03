// dev/folium/sample-equalizer-console/client.mjs
// Folium 1.7 sample: a settings section ("音效控制台" / "Equalizer console") that reads and writes the host's
// graphic equalizer through folium.equalizer, the stable service.
//
//   - The state: folium.equalizer.getState() (the mode, the switch, the ten gains, hostPlaysAudio,
//     writable), drawn again on every `equalizer.changed`, with the origin of the last one.
//   - Three writes: switch to Bass boost (setMode), put a smile curve in place (applyCurve), take it off
//     (releaseCurve). Each shows what the host answered, the refusal reason included.
//   - Following the songs: with "Apply a curve on every song" on, `playback.songChanged` puts a curve in
//     place for the new song. Once `equalizer.changed` comes from the user, a host command or another mod,
//     the switch turns itself off and says so: putting the curve back after that would override the user.
//     `host` changes (Stage, the audio effects window opening or closing, the curve held back) are nobody's.
//   - Writing later: a song's curve refused `panel-open` (the user is at the audio effects window) is kept
//     and written once `equalizer.changed` says `state.writable` again.
//
// Reading needs no permission; the three writes need equalizer.control, which mod.json declares.

// The smile curve of the button: lifted lows and highs, the middle a little down.
const SMILE = [4, 3, 1, 0, -1, -1, 0, 1, 3, 4];
// The curves "Apply a curve on every song" picks from, one per song.
const SONG_CURVES = [
  [3, 2, 1, 0, 0, 0, 0, 1, 2, 3],
  [-1, 0, 1, 2, 3, 3, 2, 1, 0, -1],
  [5, 4, 2, 0, -1, -1, 0, 0, 1, 2],
];

const TEXT = {
  zh: {
    stateTitle: '当前均衡器（getState）',
    mode: '模式',
    modes: {
      preset: (id) => `内置音效：${{ flat: '水平', lofi: 'Lo-Fi', radio: '收音机', hall: '大厅', vocal: '人声', bass: '低音增强' }[id] ?? id}`,
      custom: (id) => `用户的${id === 'custom1' ? '自定义 1' : id === 'custom2' ? '自定义 2' : id}`,
      mine: '本模组的曲线',
      mod: (modId) => `模组 ${modId} 的曲线`,
      unknown: (kind) => `用户选的（${kind}）`,
    },
    enabled: (on) => (on ? '总开关：开' : '总开关：关（增益保留但听不到）'),
    hostPlaysAudio: (on) => (on ? '声音经过宿主的音频' : '外部 Stage 播放中：均衡器现在没东西可作用'),
    writable: (on) => (on ? '可以写入' : '音频效果器开着：会改变东西的写入被拒（panel-open）'),
    origin: (text) => `最近一次 equalizer.changed 来自：${text}`,
    originNone: '还没收到 equalizer.changed。',
    origins: { user: '用户', command: '宿主命令', host: '宿主自己', mine: '本模组', mod: (modId) => `模组 ${modId}` },
    writesTitle: '写入（需 equalizer.control）',
    setBass: '切到低音增强',
    applySmile: '施加微笑曲线',
    release: '撤下',
    result: (text) => `结果：${text}`,
    ok: '已接受',
    released: (done) => (done ? '撤下了本模组的曲线' : '在位的不是本模组的曲线，什么都没变'),
    reasons: {
      stopped: '本模组已停止',
      'unknown-mode': '宿主没有这个音效',
      'panel-open': '音频效果器开着，用户正在调',
      'rate-limited': '写得太频繁，稍后再试',
    },
    autoTitle: '按歌自动施加',
    autoLabel: '每首歌换一条曲线',
    autoHint: '用户、宿主命令或别的模组改了音效时自动关掉；进出 Stage、开关音频效果器不算。',
    autoStopped: '你调过音效了，自动施加已停。',
    pending: '这首歌的曲线被拒 panel-open，等音频效果器关上再写。',
    unexpected: (message) => `出错了：${message}`,
  },
  en: {
    stateTitle: 'The equalizer now (getState)',
    mode: 'Mode',
    modes: {
      preset: (id) => `Built-in: ${{ flat: 'Level', lofi: 'Lo-Fi', radio: 'Radio', hall: 'Hall', vocal: 'Vocal', bass: 'Bass boost' }[id] ?? id}`,
      custom: (id) => `The user's ${id === 'custom1' ? 'Custom 1' : id === 'custom2' ? 'Custom 2' : id}`,
      mine: 'This mod\'s curve',
      mod: (modId) => `The curve of the mod ${modId}`,
      unknown: (kind) => `The user's choice (${kind})`,
    },
    enabled: (on) => (on ? 'Processing: on' : 'Processing: off (the gains are kept but not heard)'),
    hostPlaysAudio: (on) => (on ? 'The sound goes through the host\'s audio' : 'External Stage playback: the equalizer has nothing to act on now'),
    writable: (on) => (on ? 'Writable' : 'The audio effects window is open: a write that changes something is refused (panel-open)'),
    origin: (text) => `Last equalizer.changed came from: ${text}`,
    originNone: 'No equalizer.changed yet.',
    origins: { user: 'the user', command: 'a host command', host: 'the host itself', mine: 'this mod', mod: (modId) => `the mod ${modId}` },
    writesTitle: 'Writes (equalizer.control)',
    setBass: 'Switch to Bass boost',
    applySmile: 'Put the smile curve in place',
    release: 'Take it off',
    result: (text) => `Result: ${text}`,
    ok: 'accepted',
    released: (done) => (done ? 'this mod\'s curve came off' : 'the curve in place is not this mod\'s; nothing changed'),
    reasons: {
      stopped: 'this mod has stopped',
      'unknown-mode': 'the host has no such sound',
      'panel-open': 'the audio effects window is open: the user is at it',
      'rate-limited': 'too many writes; try again later',
    },
    autoTitle: 'Following the songs',
    autoLabel: 'Apply a curve on every song',
    autoHint: 'Turns itself off once the user, a host command or another mod changes the sound; Stage and the audio effects window opening or closing do not count.',
    autoStopped: 'You changed the sound, so the curves on every song have stopped.',
    pending: 'This song\'s curve was refused panel-open; it is written once the audio effects window closes.',
    unexpected: (message) => `Something went wrong: ${message}`,
  },
};

const STYLE = `
* { box-sizing: border-box; }
.console {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font: 13px/1.5 var(--folium-font, sans-serif);
  color: var(--folium-primary, currentColor);
}
.card {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
h3 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.8; }
.note { margin: 0; font-size: 12px; opacity: 0.65; }
.value { font-weight: 600; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bands { display: grid; gap: 4px; text-align: center; font-variant-numeric: tabular-nums; }
.bands span { font-size: 11px; opacity: 0.6; }
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
}
button:focus-visible, input:focus-visible { outline: 2px solid var(--folium-accent, currentColor); outline-offset: 2px; }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label, onClick) => {
  const node = el('button', '', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};

const signed = (gain) => (gain > 0 ? `+${gain}` : String(gain));
const frequencyLabel = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/* One curve per song, picked by its identity, so the same song gets the same curve every time. */
const curveFor = (song) => {
  const key = song ? `${song.source}:${song.id}` : '';
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return SONG_CURVES[hash % SONG_CURVES.length];
};

/*
 * What the section shows, kept for as long as the mod runs: the events arrive while the settings are
 * closed too. The listeners added through folium are removed by the host when the mod stops.
 */
const createConsole = (folium, section) => {
  const { equalizer } = folium;
  const state = {
    equalizer: equalizer.getState(),
    origin: null,
    // What the last write answered: { kind: 'ok' } | { kind: 'reason', reason } | { kind: 'released', done } | { kind: 'error', message }
    result: null,
    // A song's curve refused panel-open, to write once the window closes.
    pending: null,
    autoStopped: false,
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const autoApply = () => section.settings.get().autoApply === true;

  /* Runs one write and keeps what the host answered; a throw (a malformed argument) is shown too. */
  const write = (run) => {
    try {
      const answer = run();
      state.result = typeof answer === 'boolean'
        ? { kind: 'released', done: answer }
        : answer.ok ? { kind: 'ok' } : { kind: 'reason', reason: answer.reason };
      state.equalizer = equalizer.getState();
      notify();
      return answer;
    } catch (error) {
      state.result = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      folium.log.warn('a folium.equalizer write threw', String(error));
      notify();
      return null;
    }
  };

  const applySongCurve = (curve) => {
    const answer = write(() => equalizer.applyCurve(curve));
    // The user is at the audio effects window: try again once it says it is writable.
    state.pending = answer && !answer.ok && answer.reason === 'panel-open' ? curve : null;
    notify();
  };

  folium.events.on('equalizer.changed', ({ state: next, origin }) => {
    state.equalizer = next;
    state.origin = origin;
    // The host's own changes are nobody's choice, and this mod's own writes are not a reason to stop.
    const someoneElse = origin.kind !== 'host' && !(origin.kind === 'mod' && origin.modId === folium.modId);
    if (someoneElse && autoApply()) {
      state.autoStopped = true;
      state.pending = null;
      section.settings.set({ autoApply: false });
    }
    if (state.pending && next.writable && autoApply()) {
      const curve = state.pending;
      state.pending = null;
      applySongCurve(curve);
    }
    notify();
  });

  folium.events.on('playback.songChanged', ({ song }) => {
    if (autoApply()) applySongCurve(curveFor(song));
  });

  // Turning the switch on again is the user asking for the curves once more.
  section.settings.onChange(() => {
    if (autoApply()) state.autoStopped = false;
    else state.pending = null;
    notify();
  });

  return {
    state,
    setBass: () => write(() => equalizer.setMode({ kind: 'preset', id: 'bass' })),
    applySmile: () => write(() => equalizer.applyCurve(SMILE)),
    release: () => write(() => equalizer.releaseCurve()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => listeners.clear(),
  };
};

/* The section's own panel: the state, the three writes and the switch, drawn again on every change. */
const mountPanel = (folium, desk, container, ctx) => {
  const t = TEXT[ctx.locale.startsWith('zh') ? 'zh' : 'en'];

  const modeLine = el('p', 'value');
  const enabledLine = el('p', 'note');
  const bands = el('div', 'bands');
  const hostLine = el('p', 'note');
  const writableLine = el('p', 'note');
  const originLine = el('p', 'note');
  const stateCard = el('section', 'card');
  stateCard.append(el('h3', '', t.stateTitle), modeLine, enabledLine, bands, hostLine, writableLine, originLine);

  const resultLine = el('p', 'note');
  resultLine.setAttribute('role', 'status');
  const writeRow = el('div', 'row');
  writeRow.append(button(t.setBass, desk.setBass), button(t.applySmile, desk.applySmile), button(t.release, desk.release));
  const writeCard = el('section', 'card');
  writeCard.append(el('h3', '', t.writesTitle), writeRow, resultLine);

  const autoInput = el('input');
  autoInput.type = 'checkbox';
  autoInput.addEventListener('change', () => ctx.settings.set({ autoApply: autoInput.checked }));
  const autoLabel = el('label');
  autoLabel.append(autoInput, el('span', '', t.autoLabel));
  const autoNote = el('p', 'note');
  const autoCard = el('section', 'card');
  autoCard.append(el('h3', '', t.autoTitle), autoLabel, el('p', 'note', t.autoHint), autoNote);

  const modeText = (mode) => {
    if (mode.kind === 'preset') return t.modes.preset(mode.id);
    if (mode.kind === 'custom') return t.modes.custom(mode.id);
    if (mode.kind === 'mod') return mode.modId === folium.modId ? t.modes.mine : t.modes.mod(mode.modId);
    // A kind a later minor added is one the user chose.
    return t.modes.unknown(mode.kind);
  };
  const originText = (origin) => {
    if (origin.kind === 'mod') return origin.modId === folium.modId ? t.origins.mine : t.origins.mod(origin.modId);
    // A kind this mod does not know reads as the user.
    return t.origins[origin.kind] ?? t.origins.user;
  };
  const resultText = (result) => {
    if (result.kind === 'ok') return t.ok;
    if (result.kind === 'released') return t.released(result.done);
    if (result.kind === 'error') return t.unexpected(result.message);
    // A reason a later minor added reads as rate-limited: try again later.
    return `${result.reason}: ${t.reasons[result.reason] ?? t.reasons['rate-limited']}`;
  };

  const render = () => {
    const { state } = desk;
    const now = state.equalizer;
    modeLine.textContent = `${t.mode}: ${modeText(now.mode)}`;
    enabledLine.textContent = t.enabled(now.enabled);
    // One column a band, the gains over the frequencies: ten in Folium 1.7, as many as `bands` says.
    bands.style.gridTemplateColumns = `repeat(${now.bands.length}, minmax(0, 1fr))`;
    bands.replaceChildren(
      ...now.bands.map((_, index) => el('b', '', signed(now.gains[index] ?? 0))),
      ...now.bands.map((band) => el('span', '', frequencyLabel(band.frequency))),
    );
    hostLine.textContent = t.hostPlaysAudio(now.hostPlaysAudio);
    writableLine.textContent = t.writable(now.writable);
    originLine.textContent = state.origin ? t.origin(originText(state.origin)) : t.originNone;
    resultLine.textContent = state.result ? t.result(resultText(state.result)) : '';
    autoInput.checked = ctx.settings.get().autoApply === true;
    autoNote.textContent = state.autoStopped ? t.autoStopped : state.pending ? t.pending : '';
  };

  const root = el('div', 'console');
  root.append(stateCard, writeCard, autoCard);
  const style = el('style', '', STYLE);
  container.append(style, root);
  render();
  const unsubscribe = desk.subscribe(render);
  const offSettings = ctx.settings.onChange(render);
  return () => {
    unsubscribe();
    offSettings();
    root.remove();
    style.remove();
  };
};

export default function activate(folium) {
  // A Folium 1.6 host has no folium.equalizer (it reads as undefined): do nothing there.
  if (folium.host.folium.minor < 7) {
    folium.log.warn('sample-equalizer-console needs Folium 1.7 (folium.equalizer)');
    return undefined;
  }
  // In the export window every folium.equalizer method throws: nothing here applies there.
  if (folium.env.context !== 'main') return undefined;

  let desk = null;
  const section = folium.registries.settingsSections.register({
    id: 'console',
    label: { 'zh-CN': '音效控制台', en: 'Equalizer console' },
    description: {
      'zh-CN': '读宿主的均衡器，切换你的音效，或换上这个模组自己的曲线。',
      en: 'Reads the host\'s equalizer, switches your sound, or puts this mod\'s own curve in place.',
    },
    settings: [
      {
        key: 'autoApply',
        type: 'boolean',
        label: { 'zh-CN': '按歌自动施加', en: 'Apply a curve on every song' },
        defaultValue: false,
      },
    ],
    settingsPanel: (container, ctx) => mountPanel(folium, desk, container, ctx),
  });
  desk = createConsole(folium, section);
  return desk.dispose;
}
