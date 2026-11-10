// dev/folium/sample-account-console/client.mjs
// Folium 1.7 sample, renderer half: a settings section and a home page ("账号与消息" /
// "Account & messages") with four cards.
//
//   - Secret key: the settings section declares a `secret` field (`apiKey`) next to an ordinary
//     one (`range`). The page shows whether a value is set, as the client reads it
//     (folium.secrets.has, folium.secrets.subscribe) and as the main entry reads it (its
//     `secretStatus` message), and never the value; `settings.get()` holds `range` only.
//   - Messages from the main entry: folium.rpc.on for `heartbeat`, `pong` and `secretStatus`, then
//     one folium.rpc.call('status'), since nothing sent before the listeners were added is replayed.
//   - Account: folium.account.getState() for the selected source, redrawn on `account.changed`.
//   - Listening records: the experimental platform.raw (mod.json opts into it and declares
//     platform.netease.read) calls the `user_record` endpoint as the signed-in account. The answer
//     is the platform's raw JSON, kept under the account's `accountKey` and dropped when another
//     account takes its place.
//
// The page opens from the Grid / Bravais home navigation, or with the "Open account & messages"
// command (folium.ui.openHomeTab).
//
// A second command, "Ping the main entry", sets `globalShortcut: true` (Folium 1.7): it has no
// params, so Settings → Global shortcuts lists it after the playback commands and the user can give
// it a key. A press shows no result, so the command says what happened with folium.ui.toast; the
// `pong` the main entry pushes also lands in the page's message list.

const SECRET_KEY = 'apiKey';
// The platform whose listening records the page reads, as an Omni provider id, and its endpoint.
const RECORD_PROVIDER = 'netease';
const RECORD_ENDPOINT = 'user_record';
const MAX_MESSAGES = 20;
const MAX_RECORDS = 10;
const MESSAGE_NAMES = ['heartbeat', 'pong', 'secretStatus'];

// What the shortcut command's toast says. It runs with no page open, so there is no `ctx.locale`:
// the host's document language stands in.
const PING_TOAST = {
  zh: (sent) => `main 入口已回 pong（它共发出 ${sent} 条消息）`,
  en: (sent) => `The main entry sent a pong (${sent} messages so far)`,
};

