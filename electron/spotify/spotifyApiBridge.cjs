const crypto = require('node:crypto');
const { createSpotifyAudio } = require('./audio.cjs');
const { createSpotifyAudioFiles } = require('./audioFiles.cjs');
const { SpotifyError, describeError, lineReason, plainWords, spotifyError, statusError, toErrorResult } = require('./errors.cjs');
const { createSpotifySessionRepository, publicAccountId } = require('./session.cjs');
const { createSpotifySignIn } = require('./signIn.cjs');

// electron/spotify/spotifyApiBridge.cjs
// Everything the app asks Spotify goes through here: the sign-in, and requests made as the
// signed-in account. The token never leaves this process.
// Spotify's public Web API answers this sign-in with 429 from the first request (measured
// 2026-10-08), so what is read comes from the two services Spotify's own apps read: the query
// service (`pathfinder`, a fixed set of named queries) and `spclient`. Either changes without
// notice; a query Spotify has replaced is answered with an error that names it, which is logged.

const SPOTIFY_OPERATIONS = Object.freeze([
  'login_start', 'login_check', 'login_cancel', 'login_open', 'login_status', 'logout', 'query', 'radio', 'lyrics', 'audio', 'audio_kept',
  'audio_keep', 'library', 'playlist_edit', 'playlist_create',
]);
// The queries the renderer may send, each with the hash Spotify knows it by (read 2026-10-08).
const QUERIES = Object.freeze({
  home: '3357ffed7961629ba92b4e0a41514e4d5004a14355c964c23ce442205c9e44a1',
  homeSection: 'd62af2714f2623c923cc9eeca4b9545b4363abaa9188a9e94e2b63b823419a2c',
  browsePage: 'f5c4e6d668f5716464a231c1cc8b22c1cbf6ad68b09929fd7de813a30581298b',
  queryWhatsNewFeed: '3b53dede3c6054e8b7c962dd280eb6761c5d1c82b06b039f4110d76a62b4966b',
  profileAttributes: '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3: '390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist: 'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
  getAlbum: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
  queryArtistOverview: '7f86ff63e38c24973a2842b672abe44c910c1973978dc8a4a0cb648edef34527',
  queryArtistDiscographyAll: '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',
  searchTracks: 'bc1ca2fcd0ba1013a0fc88e6cc4f190af501851e3dafd3e1ef85840297694428',
  getTrack: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
  areEntitiesInLibrary: '134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed',
});
// The changes made to the account's library and to its playlists, each with the hash Spotify
// knows it by (read 2026-10-08). The renderer does not send these: it names a thing and what
// is to become of it.
const CHANGES = Object.freeze({
  addToLibrary: '896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148',
  removeFromLibrary: '896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148',
  addItemsToRootlist: 'bd9c5cae1ee80ebca05d7ed12fd394216f49a20ce72d9dc762868df0f14522ea',
  removeItemsFromRootlist: '3422f1866532820a1d8d0560f88542dbdbd35d0377ee5ecd49593590f5f1e86b',
  addToPlaylist: '47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990',
  removeFromPlaylist: '47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990',
});
// What the library takes: a song, an album, a playlist.
const LIBRARY_URI = /^spotify:(track|album|playlist):[0-9A-Za-z]{22}$/;
const PLAYLIST_URI = /^spotify:playlist:[0-9A-Za-z]{22}$/;
// A playlist is read whole before its songs are changed, this many rows a request and for this
// many requests at most (how many rows Spotify gives at once is not known: the reading goes on
// by the rows given).
const LIST_ROWS = 500;
const LIST_MAX_REQUESTS = 40;
const MAX_SONGS_A_CHANGE = 100;
// Spotify's own limit for a playlist's name.
const MAX_NAME_LENGTH = 100;
// The renderer has no use for the query that names the account, and is not given it: it learns
// who is signed in from `login_status`, which leaves Spotify's own name for the account out.
const RENDERER_QUERIES = Object.freeze(Object.keys(QUERIES).filter(name => name !== 'profileAttributes'));
const QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const SPCLIENT_URL = 'https://spclient.wg.spotify.com';
// Pages are asked for in the app's language: headings and playlist names follow it.
const PAGE_LANGUAGES = Object.freeze({ 'zh-CN': 'zh-CN', en: 'en', in: 'id' });
const MAX_VARIABLES_LENGTH = 4096;
// A token is renewed this long before Spotify would refuse it.
const RENEW_AHEAD_MS = 60 * 1000;
// A request that is not answered in this time has failed; without a limit it could wait for ever.
const REQUEST_LIMIT_MS = 30 * 1000;
// A quit waits this long at most for a token renewal under way (`shutdown`).
const SHUTDOWN_LIMIT_MS = 3000;
// The account (its name, and whether it pays) is read again at most this often.
const ACCOUNT_MAX_AGE_MS = 10 * 60 * 1000;
// After Spotify approved a sign-in, a read of its account that failed on the line is made again
// with the next poll for this long from the first read; then the sign-in ends.
const ACCOUNT_RETRY_MS = 60 * 1000;
// An account read as free is read again this soon when it asks for a track: it may have begun to pay.
const PLAN_RECHECK_MS = 30 * 1000;
// The file Spotify is asked for at each of the app's quality levels, in kbit/s (Ogg Vorbis).
const BITRATES = Object.freeze({ standard: 160, high: 320, lossless: 320, hires: 320 });
// What this installation is called to Spotify when it plays: made once, at random, and kept.
const DEVICE_KEY = 'SPOTIFY_DEVICE_ID';
const TRACK_ID = /^[0-9A-Za-z]{22}$/;

