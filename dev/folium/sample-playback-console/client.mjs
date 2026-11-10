// dev/folium/sample-playback-console/client.mjs
// Folium 1.5 sample, renderer half: a home page ("播放控制台" / "Playback console") with
//
//   - the volume slider, the mute switch and the repeat mode (playback.getVolume / setVolume /
//     setMuted / getLoopMode / setLoopMode), kept in sync by playback.volumeChanged and
//     playback.loopModeChanged, whoever changes them;
//   - the play queue a page at a time (playback.getQueue); clicking an entry plays it with
//     playback.playQueueItem(index, ref), which refuses when the queue moved meanwhile;
//     playback.queueChanged redraws the page;
//   - the songs that failed to play (playback.failed). Each failure is also handed to the main
//     entry over folium.rpc, which appends it to a log under api.storage.paths.data and keeps a
//     small rebuildable cache under api.storage.paths.cache (see index.cjs);
//   - Folium 1.7: "Reverse the queue" reads the whole queue under one version and hands it back
//     reversed with playback.replaceQueue (permission playback.queue), answering each refusal.
//
// The page opens from the Grid / Bravais home navigation, or with the "Open playback console"
// command (folium.ui.openHomeTab).

const PAGE_SIZE = 50;
const MAX_RECENT = 30;
// replaceQueue takes at most this many songs (the shared ref pool), and getQueue reads at most 500 at a time.
const MAX_REPLACE = 5000;
const READ_PAGE = 500;
const LOOP_MODES = ['off', 'all', 'one'];

const TEXT = {
  zh: {
    volume: '音量',
    mute: '静音',
    loop: '循环模式',
    loopModes: { off: '不循环', all: '列表循环', one: '单曲循环' },
    queue: '播放队列',
    kinds: {
      fm: '私人 FM：队列是当前这一批歌',
      stage: '外部 Stage 播放中：队列与正在播放的内容无关，不能点播',
    },
    current: (index) => (index >= 0 ? `正在播放第 ${index + 1} 首` : '正在播放的歌不在队列里'),
    range: (from, to, total) => `第 ${from}–${to} 首，共 ${total} 首`,
    empty: '队列是空的',
    previous: '上一页',
    next: '下一页',
    follow: '回到当前',
    queueMoved: '队列刚刚变了，那个位置已经不是你点的歌；列表已刷新。',
    failures: '最近无法播放',
    failuresHint: '记录同时写进模组数据目录的 failures.log。',
    noFailures: '还没有记录。',
    reasons: {
      auth: '需要登录',
      restricted: '受限（会员、购买、试听或地区）',
      'taken-down': '已下架',
      network: '网络问题',
      unknown: '原因不明',
    },
    phases: { play: '点播时取不到音源', restore: '恢复上次播放时', 'mid-playback': '播放器出错（加载或播放时）' },
    autoSkip: '宿主倒计时跳过',
    unknownSong: '（不知道是哪首歌）',
    failed: '操作失败',
    reverse: '把队列倒过来',
    reversed: '队列已经倒过来了；宿主的提示条和命令面板里可以撤销。',
    ownReplacement: '这是本模组的替换。',
    tooLong: (max) => `队列超过 ${max} 首，太长了，没有倒过来。`,
    staleVersion: '队列刚变过，已刷新。',
    rateLimited: '刚替换过，稍后自动再试一次。',
    staleRef: '有的歌已经认不出了，没有倒过来。',
    notQueueable: '队列里有放不进播放队列的歌，没有倒过来。',
    waiting: {
      stage: '外部 Stage 正在播放，等 Stage 结束、队列回来后自动再试。',
      transition: '正在过渡（automix），过渡结束后自动再试。',
      other: '宿主这次没有替换，队列再变化时自动再试。',
    },
    gaveUp: '还是没能倒过来，稍后再点一次。',
  },
  en: {
    volume: 'Volume',
    mute: 'Mute',
    loop: 'Repeat',
    loopModes: { off: 'Off', all: 'Queue', one: 'One song' },
    queue: 'Play queue',
    kinds: {
      fm: 'Personal FM: the queue is the current batch',
      stage: 'External Stage playback: the queue has nothing to do with what plays, so entries cannot be played',
    },
    current: (index) => (index >= 0 ? `Playing #${index + 1}` : 'The playing song is not in the queue'),
    range: (from, to, total) => `${from}–${to} of ${total}`,
    empty: 'The queue is empty',
    previous: 'Previous page',
    next: 'Next page',
    follow: 'Back to current',
    queueMoved: 'The queue just changed and that entry is no longer the song you clicked; the list is refreshed.',
    failures: 'Recent playback failures',
    failuresHint: 'Also written to failures.log in the mod data directory.',
    noFailures: 'Nothing recorded yet.',
    reasons: {
      auth: 'Sign-in needed',
      restricted: 'Restricted (membership, purchase, preview or region)',
      'taken-down': 'Taken down',
      network: 'Network',
      unknown: 'Unknown',
    },
    phases: { play: 'no source when picked', restore: 'restoring the last session', 'mid-playback': 'player error (loading or playing)' },
    autoSkip: 'host counting down to skip',
    unknownSong: '(unknown song)',
    failed: 'Failed',
    reverse: 'Reverse the queue',
    reversed: 'The queue is reversed; the host\'s notice and the command palette can undo it.',
    ownReplacement: 'That was this mod\'s replacement.',
    tooLong: (max) => `The queue has more than ${max} songs, too many to reverse.`,
    staleVersion: 'The queue just changed; the list is refreshed.',
    rateLimited: 'Replaced a moment ago; trying again shortly.',
    staleRef: 'Some songs can no longer be found; the queue was not reversed.',
    notQueueable: 'The queue holds a song that cannot be in the play queue; it was not reversed.',
    waiting: {
      stage: 'External Stage playback holds the player; trying again once the queue is back.',
      transition: 'A blend (automix) is under way; trying again when it ends.',
      other: 'The host did not replace the queue this time; trying again once the queue changes.',
    },
    gaveUp: 'Still not reversed; try again in a moment.',
  },
};