const TEXT = {
  zh: {
    secretTitle: '密钥字段',
    secretHint: '在模组面板展开「账号与消息（样例）」，在它的设置里填写或清除。页面只显示有没有值，不显示值本身。',
    secretClient: 'client 读到',
    secretMain: 'main 入口读到',
    secretStatus: { set: '已设置', unset: '未设置', error: '读取失败', unknown: '…' },
    secretClear: '清除密钥',
    settingsKeys: (keys) => `settings.get() 里的键：${keys.join('、') || '（无）'}`,
    messagesTitle: '来自 main 入口的消息',
    messagesHint: 'main 入口每 15 秒发一条 heartbeat；点按钮时它在 rpc.handle 里回一条 pong。',
    messagesEmpty: '还没有收到消息。',
    mainStatus: (status) => `main 入口启动于 ${status.started}，取状态时已发出 ${status.sent} 条`,
    ping: '让 main 入口回一条消息',
    accountTitle: '登录状态',
    accountNone: '宿主没有选中的在线音源。',
    accountStatus: { 'signed-in': '已登录', 'signed-out': '未登录', unknown: '还不知道（宿主正在问平台）' },
    accountKey: 'accountKey',
    accountChanged: (time) => `最近一次 account.changed：${time}`,
    recordsTitle: '听歌排行（实验接口 platform.raw）',
    recordsUnsupported: '这个宿主不能直通这个平台。',
    recordsBackend: (backend) => `后端库 ${backend.name} ${backend.version}；回答跟着它变，不承诺稳定。`,
    recordsLoad: '读取',
    recordsLoading: '读取中…',
    recordsEmpty: '平台没有返回排行（可能还没有听歌记录）。',
    recordsRefused: (code, message) => `平台的回答：code ${code}${message ? `，${message}` : ''}`,
    recordsFor: (key) => `账号 ${key}`,
    plays: (count) => `${count} 次`,
    errors: {
      'not-signed-in': '没有登录这个平台。',
      'session-expired': '登录已过期，请在宿主里重新登录。',
      'endpoint-denied': '平台不开放这个接口。',
      unsupported: '这个宿主不能直通这个平台。',
      'rate-limited': '请求太频繁，稍后再试。',
      network: '连不上平台。',
      'account-changed': '请求途中换了账号，回答已丢弃。',
      'vip-required': '平台说只有会员能看。',
    },
    failed: '操作失败',
  },
  en: {
    secretTitle: 'Secret field',
    secretHint: 'Expand "账号与消息（样例）" in the mods panel and fill in or clear the key in its settings. The page shows whether a value is set, never the value.',
    secretClient: 'As the client reads it',
    secretMain: 'As the main entry reads it',
    secretStatus: { set: 'Set', unset: 'Not set', error: 'Could not read', unknown: '…' },
    secretClear: 'Clear the key',
    settingsKeys: (keys) => `Keys in settings.get(): ${keys.join(', ') || '(none)'}`,
    messagesTitle: 'Messages from the main entry',
    messagesHint: 'The main entry sends a heartbeat every 15 seconds; the button makes it send a pong from inside rpc.handle.',
    messagesEmpty: 'No message yet.',
    mainStatus: (status) => `Main entry started ${status.started}; ${status.sent} sent when asked`,
    ping: 'Ask the main entry for a message',
    accountTitle: 'Sign-in state',
    accountNone: 'The host has no online source selected.',
    accountStatus: { 'signed-in': 'Signed in', 'signed-out': 'Signed out', unknown: 'Not known yet (the host is asking the platform)' },
    accountKey: 'accountKey',
    accountChanged: (time) => `Last account.changed: ${time}`,
    recordsTitle: 'Listening records (experimental platform.raw)',
    recordsUnsupported: 'This host cannot call this platform.',
    recordsBackend: (backend) => `Backend ${backend.name} ${backend.version}; answers follow it and may change.`,
    recordsLoad: 'Load',
    recordsLoading: 'Loading…',
    recordsEmpty: 'The platform returned no ranking (maybe nothing listened to yet).',
    recordsRefused: (code, message) => `The platform answered code ${code}${message ? `: ${message}` : ''}`,
    recordsFor: (key) => `Account ${key}`,
    plays: (count) => `${count} plays`,
    errors: {
      'not-signed-in': 'Not signed in to this platform.',
      'session-expired': 'The sign-in has expired; sign in again in the app.',
      'endpoint-denied': 'The platform does not open this endpoint.',
      unsupported: 'This host cannot call this platform.',
      'rate-limited': 'Too many requests; try again later.',
      network: 'Could not reach the platform.',
      'account-changed': 'The account changed while loading; the answer was dropped.',
      'vip-required': 'The platform says only members may see this.',
    },
    failed: 'Failed',
  },
};