// `audioDirectory()` is where the audio files kept on disk are; without it none is kept.
// `onAudioKept(limitBytes)` is called after one was written, with the size the media cache is
// to stay under.
function createSpotifyApiBridge({
  store, safeStorage, fetch, openExternal, language = () => 'zh-CN', now = Date.now,
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args), signIn: givenSignIn, openSession,
  audioDirectory, onAudioKept, wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
}) {
  const repo = createSpotifySessionRepository({ store, safeStorage, log, warn });
  const signIn = givenSignIn ?? createSpotifySignIn({ fetch, openExternal, language, now, log, warn });
  let renewing = null;
  let adopting = false;
  // The approved sign-in whose account is being read, and when it was first asked for.
  let approved = null;
  let accountReadAt = 0;
  // The read of the account that is under way, what Spotify last said of the plan (for the
  // log), and whether the stored plan is Spotify's own word or only what was kept from before.
  let accountRead = null;
  let planWords = 'not read';
  let planKnown = false;

  // Renews the stored token, once for all the requests of one sign-in that find it old. The answer
  // is stored only if that sign-in is still the one held; a request of the next sign-in does not
  // join a renewal begun for the one before.
  const renew = session => {
    const token = session.credentials.refresh_token;
    if (renewing?.token === token) return renewing.answer;
    const answer = signIn.renew(token).then(credentials => {
      if (repo.get()?.credentials.refresh_token === token) {
        repo.update({ credentials });
        log(`[Spotify] Token renewed, good for ${Math.round((credentials.expires_at - now()) / 1000)} s`);
      }
      return credentials.access_token;
    }, error => {
      if (error instanceof SpotifyError && error.code === 'auth-required' && repo.get()?.credentials.refresh_token === token) {
        repo.clear();
        audio.clear();
        warn('[Spotify] Spotify no longer accepts the stored sign-in; it was removed');
      }
      throw error;
    }).finally(() => { if (renewing?.answer === answer) renewing = null; });
    renewing = { token, answer };
    return answer;
  };
  const accessToken = async (fresh = false) => {
    const session = repo.get();
    if (!session) throw spotifyError('auth-required', 'Spotify sign-in is required');
    if (!fresh && session.credentials.expires_at - now() > RENEW_AHEAD_MS) return session.credentials.access_token;
    return renew(session);
  };

  // One request as the account. `token` is given for the account that is only now signing in.
  // A 401 is answered once with a renewed token; `absent` is what a 404 reads as.
  const call = async (url, { token, absent, ...init } = {}) => {
    const send = async bearer => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_LIMIT_MS), headers: {
      Accept: 'application/json', 'Accept-Language': PAGE_LANGUAGES[language()] ?? 'en', ...init.headers, Authorization: `Bearer ${bearer}`,
    } });
    let response = await send(token ?? await accessToken());
    if (response.status === 401 && !token) response = await send(await accessToken(true));
    if (response.status === 404 && absent !== undefined) return absent;
    if (!response.ok) throw statusError(response.status, 'unavailable', 'Spotify refused the request', `HTTP ${response.status}`);
    return response.json();
  };

  // One named operation of the query service: its `data`, and what Spotify said went wrong.
  const ask = async (name, hash, variables, token) => {
    const answer = await call(QUERY_URL, {
      token, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables, operationName: name, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }),
    });
    const said = Array.isArray(answer?.errors) ? answer.errors.map(error => error?.message).filter(Boolean).join(' | ').slice(0, 160) : '';
    return { data: answer?.data, said, refused: Array.isArray(answer?.errors) && answer.errors.length > 0 };
  };
  const query = async (name, variables, token) => {
    const { data, said } = await ask(name, QUERIES[name], variables, token);
    if (!data) throw spotifyError('invalid-response', 'Spotify did not answer the query', `${name}: ${said || 'no data'}`);
    if (said) warn(`[Spotify] ${name} was answered in part: ${plainWords(said)}`);
    return data;
  };
  // A change has been made only when Spotify answers it without an error and names its result:
  // a refused one comes back with status 200 and an error beside empty data.
  const change = async (name, variables) => {
    const { data, said, refused } = await ask(name, CHANGES[name], variables);
    const results = data && typeof data === 'object' ? Object.values(data) : [];
    if (refused || results.length === 0 || results.some(result => result === null)) {
      throw spotifyError('unavailable', 'Spotify refused the change', `${name}: ${said || 'no result'}`);
    }
  };

  // What a playlist holds: the rows of each song (a song put in twice has two), by the song's
  // uri. A row is taken out by its own id, and a song Spotify is asked to put in is put in
  // again, so both changes begin here. Refuses a playlist whose songs the account may not change.
  // Only a whole read will do: from part of a playlist a song would be put in twice, or one
  // reported taken out that is still there. So an answer Spotify gave in part (it says so beside
  // the data), one without the rows, and a playlist longer than is read here are all refused.
  const playlistRows = async uri => {
    const rows = new Map();
    let offset = 0;
    for (let request = 0; request < LIST_MAX_REQUESTS; request += 1) {
      const { data, said, refused } = await ask('fetchPlaylist', QUERIES.fetchPlaylist, { uri, offset, limit: LIST_ROWS, enableWatchFeedEntrypoint: false });
      const list = data?.playlistV2;
      if (refused || !list) throw spotifyError('invalid-response', 'Spotify did not give the playlist whole', `fetchPlaylist: ${said || 'no data'}`);
      if (list.currentUserCapabilities?.canEditItems !== true) {
        throw spotifyError('unsupported', 'The account may not change the songs of this playlist');
      }
      const items = list.content?.items;
      if (!Array.isArray(items)) throw spotifyError('invalid-response', 'Spotify did not give the playlist\'s rows');
      for (const item of items) {
        const song = item?.itemV2?.data?.uri;
        // (A row without an id of its own still means the playlist holds the song.)
        if (typeof song === 'string') rows.set(song, [...(rows.get(song) ?? []), ...(typeof item.uid === 'string' ? [item.uid] : [])]);
      }
      offset += items.length;
      const total = list.content.totalCount;
      if (items.length === 0 || (typeof total === 'number' && offset >= total)) return rows;
    }
    throw spotifyError('unavailable', 'The playlist is too long to change from here', `more than the ${offset} rows read`);
  };

  // Who is signed in, and whether the account pays: Spotify plays its own audio for paying accounts only.
  const readAccount = async token => {
    const [profile, state] = await Promise.all([
      query('profileAttributes', {}, token),
      call(`${SPCLIENT_URL}/melody/v1/product_state?market=from_token`, { token }).catch(error => {
        warn(`[Spotify] The account's plan could not be read: ${describeError(error)}`);
        return null;
      }),
    ]);
    planWords = state ? `catalogue ${state.catalogue}, product ${state.product}` : 'not read';
    const me = profile?.me?.profile;
    if (typeof me?.username !== 'string' || !me.username) throw spotifyError('invalid-response', 'Spotify did not name the account');
    const pictures = Array.isArray(me.avatar?.sources) ? me.avatar.sources : [];
    const largest = pictures.reduce((best, picture) => ((picture?.width ?? 0) > (best?.width ?? -1) ? picture : best), null);
    return {
      id: publicAccountId(me.username), nickname: String(me.name || 'Spotify'), avatarUrl: typeof largest?.url === 'string' ? largest.url : '',
      // Not known when the plan could not be read: a paying account must not be taken for a free one.
      premium: state ? state.catalogue === 'premium' || state.product === 'premium' : undefined,
    };
  };
  // An account that began to pay, or stopped, is noticed without a new sign-in.
  // A read under way answers every caller: one that asks a moment after it began must not go on
  // with what was stored before it.
  const refreshAccount = (maxAgeMs = ACCOUNT_MAX_AGE_MS) => {
    const session = repo.get();
    if (!session) return Promise.resolve();
    if (accountRead) return accountRead;
    if (now() - accountReadAt < maxAgeMs) return Promise.resolve();
    accountReadAt = now();
    const reading = readAccount().then(read => {
      if (repo.get()?.credentials.refresh_token !== session.credentials.refresh_token) return;
      planKnown = read.premium !== undefined;
      const user = { ...read, premium: read.premium ?? session.user.premium };
      if (user.premium !== session.user.premium) log(`[Spotify] The account's plan changed (Premium: ${user.premium ? 'yes' : 'no'})`);
      repo.update({ user });
    }, error => {
      planKnown = false;
      warn(`[Spotify] The account could not be read again: ${describeError(error)}`);
    }).finally(() => { if (accountRead === reading) accountRead = null; });
    accountRead = reading;
    return reading;
  };

  const deviceId = () => {
    const kept = store.get(DEVICE_KEY);
    if (typeof kept === 'string' && /^[0-9a-f]{40}$/.test(kept)) return kept;
    const made = crypto.randomBytes(20).toString('hex');
    store.set(DEVICE_KEY, made);
    return made;
  };
  const audioFiles = audioDirectory ? createSpotifyAudioFiles({ directory: audioDirectory }) : null;
  const audio = createSpotifyAudio({
    accessToken: () => accessToken(), deviceId, fetch, now, log, warn, disk: audioFiles, onKept: onAudioKept,
    ...(openSession ? { openSession } : {}),
  });

  const handlers = {
    async login_start() {
      return signIn.start();
    },

    async login_open(params) {
      return signIn.open(params.key);
    },

    async login_check(params) {
      const state = signIn.check(params.key);
      if (state.state !== 'approved') return state;
      // The renderer asks again while the account is being read.
      if (adopting) return { state: 'waiting' };
      adopting = true;
      if (approved?.key !== params.key) approved = { key: params.key, since: now() };
      try {
        const read = await readAccount(state.tokens.access_token);
        // Cancelled while the account was being read.
        if (!signIn.holds(params.key)) return { state: 'expired' };
        repo.set({ credentials: state.tokens, user: { ...read, premium: read.premium === true } });
        audio.clear();
        // A plan that could not be read is asked for again the next time the sign-in is read.
        accountReadAt = read.premium === undefined ? 0 : now();
        planKnown = read.premium !== undefined;
        signIn.finish(params.key);
        log(`[Spotify] Signed in (Premium: ${read.premium === undefined ? 'not known yet' : read.premium ? 'yes' : 'no'})`);
        return { state: 'confirmed' };
      } catch (error) {
        warn(`[Spotify] The account could not be read after Spotify approved the sign-in: ${describeError(error)}`);
        // Spotify has approved: a line that failed for a moment must not send the person back to
        // the browser. The next poll reads the account again, up to ACCOUNT_RETRY_MS after the
        // first read; a line that is down longer ends the sign-in, with why.
        const told = toErrorResult(error).error;
        const onTheLine = lineReason(error);
        if (onTheLine && signIn.holds(params.key) && now() - approved.since < ACCOUNT_RETRY_MS) return { state: 'waiting' };
        signIn.finish(params.key);
        // The renderer is told where the sign-in stopped: approved, and the account then not read
        // (or, where the line failed, why it was not).
        throw spotifyError(told.code, told.message, error?.detail ?? error?.message, onTheLine ?? 'account-not-read');
      } finally {
        adopting = false;
      }
    },

    async login_cancel(params) {
      if (signIn.holds(params.key)) signIn.cancel();
      return true;
    },

    // Answered from the stored session: called on every app start, before anything needs the network.
    // A sign-in stored that this run cannot read is not answered as nobody: the renderer would
    // take the account for gone.
    async login_status() {
      const user = repo.get()?.user;
      if (!user) {
        if (repo.unreadable()) throw spotifyError('unavailable', 'The stored Spotify sign-in cannot be read now');
        return null;
      }
      refreshAccount();
      return { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, vipType: user.premium ? 1 : 0 };
    },

    // Spotify has no request that takes a grant back; the tokens are forgotten here.
    async logout() {
      signIn.cancel();
      const saved = repo.get();
      repo.clear();
      audio.clear();
      log(`[Spotify] Signed out${saved ? '' : ' (nobody was signed in)'}`);
      return true;
    },

    async query(params) {
      if (!RENDERER_QUERIES.includes(params.name)) throw spotifyError('unsupported', 'Unsupported Spotify query');
      const variables = params.variables ?? {};
      if (typeof variables !== 'object' || Array.isArray(variables) || JSON.stringify(variables).length > MAX_VARIABLES_LENGTH) {
        throw spotifyError('invalid-response', 'Invalid Spotify query');
      }
      return query(params.name, variables);
    },

    // The playlist Spotify keeps of the songs like one song (50 of them, measured 2026-10-08).
    async radio(params) {
      if (typeof params.id !== 'string' || !TRACK_ID.test(params.id)) throw spotifyError('invalid-response', 'Invalid Spotify track');
      const answer = await call(`${SPCLIENT_URL}/inspiredby-mix/v2/seed_to_playlist/spotify:track:${params.id}?response-format=json`, { absent: null });
      const uri = answer?.mediaItems?.[0]?.uri;
      return typeof uri === 'string' && uri.startsWith('spotify:playlist:') ? { uri } : null;
    },

    // A URL of the app's own for the track's audio. Spotify gives its audio to paying accounts
    // only (its rule for every player that is not its own), so a free account is refused here.
    async audio(params) {
      if (typeof params.id !== 'string' || !TRACK_ID.test(params.id)) throw spotifyError('invalid-response', 'Invalid Spotify track');
      if (!repo.get()) throw spotifyError('auth-required', 'Spotify sign-in is required');
      if (!repo.get().user.premium) await refreshAccount(PLAN_RECHECK_MS);
      // The read may have found that Spotify no longer accepts the sign-in, and removed it.
      if (!repo.get()) throw spotifyError('auth-required', 'Spotify sign-in is required');
      // Refused only on Spotify's own word that the account does not pay. A plan that could not
      // be read is not that word: the track is asked for, and the playback component finds out.
      if (!repo.get().user.premium && planKnown) {
        throw spotifyError('subscription-required', 'Spotify plays for Premium accounts only', `the plan read as ${planWords}`);
      }
      return audio.issue(params.id, BITRATES[params.quality] ?? BITRATES.high);
    },

    // Whether the file one of those URLs plays is kept on disk, and keeping it there (asked
    // while song caching is on). The file is written as Spotify sends it, encrypted; its key is
    // not written, so it opens only while a paying account is signed in.
    async audio_kept(params) {
      return audio.kept(params.url);
    },

    async audio_keep(params) {
      return audio.keep(params.url, params.limitBytes);
    },

    // Puts one thing into the account's library or takes it out: a liked song, a kept album, a
    // followed playlist. Songs and albums go by one pair of changes, playlists by another (the
    // first refuses a playlist). Each was made and undone on 2026-10-08.
    async library(params) {
      const kind = typeof params.uri === 'string' ? LIBRARY_URI.exec(params.uri)?.[1] : undefined;
      if (!kind || typeof params.saved !== 'boolean') throw spotifyError('invalid-response', 'Invalid Spotify library change');
      if (kind === 'playlist') {
        // Taking one of the account's own playlists out of its library removes the playlist for
        // the account. Whose a playlist is, is asked of Spotify here, where the change is made:
        // the card the renderer holds does not always say (a card of the home page does not).
        const list = (await query('fetchPlaylist', { uri: params.uri, offset: 0, limit: 1, enableWatchFeedEntrypoint: false })).playlistV2;
        const owner = list?.ownerV2?.data?.username;
        if (typeof owner !== 'string' || !owner) throw spotifyError('unsupported', 'Spotify did not say whose the playlist is');
        if (publicAccountId(owner) === repo.get()?.user.id || list.currentUserCapabilities?.canAdministratePermissions === true) {
          throw spotifyError('unsupported', 'The playlist is the account\'s own');
        }
        await change(params.saved ? 'addItemsToRootlist' : 'removeItemsFromRootlist', { uris: [params.uri] });
      } else {
        await change(params.saved ? 'addToLibrary' : 'removeFromLibrary', { libraryItemUris: [params.uri] });
      }
      log(`[Spotify] One ${kind} was ${params.saved ? 'added to' : 'taken out of'} the library`);
      return true;
    },

    // Puts songs into a playlist the account may change, or takes them out. A song the playlist
    // holds is not put in a second time (Spotify itself would); taking a song out takes every
    // row of it. Made and undone on a playlist made for the trial, 2026-10-08.
    async playlist_edit(params) {
      const uri = `spotify:playlist:${params.id}`;
      const ids = Array.isArray(params.tracks) ? [...new Set(params.tracks)] : [];
      if (!PLAYLIST_URI.test(uri) || !['add', 'remove'].includes(params.action) || ids.length === 0 || ids.length > MAX_SONGS_A_CHANGE
        || !ids.every(id => typeof id === 'string' && TRACK_ID.test(id))) {
        throw spotifyError('invalid-response', 'Invalid Spotify playlist change');
      }
      const rows = await playlistRows(uri);
      const songs = ids.map(id => `spotify:track:${id}`);
      if (params.action === 'add') {
        const fresh = songs.filter(song => !rows.has(song));
        if (fresh.length > 0) {
          await change('addToPlaylist', { playlistItemUris: fresh, playlistUri: uri, newPosition: { moveType: 'BOTTOM_OF_PLAYLIST', fromUid: null } });
        }
        log(`[Spotify] ${fresh.length} of ${songs.length} songs were put in a playlist${fresh.length < songs.length ? '; it held the others' : ''}`);
      } else {
        const uids = songs.flatMap(song => rows.get(song) ?? []);
        if (uids.length > 0) await change('removeFromPlaylist', { playlistUri: uri, uids });
        log(`[Spotify] ${uids.length} rows of ${songs.length} songs were taken out of a playlist`);
      }
      return true;
    },

    // A new playlist of the account's, empty. Spotify makes a playlist and puts it in the
    // account's library in two steps; one that failed at the second is in no library.
    async playlist_create(params) {
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      if (!name || name.length > MAX_NAME_LENGTH) throw spotifyError('invalid-response', 'Invalid Spotify playlist name');
      const made = await call(`${SPCLIENT_URL}/playlist/v2/playlist?format=json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: [{ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { name } } } }] }),
      });
      if (typeof made?.uri !== 'string' || !PLAYLIST_URI.test(made.uri)) throw spotifyError('invalid-response', 'Spotify did not name the new playlist');
      await change('addItemsToRootlist', { uris: [made.uri] });
      log('[Spotify] A playlist was made and put in the library');
      return { uri: made.uri };
    },

    // Spotify's own lyrics, timed by line. Without the platform header the service answers 400.
    async lyrics(params) {
      if (typeof params.id !== 'string' || !TRACK_ID.test(params.id)) throw spotifyError('invalid-response', 'Invalid Spotify track');
      const answer = await call(`${SPCLIENT_URL}/color-lyrics/v2/track/${params.id}?format=json&vocalRemoval=false&market=from_token`,
        { absent: null, headers: { 'app-platform': 'WebPlayer' } });
      const lines = Array.isArray(answer?.lyrics?.lines) ? answer.lyrics.lines : [];
      if (lines.length === 0) return null;
      return {
        timed: answer.lyrics.syncType === 'LINE_SYNCED',
        lines: lines.map(line => ({ startMs: Number(line?.startTimeMs) || 0, words: String(line?.words ?? '') })),
      };
    },
  };

  return {
    handleAudioRequest: request => audio.handle(request),
    // The audio files kept on disk, for the media cache to count, prune and clear: `list()`,
    // `remove(name)`, `clear()`.
    audioFiles,

    async request(operation, params = {}) {
      if (typeof operation !== 'string' || !SPOTIFY_OPERATIONS.includes(operation)) {
        return { ok: false, error: { code: 'unsupported', message: 'Unsupported Spotify operation' } };
      }
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        return { ok: false, error: { code: 'invalid-response', message: 'Invalid Spotify request' } };
      }
      try {
        return { ok: true, data: await handlers[operation](params) };
      } catch (error) {
        // The renderer gets a code and a fixed sentence; what Spotify or the network said is kept here.
        warn(`[Spotify] ${operation}${operation === 'query' ? ` ${String(params.name).slice(0, 40)}` : ''} failed: ${describeError(error)}`);
        return toErrorResult(error);
      }
    },
    // The app is quitting. A token renewal under way is waited for: its answer is stored only
    // once it has come, and the refresh token it replaces may not be taken by the next run.
    // Answers null when there is nothing to wait for. Else the quit is to be held for the promise
    // answered: it resolves once the renewal was stored, or failed, or after SHUTDOWN_LIMIT_MS.
    shutdown() {
      return renewing && Promise.race([renewing.answer.then(() => {}, () => {}), wait(SHUTDOWN_LIMIT_MS)]);
    },
  };
}

module.exports = { SPOTIFY_OPERATIONS, QUERIES, CHANGES, createSpotifyApiBridge };
