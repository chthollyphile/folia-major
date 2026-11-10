// dev/folium/sample-omni-console/client.mjs
// Folium 1.7 sample: a home page ("在线音源" / "Online sources") that reads the host's online music
// sources through folium.omni, the stable read-only service. Four cards:
//
//   - Sources: folium.omni.listProviders(), read again on every draw (it is synchronous and asks no
//     source). Pick the source to search, or follow the one the host has selected.
//   - Search: searchSongs, paged with `nextCursor`. The first page sets the page length; a later page
//     passes the cursor with the same query and source, and no `limit`.
//   - Song: "Details" on any song shows describeSong (synchronous), the first lines of getLyrics, and on
//     request the first page of its album's songs (getAlbum, then getTracks).
//   - Saved keys: "Save key" keeps { source, id } in folium.storage, never the `ref` (valid for this run
//     only). The first time the page opens after a start, resolveSongs turns the saved keys back into
//     host songs, so a key saved before a restart plays again. A key the host cannot look up now
//     (`unsupported`) is kept: its source may come back. A key typed in by hand resolves the same way.
//
// folium.omni needs no permission, and asks each source as the account signed in to it in Folia.
// "Add to queue" is the one step that needs one (playback.control); saving keys needs filesystem.data.
// Songs are told apart by `source` and `id`: the "now playing" marks compare those, never refs, since
// the same song read twice may come with two refs.

const STORAGE_KEY = 'savedKeys';
// resolveSongs takes 1–50 keys a call; the page keeps fewer, so one call resolves them all.
const MAX_SAVED = 20;
const LYRIC_LINES = 6;
const ALBUM_PAGE = 10;
const PAGE_SIZES = [10, 30];

// A saved key whose lookup is under way.
const PENDING = 'pending';