const STYLE = `
* { box-sizing: border-box; }
.desk {
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
.desk, .list { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, currentColor 30%, transparent) transparent; }
.card {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 14px;
  padding: 14px 16px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.8; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.note { margin: 0; font-size: 12px; opacity: 0.65; }
.value { font-weight: 600; }
.avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
  align-self: flex-start;
}
button:disabled { opacity: 0.4; cursor: default; }
button:focus-visible { outline: 2px solid var(--folium-accent, currentColor); outline-offset: 2px; }
ol, ul { list-style: none; margin: 0; padding: 0; }
.list { max-height: 260px; overflow: auto; padding-right: 8px; }
.list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 4px 0; }
.list li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { opacity: 0.6; }
@media (max-width: 720px) {
  .desk { grid-template-columns: minmax(0, 1fr); }
}
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

const shortKey = (key) => (key ? `${key.slice(0, 8)}…` : '—');

/*
 * The rows of a `user_record` answer: `weekData` for the last week, `allData` for all time, each
 * with the song and its play count. Raw platform JSON with no promise about its shape, so every
 * field is read defensively.
 */
const recordRows = (body) => {
  const rows = Array.isArray(body?.weekData) ? body.weekData : Array.isArray(body?.allData) ? body.allData : [];
  return rows.slice(0, MAX_RECORDS).map((row) => ({
    title: typeof row?.song?.name === 'string' ? row.song.name : '?',
    artist: Array.isArray(row?.song?.ar) ? row.song.ar.map((artist) => artist?.name).filter(Boolean).join(' / ') : '',
    plays: Number.isFinite(row?.playCount) ? row.playCount : 0,
  }));
};

/*
 * What the page shows, kept for as long as the mod runs (not the page): messages arrive while the
 * page is closed too. Listeners added here through folium are removed by the host when the mod
 * stops; `dispose` only drops the page's own subscription and aborts a request under way.
 */
const createDesk = (folium, section) => {
  const state = {
    clientSecret: 'unknown',
    mainSecret: 'unknown',
    mainStatus: null,
    messages: [],
    lastAccountChange: null,
    // { status: 'idle' | 'loading' | 'ready' | 'error', accountKey, rows, code, message }
    records: { status: 'idle' },
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const platform = folium.experimental['platform.raw'];
  let request = null;

  // ---- the secret field, as the client reads it
  const readClientSecret = () => folium.secrets.has(SECRET_KEY).then(
    (set) => { state.clientSecret = set ? 'set' : 'unset'; notify(); },
    (error) => {
      state.clientSecret = 'error';
      folium.log.warn('could not read the secret field', String(error));
      notify();
    },
  );
  folium.secrets.subscribe((key) => { if (key === SECRET_KEY) void readClientSecret(); });
  void readClientSecret();

  // ---- messages from the main entry: listen first, then fetch the state once
  for (const name of MESSAGE_NAMES) {
    folium.rpc.on(name, (payload) => {
      state.messages = [{ name, payload, at: Date.now() }, ...state.messages].slice(0, MAX_MESSAGES);
      if (name === 'secretStatus' && payload && typeof payload.status === 'string') state.mainSecret = payload.status;
      notify();
    });
  }
  folium.rpc.call('status').then(
    (status) => {
      state.mainStatus = status;
      if (status && typeof status.secret === 'string') state.mainSecret = status.secret;
      notify();
    },
    (error) => folium.log.warn('could not ask the main entry for its status', String(error)),
  );

  // ---- listening records, kept under the account they were read as
  const dropRecords = () => {
    request?.abort();
    request = null;
    state.records = { status: 'idle' };
  };
  folium.events.on('account.changed', (event) => {
    state.lastAccountChange = Date.now();
    if (event.providerId === RECORD_PROVIDER && event.accountKey !== state.records.accountKey) dropRecords();
    notify();
  });
  // Another range asks for another ranking.
  section.settings.onChange(() => {
    dropRecords();
    notify();
  });

  const loadRecords = async () => {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    state.records = { status: 'loading' };
    notify();
    try {
      const type = section.settings.get().range === 'all' ? 0 : 1;
      // `uid` is left out: the host fills in the signed-in account's id, so the mod never knows it.
      const { body, accountKey } = await platform.request(RECORD_PROVIDER, RECORD_ENDPOINT, { type }, { signal: controller.signal });
      const code = Number(body?.code);
      state.records = code === 200
        ? { status: 'ready', accountKey, rows: recordRows(body) }
        : { status: 'error', accountKey, code: `platform:${body?.code}`, message: typeof body?.message === 'string' ? body.message : body?.msg };
    } catch (error) {
      // aborted: the page left or the account changed; whoever aborted already reset the state.
      if (error?.code === 'aborted') return;
      state.records = { status: 'error', code: error?.code ?? 'failed', message: error instanceof Error ? error.message : String(error) };
      folium.log.warn('platform.raw request failed', state.records.code);
    } finally {
      if (request === controller) request = null;
    }
    notify();
  };

  return {
    state,
    platform,
    loadRecords,
    clearSecret: () => folium.secrets.set(SECRET_KEY, null),
    ping: () => folium.rpc.call('ping', 'from the page'),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      request?.abort();
      listeners.clear();
    },
  };
};

/* The page: four cards drawn again from the desk's state whenever it changes. */
const mountDesk = (folium, section, desk, container, ctx) => {
  const t = TEXT[ctx.locale.startsWith('zh') ? 'zh' : 'en'];
  const time = (at) => new Date(at).toLocaleTimeString(ctx.locale);
  const status = el('p', 'note');
  status.setAttribute('role', 'status');
  const report = (error) => {
    status.textContent = `${t.failed}: ${error instanceof Error ? error.message : String(error)}`;
  };

  // ---- secret
  const clientSecret = el('span', 'value');
  const mainSecret = el('span', 'value');
  const settingsKeys = el('p', 'note');
  const clearButton = button(t.secretClear, () => { desk.clearSecret().catch(report); });
  const secretCard = el('section', 'card');
  const clientRow = el('div', 'row');
  clientRow.append(el('span', '', t.secretClient), clientSecret);
  const mainRow = el('div', 'row');
  mainRow.append(el('span', '', t.secretMain), mainSecret);
  secretCard.append(el('h2', '', t.secretTitle), el('p', 'note', t.secretHint), clientRow, mainRow, settingsKeys, clearButton);

  // ---- messages
  const mainStatus = el('p', 'note');
  const messageList = el('ul', 'list');
  const pingButton = button(t.ping, () => { desk.ping().catch(report); });
  const messageCard = el('section', 'card');
  messageCard.append(el('h2', '', t.messagesTitle), el('p', 'note', t.messagesHint), mainStatus, pingButton, messageList);

  // ---- account
  const accountBody = el('div', 'row');
  const accountKey = el('p', 'note');
  const accountChanged = el('p', 'note');
  const accountCard = el('section', 'card');
  accountCard.append(el('h2', '', t.accountTitle), accountBody, accountKey, accountChanged);

  // ---- records
  const description = desk.platform.describe(RECORD_PROVIDER);
  const recordNote = el('p', 'note', description.supported ? t.recordsBackend(description.backend) : t.recordsUnsupported);
  const recordState = el('p', 'note');
  const recordList = el('ol', 'list');
  const loadButton = button(t.recordsLoad, () => { void desk.loadRecords(); });
  loadButton.disabled = !description.supported;
  const recordCard = el('section', 'card');
  recordCard.append(el('h2', '', t.recordsTitle), recordNote, loadButton, recordState, recordList);

  const render = () => {
    const { state } = desk;
    clientSecret.textContent = t.secretStatus[state.clientSecret] ?? state.clientSecret;
    mainSecret.textContent = t.secretStatus[state.mainSecret] ?? state.mainSecret;
    clearButton.disabled = state.clientSecret !== 'set';
    settingsKeys.textContent = t.settingsKeys(Object.keys(section.settings.get()));

    mainStatus.textContent = state.mainStatus ? t.mainStatus({ started: time(state.mainStatus.startedAt), sent: state.mainStatus.sent }) : '';
    messageList.replaceChildren(...(state.messages.length === 0 ? [el('li', 'note', t.messagesEmpty)] : state.messages.map((message) => {
      const row = el('li');
      row.append(el('span', '', `${message.name} ${JSON.stringify(message.payload)}`), el('span', 'muted', time(message.at)));
      return row;
    })));

    // The selected source; it can change without an account.changed, so it is read on every draw.
    const account = folium.account.getState();
    if (!account) {
      accountBody.replaceChildren(el('span', 'note', t.accountNone));
      accountKey.textContent = '';
    } else {
      const parts = [];
      if (account.user?.avatarUrl) {
        const avatar = el('img', 'avatar');
        avatar.src = account.user.avatarUrl;
        avatar.alt = '';
        parts.push(avatar);
      }
      const status = t.accountStatus[account.status] ?? account.status;
      // Without a nickname the status takes its place, so the note line names only the source.
      parts.push(el('span', 'value', account.user?.nickname ?? status));
      parts.push(el('span', 'note', account.user ? `${account.providerId} · ${status}` : account.providerId));
      accountBody.replaceChildren(...parts);
      accountKey.textContent = `${t.accountKey}: ${shortKey(account.accountKey)}`;
    }
    accountChanged.textContent = state.lastAccountChange ? t.accountChanged(time(state.lastAccountChange)) : '';

    const { records } = state;
    loadButton.disabled = !description.supported || records.status === 'loading';
    recordState.textContent = records.status === 'loading'
      ? t.recordsLoading
      : records.status === 'error'
        ? (records.code.startsWith('platform:') ? t.recordsRefused(records.code.slice('platform:'.length), records.message) : (t.errors[records.code] ?? `${records.code}: ${records.message ?? ''}`))
        : records.status === 'ready'
          ? (records.rows.length === 0 ? t.recordsEmpty : t.recordsFor(shortKey(records.accountKey)))
          : '';
    recordList.replaceChildren(...(records.status === 'ready' ? records.rows.map((row) => {
      const item = el('li');
      item.append(el('span', '', row.artist ? `${row.title} — ${row.artist}` : row.title), el('span', 'muted', t.plays(row.plays)));
      return item;
    }) : []));
  };

  const root = el('div', 'desk');
  root.append(secretCard, messageCard, accountCard, recordCard, status);
  const style = el('style', '', STYLE);
  container.append(style, root);
  render();

  // The desk tells the page about every change, `account.changed` included.
  const unsubscribe = desk.subscribe(render);
  return () => {
    unsubscribe();
    root.remove();
    style.remove();
  };
};

export default function activate(folium) {
  if (folium.host.folium.minor < 7) {
    throw new Error('sample-account-console needs Folium 1.7 (secret fields, rpc.on, folium.account, platform.raw)');
  }
  // The export window has no home page, no account and no platform.raw; nothing here applies there.
  if (folium.env.context !== 'main') return undefined;

  const section = folium.registries.settingsSections.register({
    id: 'keys',
    label: { 'zh-CN': '账号与消息', en: 'Account & messages' },
    description: { 'zh-CN': '密钥字段的值不进视觉配置导出，也不会显示出来。', en: 'The secret field is never exported with the visual config, nor shown again.' },
    settings: [
      {
        key: SECRET_KEY,
        type: 'secret',
        label: { 'zh-CN': '示范 API 密钥', en: 'Sample API key' },
        description: { 'zh-CN': '随便填一段文字试试，这个样例不会把它发到任何地方。', en: 'Type anything: this sample sends it nowhere.' },
        placeholder: 'sk-…',
      },
      {
        key: 'range',
        type: 'select',
        label: { 'zh-CN': '听歌排行的范围', en: 'Listening records range' },
        options: [
          { value: 'week', label: { 'zh-CN': '最近一周', en: 'Last week' } },
          { value: 'all', label: { 'zh-CN': '所有时间', en: 'All time' } },
        ],
        defaultValue: 'week',
      },
    ],
  });

  const desk = createDesk(folium, section);
  folium.registries.homeTabs.register({
    id: 'desk',
    label: { 'zh-CN': '账号与消息', en: 'Account & messages' },
    order: 310,
    mount: (container, ctx) => mountDesk(folium, section, desk, container, ctx),
  });
  folium.registries.commands.register({
    id: 'open',
    label: { 'zh-CN': '打开账号与消息', en: 'Open account & messages' },
    description: { 'zh-CN': '首页里的密钥状态、main 入口消息、登录状态与听歌排行', en: 'Secret status, main entry messages, sign-in state and listening records on the home page' },
    keywords: ['account', 'secret', 'rpc', '账号', '密钥', '听歌排行'],
    run: () => { folium.ui.openHomeTab('desk'); },
  });
  // Offered in Settings → Global shortcuts: no params, and the user picks the key. A throw (the main
  // entry not running, say) is recorded in this mod's row of the mods panel; nothing pops up.
  folium.registries.commands.register({
    id: 'ping',
    label: { 'zh-CN': '让 main 入口回一声', en: 'Ping the main entry' },
    description: { 'zh-CN': '可以在「设置 → 全局快捷键」里绑一个键，Folia 在后台时也能按', en: 'Bind it to a key in Settings → Global shortcuts; it works while Folia is in the background' },
    keywords: ['ping', 'pong', 'shortcut', '快捷键'],
    globalShortcut: true,
    run: async () => {
      const { sent } = await folium.rpc.call('ping', 'from a global shortcut');
      const say = PING_TOAST[document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'];
      folium.ui.toast(say(sent), { type: 'success' });
    },
  });
  return desk.dispose;
}