const STYLE = `
* { box-sizing: border-box; }
.console {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(240px, 340px) minmax(0, 1fr);
  gap: 20px;
  padding: 20px 24px 24px;
  font: 14px/1.5 var(--folium-font, sans-serif);
  color: var(--folium-primary, currentColor);
}
.column { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; }
.card {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  min-width: 0;
}
.grow { flex: 1; display: flex; flex-direction: column; min-height: 0; }
h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.8; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.note { margin: 0; font-size: 12px; opacity: 0.65; }
.value { min-width: 3.5em; font-variant-numeric: tabular-nums; }
input[type="range"] { flex: 1; min-width: 120px; accent-color: var(--folium-accent, currentColor); }
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
}
button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--folium-accent, currentColor) 28%, transparent);
  border-color: var(--folium-accent, currentColor);
}
button:disabled { opacity: 0.4; cursor: default; }
button:focus-visible { outline: 2px solid var(--folium-accent, currentColor); outline-offset: 2px; }
ol, ul { list-style: none; margin: 8px 0 0; padding: 0; }
.scroll { flex: 1; min-height: 0; overflow: auto; }
.track {
  width: 100%;
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr) minmax(0, 0.7fr);
  gap: 10px;
  border: 0;
  border-radius: 8px;
  padding: 6px 8px;
  text-align: left;
}
.track:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.track[aria-current="true"] {
  background: color-mix(in srgb, var(--folium-accent, currentColor) 22%, transparent);
  font-weight: 600;
}
.track span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.index, .artist { opacity: 0.6; }
.failure { padding: 8px 0; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.failure:first-child { border-top: 0; }
.status { min-height: 1.5em; margin: 0; font-size: 12px; opacity: 0.8; }
@media (max-width: 720px) {
  .console { height: auto; grid-template-columns: minmax(0, 1fr); }
}
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label, onClick, className) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};

const recordId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/*
 * The failures this mod has seen, newest first: loaded once from the main entry (which keeps them
 * across restarts), then grown by playback.failed. Each new one also goes to the main entry, which
 * appends it to its log. Lives as long as the mod, not the page, so failures are kept while the
 * page is closed.
 */
const createFailureLog = (folium) => {
  let items = [];
  const listeners = new Set();
  const merge = (older) => {
    const seen = new Set(items.map((item) => item.id));
    items = [...items, ...older.filter((item) => item && !seen.has(item.id))].slice(0, MAX_RECENT);
    listeners.forEach((listener) => listener());
  };

  folium.rpc.call('recentFailures')
    .then((persisted) => { if (Array.isArray(persisted)) merge(persisted); })
    .catch((error) => folium.log.warn('could not load earlier failures', String(error)));

  // `high`, so the record is in place before the page's own handler (default `normal`) redraws.
  const off = folium.events.on('playback.failed', (event) => {
    const record = {
      id: recordId(),
      at: Date.now(),
      // Plain fields only: `ref` is valid for this session alone, and rpc arguments must be JSON.
      song: event.song ? { title: event.song.title, artist: event.song.artist, source: event.song.source } : null,
      reason: event.reason,
      phase: event.phase,
      // What the host meant to do at that moment; the user may still cancel the countdown.
      willAutoSkip: event.willAutoSkip,
    };
    items = [record, ...items].slice(0, MAX_RECENT);
    folium.rpc.call('recordFailure', record)
      .catch((error) => folium.log.warn('could not write the failure log', String(error)));
  }, { priority: 'high' });

  return {
    list: () => items,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      off();
      listeners.clear();
    },
  };
};

/* The page. Everything is read through folium.playback and redrawn on the 1.5 notifications. */
const mountConsole = (folium, failures, container, ctx) => {
  const t = TEXT[ctx.locale.startsWith('zh') ? 'zh' : 'en'];
  const { playback } = folium;
  const status = el('p', 'status');
  status.setAttribute('role', 'status');

  const report = (error) => {
    status.textContent = `${t.failed}: ${error instanceof Error ? error.message : String(error)}`;
    folium.log.warn('playback console action failed', String(error));
  };
  // Write calls throw (or reject) without `playback.control`, or with a bad argument.
  const attempt = (action) => {
    try {
      const result = action();
      if (result && typeof result.then === 'function') result.catch(report);
    } catch (error) {
      report(error);
    }
  };

  // ---- volume and mute
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.setAttribute('aria-label', t.volume);
  const volumeValue = el('span', 'value');
  let dragging = false;
  const muteButton = button(t.mute, () => attempt(() => playback.setMuted(!playback.getVolume().muted)));
  const renderVolume = ({ volume, muted } = playback.getVolume()) => {
    if (!dragging) {
      slider.value = String(Math.round(volume * 100));
      volumeValue.textContent = `${slider.value}%`;
    }
    muteButton.setAttribute('aria-pressed', String(muted));
  };
  slider.addEventListener('input', () => {
    dragging = true;
    volumeValue.textContent = `${slider.value}%`;
  });
  // Set once, when the user lets go: the host saves every setVolume call.
  slider.addEventListener('change', () => {
    dragging = false;
    attempt(() => playback.setVolume(Number(slider.value) / 100));
  });
  // A drag that ends where it started fires no change event.
  slider.addEventListener('blur', () => {
    dragging = false;
    renderVolume();
  });
  const volumeCard = el('section', 'card');
  const volumeRow = el('div', 'row');
  volumeRow.append(slider, volumeValue, muteButton);
  volumeCard.append(el('h2', '', t.volume), volumeRow);

  // ---- repeat mode
  const loopButtons = LOOP_MODES.map((mode) => [mode, button(t.loopModes[mode], () => attempt(() => playback.setLoopMode(mode)))]);
  const renderLoop = (current = playback.getLoopMode()) => {
    loopButtons.forEach(([mode, node]) => node.setAttribute('aria-pressed', String(mode === current)));
  };
  const loopCard = el('section', 'card');
  const loopRow = el('div', 'row');
  loopRow.append(...loopButtons.map(([, node]) => node));
  loopCard.append(el('h2', '', t.loop), loopRow);

  // ---- failures
  const failureList = el('ul', 'scroll');
  const renderFailures = () => {
    const items = failures.list();
    failureList.replaceChildren(...(items.length === 0 ? [el('li', 'note', t.noFailures)] : items.map((item) => {
      const row = el('li', 'failure');
      const title = item.song ? `${item.song.title} — ${item.song.artist}` : t.unknownSong;
      const details = [
        new Date(item.at).toLocaleString(ctx.locale),
        t.reasons[item.reason] ?? item.reason,
        t.phases[item.phase] ?? item.phase,
        ...(item.willAutoSkip ? [t.autoSkip] : []),
      ].join(' · ');
      row.append(el('div', '', title), el('div', 'note', details));
      return row;
    })));
  };
  const failureCard = el('section', 'card grow');
  failureCard.append(el('h2', '', t.failures), el('p', 'note', t.failuresHint), failureList);

  // ---- queue, a page at a time
  // Centred on the displayed song (getQueue without an offset) until the user pages away.
  let follow = true;
  let offset = 0;
  const queueKind = el('p', 'note');
  // Folium 1.7: whether the last change of the queue was this mod's own replaceQueue (playback.queueChanged's byThisMod).
  const queueOwner = el('p', 'note');
  const queueRange = el('span', 'note');
  const trackList = el('ol', 'scroll');
  const readPage = () => (follow ? playback.getQueue({ limit: PAGE_SIZE }) : playback.getQueue({ offset, limit: PAGE_SIZE }));

  const playEntry = async (item) => {
    try {
      // With the ref, the host refuses instead of playing whatever moved into that position.
      const played = await playback.playQueueItem(item.index, item.song.ref ?? undefined);
      if (!played) {
        status.textContent = t.queueMoved;
        renderQueue();
      }
    } catch (error) {
      report(error);
    }
  };

  const renderQueue = () => {
    let page = readPage();
    // The queue shrank under a page the user scrolled to: show its last page instead of nothing.
    if (!follow && page.items.length === 0 && page.length > 0) {
      offset = Math.max(0, page.length - PAGE_SIZE);
      page = readPage();
    }
    offset = page.items.length > 0 ? page.items[0].index : 0;
    queueKind.textContent = page.kind === 'queue' ? t.current(page.currentIndex) : `${t.kinds[page.kind]} · ${t.current(page.currentIndex)}`;
    queueRange.textContent = page.items.length > 0 ? t.range(offset + 1, offset + page.items.length, page.length) : t.empty;
    previousButton.disabled = offset === 0;
    nextButton.disabled = offset + page.items.length >= page.length;
    // Keep keyboard focus on the same entry across redraws (playing an entry redraws the list).
    const focused = trackList.getRootNode().activeElement;
    const focusedIndex = focused instanceof HTMLElement && trackList.contains(focused) ? focused.dataset.index : undefined;
    trackList.replaceChildren(...page.items.map((item) => {
      const entry = el('li');
      const node = button('', () => { void playEntry(item); }, 'track');
      node.dataset.index = String(item.index);
      node.disabled = page.kind === 'stage';
      if (item.index === page.currentIndex) node.setAttribute('aria-current', 'true');
      node.append(el('span', 'index', String(item.index + 1)), el('span', '', item.song.title), el('span', 'artist', item.song.artist));
      entry.append(node);
      return entry;
    }));
    if (focusedIndex !== undefined) trackList.querySelector(`[data-index="${focusedIndex}"]`)?.focus();
  };

  const previousButton = button(t.previous, () => {
    follow = false;
    offset = Math.max(0, offset - PAGE_SIZE);
    renderQueue();
  });
  const nextButton = button(t.next, () => {
    follow = false;
    offset += PAGE_SIZE;
    renderQueue();
  });
  const followButton = button(t.follow, () => {
    follow = true;
    renderQueue();
  });
  // ---- Folium 1.7: the whole queue reversed in one step
  const canReplace = folium.host.folium.minor >= 7 && typeof playback.replaceQueue === 'function';
  // A reversal the host refused for a passing reason (the Stage, a blend) is tried again once, on the next
  // playback.queueChanged; one refused `rate-limited`, once after `retryAfterMs`.
  // "Once" is per wait, and a wait never gives up: a queueChanged can come while the reason still holds
  // (the arriving song landing mid-blend), so a try refused for it again simply waits again, and a `stage`
  // wait only tries once the queue is no longer the Stage's. `{ reason, run }` while waiting, else null.
  let retryOnChange = null;
  let retryTimer = null;

  /* The whole queue, page after page while the version stays the same; null when it is too long to replace. */
  const readWholeQueue = () => {
    const first = playback.getQueue({ offset: 0, limit: READ_PAGE });
    if (first.length > MAX_REPLACE) return null;
    const songs = first.items.map((item) => item.song);
    while (songs.length < first.length) {
      const page = playback.getQueue({ offset: songs.length, limit: READ_PAGE });
      // Another version: the queue changed between two pages (only possible when pages are read across
      // waits, which this loop does not do). Read it again from the top.
      if (page.version !== first.version) return readWholeQueue();
      songs.push(...page.items.map((item) => item.song));
    }
    return { songs, version: first.version };
  };

  const reverseQueue = async (isRetry) => {
    const read = readWholeQueue();
    if (!read) {
      status.textContent = t.tooLong(MAX_REPLACE);
      return;
    }
    const result = await playback.replaceQueue([...read.songs].reverse(), { expectedVersion: read.version });
    if (result.status === 'replaced') {
      status.textContent = t.reversed;
      return;
    }
    if (result.reason === 'stale-version') {
      // Someone changed the queue since it was read: show it as it is now, and let the user decide again.
      status.textContent = t.staleVersion;
      renderQueue();
    } else if (result.reason === 'rate-limited') {
      if (isRetry) {
        status.textContent = t.gaveUp;
      } else {
        status.textContent = t.rateLimited;
        retryTimer = setTimeout(() => { retryTimer = null; void attemptReverse(true); }, result.retryAfterMs);
      }
    } else if (result.reason === 'stale-ref') {
      // The songs were read just now; read them once more and try again.
      if (isRetry) status.textContent = t.staleRef;
      else await reverseQueue(true);
    } else if (result.reason === 'not-queueable') {
      status.textContent = t.notQueueable;
    } else {
      // `stage`, `transition`, and reasons a later Folium may add (treated like `transition`): wait for a
      // queueChanged, and again after each refusal for the same reason, however many there are.
      status.textContent = t.waiting[result.reason] ?? t.waiting.other;
      retryOnChange = { reason: result.reason, run: () => attemptReverse(false) };
    }
  };
  // replaceQueue rejects only for a call written wrong (a missing permission, bad arguments).
  const attemptReverse = (isRetry) => reverseQueue(isRetry).catch(report);
  const reverseButton = canReplace ? button(t.reverse, () => { void attemptReverse(false); }) : null;

  const queueCard = el('section', 'card grow');
  const pager = el('div', 'row');
  pager.append(previousButton, nextButton, followButton, queueRange);
  queueCard.append(el('h2', '', t.queue), queueKind, queueOwner, pager);
  if (reverseButton) {
    const reverseRow = el('div', 'row');
    reverseRow.append(reverseButton);
    queueCard.append(reverseRow);
  }
  // The status line sits above the list: at the bottom of the page the host's floating player bar covers it.
  queueCard.append(status, trackList);

  // ---- layout
  const root = el('div', 'console');
  const side = el('div', 'column');
  side.append(volumeCard, loopCard, failureCard);
  const main = el('div', 'column');
  main.append(queueCard);
  root.append(side, main);
  const style = el('style', '', STYLE);
  container.append(style, root);

  renderVolume();
  renderLoop();
  renderQueue();
  renderFailures();

  const disposers = [
    folium.events.on('playback.volumeChanged', (event) => renderVolume(event)),
    folium.events.on('playback.loopModeChanged', (event) => renderLoop(event.mode)),
    // Only the outline arrives (length, currentIndex; 1.7 adds version and byThisMod): read the page again for the songs.
    folium.events.on('playback.queueChanged', (event) => {
      renderQueue();
      queueOwner.textContent = event.byThisMod ? t.ownReplacement : '';
      const retry = retryOnChange;
      // Still the Stage's queue: the contract says to try once `kind` is no longer `stage`.
      if (!retry || (retry.reason === 'stage' && playback.getQueue({ limit: 1 }).kind === 'stage')) return;
      retryOnChange = null;
      void retry.run();
    }),
    folium.events.on('playback.failed', () => renderFailures()),
    failures.subscribe(renderFailures),
  ];
  return () => {
    disposers.forEach((dispose) => dispose());
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryOnChange = null;
    root.remove();
    style.remove();
  };
};

export default function activate(folium) {
  if (folium.host.folium.minor < 5) {
    throw new Error('sample-playback-console needs Folium 1.5 (homeTabs, playback.getQueue, playback.failed)');
  }
  // The export window has no home page and no playback service; nothing here applies there.
  if (folium.env.context !== 'main') return undefined;

  const failures = createFailureLog(folium);
  folium.registries.homeTabs.register({
    id: 'console',
    label: { 'zh-CN': '播放控制台', en: 'Playback console' },
    order: 300,
    mount: (container, ctx) => mountConsole(folium, failures, container, ctx),
  });
  folium.registries.commands.register({
    id: 'open',
    label: { 'zh-CN': '打开播放控制台', en: 'Open playback console' },
    description: { 'zh-CN': '首页里的音量、循环模式与播放队列', en: 'Volume, repeat mode and the play queue on the home page' },
    keywords: ['volume', 'queue', 'repeat', '音量', '队列', '循环'],
    run: () => { folium.ui.openHomeTab('console'); },
  });
  return failures.dispose;
}