const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const TEXT = {
  zh: {
    sourcesTitle: '在线音源（listProviders）',
    sourcesHint: '同步读取，不问平台，每次重画都读一遍。点一个音源，搜索就固定搜它；「当前选中的」跟着宿主的选择走。',
    searchTarget: '搜索：',
    selectedChoice: '当前选中的',
    noSources: '宿主没有在线音源。',
    originMod: '来自模组',
    selectedTag: '宿主选中',
    notConfigured: '未配置',
    supports: { search: '搜索', resolve: '解析', lyrics: '歌词', albums: '专辑', artists: '歌手' },
    searchTitle: '搜索（searchSongs）',
    searchLabel: '搜索词',
    searchPlaceholder: '歌名、歌手…',
    searchButton: '搜索',
    pageSize: '每页',
    pageSizeHint: '页长在第一页定下：改了它，下一次新的搜索才按新的页长。',
    searching: '读取中…',
    searchEmpty: '没有结果。',
    searchCount: (shown, total) => (total === null ? `已读 ${shown} 首` : `已读 ${shown} 首，共 ${total} 首`),
    nextPage: '下一页',
    details: '详情',
    saveKey: '存键',
    savedMark: '已存',
    enqueue: '加入队列',
    nowPlaying: '正在放',
    songTitle: '歌曲（describeSong / getLyrics）',
    songHint: '在搜索结果或存下的键里点「详情」。',
    key: (text) => `键 ${text}`,
    duration: (ms) => (ms === null ? '时长：平台没给' : `时长：${formatDuration(ms)}`),
    availability: (value) => `可用性：${{
      playable: '平台没标什么（不保证放得了）',
      'taken-down': '已下架',
      restricted: '平台标了限制（会员、地区），放的时候才知道',
    }[value] ?? '平台没说'}`,
    pageUrl: (url) => `网页：${url}`,
    notOnline: '宿主不知道这首歌了：不是在线歌曲，或者它的 ref 已经失效。',
    lyricsLoading: '读取歌词中…',
    lyricsNone: '这个音源没有歌词，没有发请求。',
    lyricsEmpty: '平台没有这首的歌词。',
    lyricsPure: '平台标了纯音乐。',
    lyricsMeta: (count, wordByWord) => `共 ${count} 行${wordByWord ? '，逐字' : ''}；下面是前几行，「♪」是副歌。`,
    albumButton: '专辑曲目（第一页）',
    albumLoading: '读取专辑中…',
    albumNone: '平台没有这首歌的专辑。',
    albumNoSupport: '这个音源没有专辑。',
    albumKey: (album) => `键 ${album.source}:${album.kind}:${album.id}`,
    albumCount: (shown, total, more) => `前 ${shown} 首${total === null ? '' : `，共 ${total} 首`}${more ? '；后面的用 nextCursor 读' : ''}`,
    savedTitle: '存下的键（resolveSongs）',
    savedHint: '「存键」只存 { source, id }。每次启动后第一次打开这一页时，把它们一次解析回宿主的歌。',
    savedEmpty: '还没有存键。',
    resolveAgain: '重新解析',
    remove: '删除',
    unresolved: '还没解析。',
    resolution: {
      [PENDING]: '解析中…',
      'not-found': '平台回答了：没有这首歌。',
      unsupported: '这台宿主现在查不了（没有这个音源、不是在线音源，或者它不能按 id 查歌），键留着。',
    },
    lookupTitle: '手动解析一个键',
    lookupSource: '音源 id（不填就用宿主选中的）',
    lookupId: '歌曲 id',
    lookupButton: '解析',
    lookupFound: '找到了：',
    errors: {
      unsupported: '这个音源不支持这一项，或者没有这个音源。',
      unavailable: '音源现在接不了请求。',
      'region-restricted': '音源不回答这个地区的请求。',
      'not-signed-in': '要先在 Folia 里登录这个平台。',
      'session-expired': '登录已过期，请在 Folia 里重新登录。',
      'vip-required': '平台说只有会员能看。',
      'rate-limited': '请求太频繁（这个模组每分钟有上限），稍后再试。',
      network: '没有按时拿到回答，或者平台没说原因。',
      'account-changed': '途中换了音源或账号，回答已丢弃。',
      'stale-ref': '已经失效（游标或 ref），请重新读一次。',
      aborted: '已中止。',
    },
    failed: (text) => `失败：${text}`,
    unexpected: (message) => `出错了：${message}`,
    enqueueStale: '这首歌的 ref 已经失效，没有加进队列：重新搜，或者重新解析它的键。',
  },
  en: {
    sourcesTitle: 'Online sources (listProviders)',
    sourcesHint: 'Synchronous and asks no source, so it is read again on every draw. Pick a source to always search it; "The selected one" follows the host.',
    searchTarget: 'Search:',
    selectedChoice: 'The selected one',
    noSources: 'The host has no online source.',
    originMod: 'from a mod',
    selectedTag: 'selected',
    notConfigured: 'not set up',
    supports: { search: 'search', resolve: 'resolve', lyrics: 'lyrics', albums: 'albums', artists: 'artists' },
    searchTitle: 'Search (searchSongs)',
    searchLabel: 'Search words',
    searchPlaceholder: 'Title, artist…',
    searchButton: 'Search',
    pageSize: 'Per page',
    pageSizeHint: 'The first page sets the page length: a change applies from the next new search.',
    searching: 'Loading…',
    searchEmpty: 'No results.',
    searchCount: (shown, total) => (total === null ? `${shown} read` : `${shown} of ${total} read`),
    nextPage: 'Next page',
    details: 'Details',
    saveKey: 'Save key',
    savedMark: 'Saved',
    enqueue: 'Add to queue',
    nowPlaying: 'Now playing',
    songTitle: 'Song (describeSong / getLyrics)',
    songHint: 'Choose "Details" on a search result or a saved key.',
    key: (text) => `Key ${text}`,
    duration: (ms) => (ms === null ? 'Duration: not given' : `Duration: ${formatDuration(ms)}`),
    availability: (value) => `Availability: ${{
      playable: 'nothing marked against it (no promise that it plays)',
      'taken-down': 'taken down',
      restricted: 'marked as limited (members, regions); found out when it plays',
    }[value] ?? 'not said'}`,
    pageUrl: (url) => `Page: ${url}`,
    notOnline: 'The host no longer knows this song: it is not online, or its ref expired.',
    lyricsLoading: 'Loading lyrics…',
    lyricsNone: 'This source has no lyrics; nothing was asked.',
    lyricsEmpty: 'The source has no lyrics for this song.',
    lyricsPure: 'The source marks it as instrumental.',
    lyricsMeta: (count, wordByWord) => `${count} lines${wordByWord ? ', word by word' : ''}; the first few below, chorus lines marked ♪.`,
    albumButton: 'Album songs (first page)',
    albumLoading: 'Loading the album…',
    albumNone: 'The source has no album for this song.',
    albumNoSupport: 'This source has no albums.',
    albumKey: (album) => `Key ${album.source}:${album.kind}:${album.id}`,
    albumCount: (shown, total, more) => `First ${shown}${total === null ? '' : ` of ${total}`}${more ? '; nextCursor reads on' : ''}`,
    savedTitle: 'Saved keys (resolveSongs)',
    savedHint: '"Save key" keeps { source, id } only. The first time this page opens after a start, they are resolved back into host songs in one call.',
    savedEmpty: 'No key saved yet.',
    resolveAgain: 'Resolve again',
    remove: 'Remove',
    unresolved: 'Not resolved yet.',
    resolution: {
      [PENDING]: 'Resolving…',
      'not-found': 'The source answered: no such song.',
      unsupported: 'This host cannot look it up now (no such source, not an online one, or one that cannot look songs up by id); the key is kept.',
    },
    lookupTitle: 'Resolve a key by hand',
    lookupSource: 'Source id (empty: the selected one)',
    lookupId: 'Song id',
    lookupButton: 'Resolve',
    lookupFound: 'Found: ',
    errors: {
      unsupported: 'This source does not answer this, or there is no such source.',
      unavailable: 'The source cannot take requests now.',
      'region-restricted': 'The source does not answer from this region.',
      'not-signed-in': 'Sign in to this platform in Folia first.',
      'session-expired': 'The sign-in has expired; sign in again in Folia.',
      'vip-required': 'The source says only members may.',
      'rate-limited': 'Too many requests (this mod has an allowance a minute); try again later.',
      network: 'No answer in time, or a failure the source did not explain.',
      'account-changed': 'The source or its account changed meanwhile; the answer was dropped.',
      'stale-ref': 'It expired (a cursor or a ref); read it again.',
      aborted: 'Stopped.',
    },
    failed: (text) => `Failed: ${text}`,
    unexpected: (message) => `Something went wrong: ${message}`,
    enqueueStale: 'The song\'s ref expired, so it was not added: search again, or resolve its key again.',
  },
};

const STYLE = `
* { box-sizing: border-box; }
.console {
  height: 100%;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 16px;
  padding: 20px 24px 24px;
  font: 14px/1.5 var(--folium-font, sans-serif);
  color: var(--folium-primary, currentColor);
}
/* The page sits in a shadow root, out of reach of the host's scrollbar styles: tint them from the text color. */
.console, .list { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, currentColor 30%, transparent) transparent; }
.card {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wide { grid-column: 1 / -1; }
h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.8; }
h3 { margin: 4px 0 0; font-size: 13px; font-weight: 600; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.note { margin: 0; font-size: 12px; opacity: 0.65; }
.value { font-weight: 600; }
.tag { font-size: 11px; padding: 0 6px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
.off { opacity: 0.35; text-decoration: line-through; }
.cover { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; }
button {
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}
button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 16%, transparent); }
button:disabled { opacity: 0.4; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--folium-accent, currentColor); outline-offset: 2px; }
input {
  font: inherit;
  color: inherit;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 8px;
  padding: 4px 10px;
  min-width: 0;
  flex: 1 1 160px;
}
ol, ul { list-style: none; margin: 0; padding: 0; }
.list { max-height: 320px; overflow: auto; padding-right: 8px; }
.list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 4px 0; }
.list li > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; align-items: center; gap: 6px; }
.sources li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 2px 0; }
.lyrics li { padding: 1px 0; }
@media (max-width: 720px) {
  .console { grid-template-columns: minmax(0, 1fr); }
}
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* A button; `focus` names it so that a redraw can give it the keyboard focus back. */
const button = (label, onClick, focus) => {
  const node = el('button', '', label);
  node.type = 'button';
  if (focus) node.dataset.focus = focus;
  node.addEventListener('click', onClick);
  return node;
};

/* Whether two song DTOs are the same song: by source and id, never by ref. */
const sameSong = (a, b) => Boolean(a && b && a.source && a.id !== null && a.source === b.source && a.id === b.id);

const keyText = (key) => `${key.source}:${key.id}`;

/* A rejection of folium.omni as the page shows it: its `code`, or the message of an Error without one (a TypeError for a malformed argument). */
const failureOf = (error) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error instanceof Error ? error.message : String(error),
});

const isSavedKey = (value) => typeof value?.source === 'string' && value.source !== ''
  && typeof value.id === 'string' && value.id !== '';

/*
 * What the page shows, kept for as long as the mod runs (not the page), so that leaving the page and
 * coming back keeps the search. Each kind of request has one AbortController: a new request of that
 * kind aborts the one before, whose `aborted` rejection is then ignored. When the mod stops, the host
 * aborts the calls still under way by itself.
 */
const createDesk = (folium) => {
  const { omni } = folium;
  const state = {
    // The source to search; null: the one the host has selected now.
    providerId: null,
    pageSize: PAGE_SIZES[0],
    // { status: 'idle' | 'loading' | 'ready' | 'error', query, providerId, items, nextCursor, total, failure }
    search: { status: 'idle', query: '', providerId: null, items: [], nextCursor: null, total: null, failure: null },
    song: null,
    details: null,
    lyrics: { status: 'idle' },
    album: { status: 'idle' },
    saved: [],
    // keyText → a FoliumSongResolution, or PENDING
    resolutions: new Map(),
    resolvedOnce: false,
    resolveFailure: null,
    lookup: { status: 'idle' },
    notice: '',
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const controllers = { search: null, song: null, album: null, resolve: null, lookup: null };

  /* A new signal for one kind of request; the one of that kind still under way is aborted. */
  const begin = (kind) => {
    controllers[kind]?.abort();
    const controller = new AbortController();
    controllers[kind] = controller;
    return controller;
  };
  const current = (kind, controller) => controllers[kind] === controller;
  const end = (kind, controller) => {
    if (current(kind, controller)) controllers[kind] = null;
  };
  // An aborted call was replaced by a newer one, or the mod stopped: nothing to show.
  const isAborted = (error) => error?.code === 'aborted';

  const providerOf = (providerId) => omni.listProviders().find((info) => info.providerId === providerId) ?? null;
  const searchOptions = (providerId) => (providerId ? { providerId } : {});

  // ---- search, page by page
  const search = async (query) => {
    const controller = begin('search');
    const { providerId, pageSize } = state;
    state.search = { status: 'loading', query, providerId, items: [], nextCursor: null, total: null, failure: null };
    notify();
    try {
      // The first page: `limit` is read here only, and the later pages keep it.
      const page = await omni.searchSongs(query, { ...searchOptions(providerId), limit: pageSize, signal: controller.signal });
      if (!current('search', controller)) return;
      state.search = { ...state.search, status: 'ready', items: [...page.items], nextCursor: page.nextCursor, total: page.total };
    } catch (error) {
      if (isAborted(error) || !current('search', controller)) return;
      state.search = { ...state.search, status: 'error', failure: failureOf(error) };
    } finally {
      end('search', controller);
    }
    notify();
  };

  const more = async () => {
    const { query, providerId, nextCursor, status } = state.search;
    if (!nextCursor || status === 'loading') return;
    const controller = begin('search');
    state.search = { ...state.search, status: 'loading', failure: null };
    notify();
    try {
      // A later page: the cursor, with the first page's query and source. No `limit`: it would be ignored.
      const page = await omni.searchSongs(query, { ...searchOptions(providerId), cursor: nextCursor, signal: controller.signal });
      if (!current('search', controller)) return;
      state.search = {
        ...state.search,
        status: 'ready',
        items: [...state.search.items, ...page.items],
        nextCursor: page.nextCursor,
        total: page.total ?? state.search.total,
      };
    } catch (error) {
      if (isAborted(error) || !current('search', controller)) return;
      const failure = failureOf(error);
      // `stale-ref`: the cursor is gone. `account-changed`: the selected source moved on, and this list
      // was the old one's. Either way the list ends here; a new search starts again from the first page.
      const ended = failure.code === 'stale-ref' || failure.code === 'account-changed';
      state.search = { ...state.search, status: 'error', failure, nextCursor: ended ? null : nextCursor };
    } finally {
      end('search', controller);
    }
    notify();
  };

  // ---- one song: what the host knows of it, and its lyrics
  const pick = async (song) => {
    const controller = begin('song');
    controllers.album?.abort();
    state.song = song;
    // Synchronous, asks no source; null for a song that is not online, or whose ref expired.
    state.details = omni.describeSong(song);
    state.album = { status: 'idle' };
    state.notice = '';
    // Asking a source for what it does not have would only reject `unsupported`: look at `supports` first.
    if (!state.details || !providerOf(song.source)?.supports.lyrics) {
      state.lyrics = { status: state.details ? 'none' : 'idle' };
      end('song', controller);
      notify();
      return;
    }
    state.lyrics = { status: 'loading' };
    notify();
    try {
      const lyrics = await omni.getLyrics(song, { signal: controller.signal });
      if (!current('song', controller)) return;
      state.lyrics = {
        status: 'ready',
        count: lyrics.lines.length,
        lines: lyrics.lines.slice(0, LYRIC_LINES),
        isWordByWord: lyrics.isWordByWord,
        isPureMusic: lyrics.isPureMusic,
      };
    } catch (error) {
      if (isAborted(error) || !current('song', controller)) return;
      state.lyrics = { status: 'error', failure: failureOf(error) };
    } finally {
      end('song', controller);
    }
    notify();
  };

  // ---- the album of that song, and the first page of its songs
  const loadAlbum = async () => {
    const { song } = state;
    if (!song) return;
    const controller = begin('album');
    state.album = { status: 'loading' };
    notify();
    try {
      // A summary taken from the song (its name and cover); its key would read the details (resolveCollection).
      const album = await omni.getAlbum(song, { signal: controller.signal });
      if (!current('album', controller)) return;
      if (!album) {
        state.album = { status: 'none' };
      } else {
        const page = await omni.getTracks(album, { limit: ALBUM_PAGE, signal: controller.signal });
        if (!current('album', controller)) return;
        state.album = { status: 'ready', album, items: [...page.items], total: page.total, more: page.nextCursor !== null };
      }
    } catch (error) {
      if (isAborted(error) || !current('album', controller)) return;
      state.album = { status: 'error', failure: failureOf(error) };
    } finally {
      end('album', controller);
    }
    notify();
  };

  // ---- saved keys: { source, id } in folium.storage, resolved again after every start
  const persist = () => folium.storage.set(STORAGE_KEY, state.saved).catch((error) => {
    folium.log.warn('could not store the saved keys', error);
  });
  const loaded = folium.storage.get(STORAGE_KEY).then(
    (stored) => {
      const keys = Array.isArray(stored) ? stored.filter(isSavedKey) : [];
      state.saved = keys.slice(0, MAX_SAVED).map(({ source, id, title, artist }) => ({
        source, id, title: typeof title === 'string' ? title : '', artist: typeof artist === 'string' ? artist : '',
      }));
      notify();
    },
    (error) => folium.log.warn('could not read the saved keys', error),
  );

  const resolveSaved = async () => {
    // Only the portable identity goes in: never a ref, which a restart made worthless.
    const keys = state.saved.map(({ source, id }) => ({ source, id }));
    if (keys.length === 0) return;
    const controller = begin('resolve');
    keys.forEach((key) => state.resolutions.set(keyText(key), PENDING));
    state.resolveFailure = null;
    notify();
    try {
      // One resolution per key, in their order. A key that fails does not fail the call: it rejects only
      // for malformed keys and `aborted`.
      const results = await omni.resolveSongs(keys, { signal: controller.signal });
      if (!current('resolve', controller)) return;
      results.forEach((resolution, index) => state.resolutions.set(keyText(keys[index]), resolution));
    } catch (error) {
      if (isAborted(error) || !current('resolve', controller)) return;
      keys.forEach((key) => state.resolutions.delete(keyText(key)));
      state.resolveFailure = failureOf(error);
    } finally {
      end('resolve', controller);
    }
    notify();
  };

  const saveKey = (song) => {
    if (!song.source || song.id === null) return;
    if (state.saved.some((key) => sameSong(key, song))) return;
    state.saved = [{ source: song.source, id: song.id, title: song.title, artist: song.artist }, ...state.saved].slice(0, MAX_SAVED);
    // The song in hand is its own resolution: nothing to ask.
    state.resolutions.set(keyText(song), Object.freeze({ status: 'found', song }));
    void persist();
    notify();
  };

  const removeKey = (key) => {
    state.saved = state.saved.filter((saved) => !sameSong(saved, key));
    state.resolutions.delete(keyText(key));
    void persist();
    notify();
  };

  const lookup = async (source, id) => {
    const controller = begin('lookup');
    const key = { source: source || (omni.listProviders().find((info) => info.selected)?.providerId ?? ''), id };
    state.lookup = { status: 'loading', key };
    notify();
    try {
      const [resolution] = await omni.resolveSongs([key], { signal: controller.signal });
      if (!current('lookup', controller)) return;
      state.lookup = { status: 'ready', key, resolution };
    } catch (error) {
      if (isAborted(error) || !current('lookup', controller)) return;
      // An empty source (no source selected) is a malformed key: a TypeError, without a code.
      state.lookup = { status: 'error', key, failure: failureOf(error) };
    } finally {
      end('lookup', controller);
    }
    notify();
  };

  // The one call here that needs a permission (playback.control). The host adds the song the way the
  // user's queue-add setting says, moves one already queued, and shows its own notice; false only when
  // the ref expired.
  const enqueue = (song) => {
    state.notice = folium.playback.enqueue(song) ? '' : 'stale';
    notify();
  };

  return {
    state,
    providerOf,
    search,
    more,
    pick,
    loadAlbum,
    saveKey,
    removeKey,
    lookup,
    enqueue,
    resolveSaved: () => loaded.then(resolveSaved),
    /* Resolves the saved keys the first time the page opens in this run, not at start: only what is shown. */
    resolveOnce: () => {
      if (state.resolvedOnce) return;
      state.resolvedOnce = true;
      void loaded.then(resolveSaved);
    },
    setProvider: (providerId) => { state.providerId = providerId; notify(); },
    setPageSize: (size) => { state.pageSize = size; notify(); },
    notify,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      Object.values(controllers).forEach((controller) => controller?.abort());
      listeners.clear();
    },
  };
};

/* The page: four cards drawn again from the desk's state whenever it changes. */
const mountPage = (folium, desk, container, ctx) => {
  const t = TEXT[ctx.locale.startsWith('zh') ? 'zh' : 'en'];
  const errorText = (failure) => (failure.code ? (t.errors[failure.code] ?? t.errors.network) : t.unexpected(failure.message));

  const card = (title, hint, ...children) => {
    const node = el('section', 'card');
    node.append(el('h2', '', title), ...(hint ? [el('p', 'note', hint)] : []), ...children);
    return node;
  };

  // ---- sources
  const targetRow = el('div', 'row');
  const sourceList = el('ul', 'sources');
  const sourcesCard = card(t.sourcesTitle, t.sourcesHint, targetRow, sourceList);
  sourcesCard.classList.add('wide');

  // ---- search
  const form = el('form', 'row');
  const queryInput = el('input');
  queryInput.type = 'search';
  queryInput.placeholder = t.searchPlaceholder;
  queryInput.setAttribute('aria-label', t.searchLabel);
  queryInput.value = desk.state.search.query;
  const submit = el('button', '', t.searchButton);
  submit.type = 'submit';
  form.append(queryInput, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = queryInput.value.trim();
    if (query) void desk.search(query);
  });
  const sizeRow = el('div', 'row');
  const searchState = el('p', 'note');
  searchState.setAttribute('role', 'status');
  const results = el('ul', 'list');
  const moreButton = button(t.nextPage, () => { void desk.more(); }, 'more');
  const searchCard = card(t.searchTitle, t.pageSizeHint, form, sizeRow, searchState, results, moreButton);

  // ---- song
  const songBody = el('div');
  const songCard = card(t.songTitle, t.songHint, songBody);

  // ---- saved keys
  const savedState = el('p', 'note');
  savedState.setAttribute('role', 'status');
  const savedList = el('ul', 'list');
  const resolveButton = button(t.resolveAgain, () => { void desk.resolveSaved(); }, 'resolve');
  const lookupForm = el('form', 'row');
  const sourceInput = el('input');
  sourceInput.placeholder = t.lookupSource;
  sourceInput.setAttribute('aria-label', t.lookupSource);
  const idInput = el('input');
  idInput.placeholder = t.lookupId;
  idInput.setAttribute('aria-label', t.lookupId);
  const lookupSubmit = el('button', '', t.lookupButton);
  lookupSubmit.type = 'submit';
  lookupForm.append(sourceInput, idInput, lookupSubmit);
  lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = idInput.value.trim();
    if (id) void desk.lookup(sourceInput.value.trim(), id);
  });
  const lookupResult = el('div');
  const savedCard = card(t.savedTitle, t.savedHint, savedState, savedList, resolveButton, el('h3', '', t.lookupTitle), lookupForm, lookupResult);
  savedCard.classList.add('wide');

  const notice = el('p', 'note');
  notice.setAttribute('role', 'status');

  /*
   * One song in a list: title and artists, a "now playing" mark (by source and id, not ref), and the
   * actions. `where` names its buttons for the focus to come back after a redraw.
   */
  const songRow = (song, where, playing, extra = []) => {
    const item = el('li');
    item.append(el('span', '', song.artist ? `${song.title} — ${song.artist}` : song.title));
    const actions = el('span', 'actions');
    if (sameSong(song, playing)) actions.append(el('span', 'tag', t.nowPlaying));
    const saved = desk.state.saved.some((key) => sameSong(key, song));
    const save = button(saved ? t.savedMark : t.saveKey, () => desk.saveKey(song), `${where}:save`);
    save.disabled = saved || !song.source || song.id === null;
    actions.append(
      button(t.details, () => { void desk.pick(song); }, `${where}:details`),
      save,
      button(t.enqueue, () => desk.enqueue(song), `${where}:enqueue`),
      ...extra,
    );
    item.append(actions);
    return item;
  };

  const renderSources = (providers) => {
    const { state } = desk;
    const choices = [
      { providerId: null, label: t.selectedChoice },
      ...providers.filter((info) => info.supports.search).map((info) => ({ providerId: info.providerId, label: info.shortName || info.displayName })),
    ];
    targetRow.replaceChildren(el('span', 'note', t.searchTarget), ...choices.map((choice) => {
      const node = button(choice.label, () => desk.setProvider(choice.providerId), `target:${choice.providerId ?? ''}`);
      node.setAttribute('aria-pressed', String(state.providerId === choice.providerId));
      return node;
    }));
    sourceList.replaceChildren(...(providers.length === 0 ? [el('li', 'note', t.noSources)] : providers.map((info) => {
      const item = el('li');
      item.append(el('span', 'value', info.displayName), el('span', 'note', info.providerId));
      if (info.selected) item.append(el('span', 'tag', t.selectedTag));
      if (info.origin === 'mod') item.append(el('span', 'tag', t.originMod));
      if (!info.configured) item.append(el('span', 'tag', t.notConfigured));
      // A flag a later host adds is simply not listed here; one that is absent reads as false.
      for (const [flag, label] of Object.entries(t.supports)) {
        item.append(el('span', info.supports[flag] ? 'note' : 'note off', label));
      }
      return item;
    })));
  };

  const renderSearch = (playing) => {
    const { search, pageSize } = desk.state;
    sizeRow.replaceChildren(el('span', 'note', t.pageSize), ...PAGE_SIZES.map((size) => {
      const node = button(String(size), () => desk.setPageSize(size), `size:${size}`);
      node.setAttribute('aria-pressed', String(pageSize === size));
      return node;
    }));
    submit.disabled = search.status === 'loading';
    searchState.textContent = search.status === 'loading'
      ? t.searching
      : search.status === 'error'
        ? t.failed(errorText(search.failure))
        : search.status === 'ready'
          ? (search.items.length === 0 ? t.searchEmpty : t.searchCount(search.items.length, search.total))
          : '';
    results.replaceChildren(...search.items.map((song, index) => songRow(song, `result:${index}`, playing)));
    moreButton.disabled = !search.nextCursor || search.status === 'loading';
  };

  const renderSong = () => {
    const { song, details, lyrics, album } = desk.state;
    if (!song) {
      songBody.replaceChildren();
      return;
    }
    const parts = [];
    const head = el('div', 'row');
    if (details?.coverUrl) {
      const cover = el('img', 'cover');
      cover.src = details.coverUrl;
      cover.alt = '';
      head.append(cover);
    }
    const title = el('div');
    title.append(el('div', 'value', song.title), el('div', 'note', song.artist), el('div', 'note', t.key(keyText(song))));
    head.append(title);
    parts.push(head);
    if (!details) {
      parts.push(el('p', 'note', t.notOnline));
    } else {
      parts.push(el('p', 'note', t.duration(details.durationMs)), el('p', 'note', t.availability(details.availability)));
      if (details.pageUrl) parts.push(el('p', 'note', t.pageUrl(details.pageUrl)));
    }

    if (lyrics.status === 'loading') parts.push(el('p', 'note', t.lyricsLoading));
    if (lyrics.status === 'none') parts.push(el('p', 'note', t.lyricsNone));
    if (lyrics.status === 'error') parts.push(el('p', 'note', t.failed(errorText(lyrics.failure))));
    if (lyrics.status === 'ready') {
      if (lyrics.isPureMusic) parts.push(el('p', 'note', t.lyricsPure));
      else if (lyrics.count === 0) parts.push(el('p', 'note', t.lyricsEmpty));
      else {
        parts.push(el('p', 'note', t.lyricsMeta(lyrics.count, lyrics.isWordByWord)));
        const list = el('ol', 'lyrics');
        // Chorus lines only show as `isChorus` on the line: there are no separate chorus spans.
        list.append(...lyrics.lines.map((line) => el('li', '', `${line.isChorus ? '♪ ' : ''}${line.fullText}`)));
        parts.push(list);
      }
    }

    const albums = details ? desk.providerOf(song.source)?.supports.albums === true : false;
    const albumButton = button(t.albumButton, () => { void desk.loadAlbum(); }, 'album');
    albumButton.disabled = !albums || album.status === 'loading';
    parts.push(albumButton);
    if (details && !albums) parts.push(el('p', 'note', t.albumNoSupport));
    if (album.status === 'loading') parts.push(el('p', 'note', t.albumLoading));
    if (album.status === 'none') parts.push(el('p', 'note', t.albumNone));
    if (album.status === 'error') parts.push(el('p', 'note', t.failed(errorText(album.failure))));
    if (album.status === 'ready') {
      parts.push(
        el('h3', '', album.album.artist ? `${album.album.name} — ${album.album.artist}` : album.album.name),
        el('p', 'note', t.albumKey(album.album)),
        el('p', 'note', t.albumCount(album.items.length, album.total, album.more)),
      );
      const list = el('ol', 'lyrics');
      list.append(...album.items.map((track, index) => el('li', '', `${index + 1}. ${track.title}`)));
      parts.push(list);
    }
    songBody.replaceChildren(...parts);
  };

  const resolutionText = (resolution) => {
    if (resolution === undefined) return t.unresolved;
    if (resolution === PENDING) return t.resolution[PENDING];
    if (resolution.status === 'failed') return t.failed(errorText({ code: resolution.code }));
    // A status a later host adds reads as `failed`.
    return t.resolution[resolution.status] ?? t.failed(t.errors.network);
  };

  const renderSaved = (playing) => {
    const { saved, resolutions, resolveFailure, lookup } = desk.state;
    savedState.textContent = resolveFailure ? t.failed(errorText(resolveFailure)) : (saved.length === 0 ? t.savedEmpty : '');
    savedList.replaceChildren(...saved.map((key, index) => {
      const resolution = resolutions.get(keyText(key));
      const remove = button(t.remove, () => desk.removeKey(key), `saved:${index}:remove`);
      if (resolution !== PENDING && resolution?.status === 'found') return songRow(resolution.song, `saved:${index}`, playing, [remove]);
      const item = el('li');
      item.append(el('span', '', `${key.title || keyText(key)} · ${resolutionText(resolution)}`), remove);
      return item;
    }));
    resolveButton.disabled = saved.length === 0 || [...resolutions.values()].includes(PENDING);

    lookupSubmit.disabled = lookup.status === 'loading';
    if (lookup.status === 'idle') {
      lookupResult.replaceChildren();
    } else if (lookup.status === 'loading') {
      lookupResult.replaceChildren(el('p', 'note', t.resolution[PENDING]));
    } else if (lookup.status === 'error') {
      lookupResult.replaceChildren(el('p', 'note', t.failed(errorText(lookup.failure))));
    } else if (lookup.resolution.status === 'found') {
      const list = el('ul', 'list');
      list.append(songRow(lookup.resolution.song, 'lookup', playing));
      lookupResult.replaceChildren(el('p', 'note', `${t.lookupFound}${keyText(lookup.key)}`), list);
    } else {
      lookupResult.replaceChildren(el('p', 'note', `${keyText(lookup.key)} · ${resolutionText(lookup.resolution)}`));
    }
  };

  const root = el('div', 'console');
  root.append(sourcesCard, searchCard, songCard, savedCard, notice);
  const style = el('style', '', STYLE);
  container.append(style, root);

  const render = () => {
    // The buttons in the lists are new on every draw: give the keyboard focus back to the same one.
    const active = container.getRootNode().activeElement;
    const focus = active && root.contains(active) ? active.dataset?.focus : undefined;
    // Both are read on every draw: neither asks anything, and the selected source changes without an event.
    const providers = folium.omni.listProviders();
    const playing = folium.playback.getState().song;
    renderSources(providers);
    renderSearch(playing);
    renderSong();
    renderSaved(playing);
    notice.textContent = desk.state.notice === 'stale' ? t.enqueueStale : '';
    if (focus && !active.isConnected) {
      [...root.querySelectorAll('[data-focus]')].find((node) => node.dataset.focus === focus)?.focus();
    }
  };
  render();
  desk.resolveOnce();

  const unsubscribe = desk.subscribe(render);
  return () => {
    unsubscribe();
    root.remove();
    style.remove();
  };
};

export default function activate(folium) {
  // A Folium 1.6 host has no folium.omni (it reads as undefined): do nothing there.
  if (folium.host.folium.minor < 7) {
    folium.log.warn('sample-omni-console needs Folium 1.7 (folium.omni)');
    return undefined;
  }
  // The export window has no home page, and every folium.omni method throws there: nothing applies.
  if (folium.env.context !== 'main') return undefined;

  const desk = createDesk(folium);
  // The "now playing" marks follow the song; stopped by the host when the mod stops.
  folium.events.on('playback.songChanged', () => desk.notify());
  folium.registries.homeTabs.register({
    id: 'console',
    label: { 'zh-CN': '在线音源', en: 'Online sources' },
    order: 320,
    mount: (container, ctx) => mountPage(folium, desk, container, ctx),
  });
  folium.registries.commands.register({
    id: 'open',
    label: { 'zh-CN': '打开在线音源', en: 'Open online sources' },
    description: { 'zh-CN': '首页里的音源列表、搜索、歌曲详情与歌词、存下的键', en: 'Sources, search, song details and lyrics, saved keys on the home page' },
    keywords: ['omni', 'search', 'lyrics', 'album', '搜索', '歌词', '专辑', '音源'],
    run: () => { folium.ui.openHomeTab('console'); },
  });
  return desk.dispose;
}
