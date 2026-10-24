const crypto = require('node:crypto');
const { takeDeviceSignIn } = require('./session.cjs');
const { NoUltraFormat, YTM_AUDIO_LEVELS, createYtmAudio } = require('./audio.cjs');
const { createYtmTokenMinter } = require('./poToken.cjs');
const tiles = require('./tiles.cjs');
const catalog = require('./catalog.cjs');
const { YtmError, describeError, toErrorResult, ytmError } = require('./errors.cjs');
const { createBrowserSignIn } = require('./browserSignIn.cjs');
const { createYtmWebSessionRepository, createYtmWebSignIn, desktopChromeName, guardAccountHeaders } = require('./webSignIn.cjs');
const webPages = require('./webPages.cjs');
const webSaves = require('./webSaves.cjs');
const { createWebExplore } = require('./webExplore.cjs');
const songVersion = require('./songVersion.cjs');

// electron/ytm/ytmApiBridge.cjs

const YTM_OPERATIONS = Object.freeze([
  'login_status', 'logout',
  'web_login_start', 'web_login_check', 'web_login_open', 'web_login_cancel',
  'search_songs', 'song_detail', 'song_detail_en', 'song_detail_zh', 'lyrics', 'album', 'artist', 'playlist', 'public_playlist', 'user_playlists', 'user_albums', 'audio',
  'explore', 'mix', 'playlist_edit', 'list_save', 'list_saved', 'song_like', 'song_versions', 'played_as',
]);

const REVOKE_URL = 'https://www.youtube.com/o/oauth2/revoke';
// What a track's plan is named as when it was made as the account of the web sign-in
// (memberPlan), in the log and to the audio side, which drops such plans with the sign-in.
const ACCOUNT_ROUTE = 'member';
// Lyrics come with line timing only in the mobile app's answer (the web one is plain text), and
// only for a recent enough app version.
const MOBILE_BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
const WATCH_URL = 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false';
const MOBILE_CLIENT = Object.freeze({ clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' });
// The app's languages as YouTube names them (`in` is the app's key for Indonesian).
const PAGE_LANGUAGES = Object.freeze({ 'zh-CN': 'zh-CN', en: 'en', in: 'id' });
const PLAYLISTS_TAB = 'FEmusic_liked_playlists';
const ALBUMS_TAB = 'FEmusic_liked_albums';
// One request changes a playlist by this many songs at most.
const MAX_EDITED_SONGS = 100;
// The lists every account has and none has made: its liked music, its liked videos and its
// watch-later list. None of them is changed as a playlist.
const ACCOUNT_LISTS = Object.freeze(['LM', 'LL', 'WL']);
// YouTube answers a save before it has made the change: an album's page showed it some 1.5 s
// later, a playlist's 4 to 4.6 s later (2026-10-07). The page is read this often, this many
// times.
const SAVE_CHECK_MS = 500;
const SAVE_CHECKS = 20;
// The player script and client version a session captured go stale; a long-running app rebuilds it.
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Building a session downloads the player script, which is slow on a poor line. A request waits
// this long for it; the build goes on, and a later request finds it done.
const SESSION_LIMIT_MS = 45000;
// A connection can stay open and silent, and a build cannot be stopped. One still unfinished
// after this long is taken for dead, and the next request starts another.
const SESSION_BUILD_LIMIT_MS = 3 * 60 * 1000;
// The request that gives a grant back to Google is given up after this long without an answer.
const REVOKE_LIMIT_MS = 15000;
// A quit during a web sign-in is held this long at most for that sign-in's folder to be removed.
const SHUTDOWN_LIMIT_MS = 3000;
// A confirmed web sign-in is told to the renderer once its account's Premium was read, or after
// this long without an answer to that read.
const MEMBERSHIP_LIMIT_MS = 10000;
// A read of the account's Premium is begun no sooner than this after the one before it.
const MEMBERSHIP_RETRY_MS = 5 * 60 * 1000;
// The audio servers send a large request at about playback speed (a 52 MB track asked for whole
// came at 40 KB/s; in pieces of this size, each took a third of a second), so a file is asked
// for in pieces. Most tracks fit in one.
const AUDIO_PIECE_BYTES = 10 * 1024 * 1024;
// The songs of this many music videos of a list are asked for at once (asShown).
const SONG_VERSION_REQUESTS = 6;
// A list waits this long at most for the songs of its music videos (asShown): about two rounds of
// those asks, each one request to the account's watch page, so a list of a dozen videos or fewer
// comes paired. A list of more is not held for several rounds: the videos not answered by then
// are shown as they are, and the next read of a list finds them paired. Not timed: the
// signed-in path cannot be run from a script.
const PAIRING_WAIT_MS = 1500;
// A music video a list showed as itself waits this long at most for its song before it is
// played (playedSongOf): twice what a list waits, since the listener chose this one track.
const PLAYED_PAIR_WAIT_MS = 3000;
// At most this many tracks are asked about with one `song_versions` (the app keeps 300 songs played).
const MAX_SONG_VERSIONS = 300;

// Both packages are ESM-only, and loading them costs a few megabytes, so they load on first use.
const loadYtmLibraries = async () => {
  const [yt, sabr, utils] = await Promise.all([
    import('youtubei.js'), import('googlevideo/sabr-stream'), import('googlevideo/utils'),
  ]);
  return {
    Innertube: yt.Innertube, Constants: yt.Constants, Platform: yt.Platform,
    Parser: yt.Parser, YTNodes: yt.YTNodes, SabrStream: sabr.SabrStream, buildSabrFormat: utils.buildSabrFormat,
    EnabledTrackTypes: utils.EnabledTrackTypes,
  };
};

const isUnauthorized = error => /status code 401\b/.test(String(error?.message));

// An answer given as to a guest where the account of the web sign-in had asked.
class AnsweredAsGuest extends Error {}
const isSignedOut = error => error instanceof AnsweredAsGuest || isUnauthorized(error);

const boundedText = (value, max) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const entityId = value => (typeof value === 'string' && /^[\w-]{2,128}$/.test(value) ? value : null);

// What the quality option's 'standard' asks for: itag 250. A guest is offered four audio formats
// (measured 2026-10-08, one public video): itag 249 Opus about 48 kbit/s, 250 Opus about 64, 251
// Opus about 130, 140 AAC about 130.
const STANDARD_ITAG = 250;
const STANDARD_BITRATE = 64000;
// 'standard' takes no format under this while another is offered: the lowest measured was about
// 48 kbit/s.
const STANDARD_FLOOR_BITRATE = 40000;
// What the quality option's 'ultra' asks for. A Premium member is offered two formats beside a
// guest's four, both marked AUDIO_QUALITY_HIGH (measured 2026-10-09, one track on one account):
// itag 774 Opus about 257 kbit/s and itag 141 AAC about 258. The Opus one goes first.
const ULTRA_ITAGS = Object.freeze([774, 141]);
const bitrateOf = format => format.average_bitrate || format.bitrate || 0;
// How much louder than YouTube's playback level the track is, in dB: YouTube turns it down by this.
// The format's figure, else the one the player is configured with for the video.
const loudnessOf = (format, info) => [format.loudness_db, info.player_config?.audio_config?.loudness_db].find(Number.isFinite) ?? null;

// Highest-bitrate audio-only format of the original track (no dub, no loudness-compressed variant).
// That is the level 'high' of the quality option. 'standard' takes, of the same original track,
// itag 250 where it is offered, else the Opus format nearest 64 kbit/s (any format where none is
// Opus). A track offered in one format plays in that one at both levels.
// 'ultra' takes, of the same original track, itag 774 or else itag 141 where it is marked
// AUDIO_QUALITY_HIGH, and nothing where neither is offered: the track is then not to be had at
// that level, and no format of another level stands in for it here.
// Those two formats are that level's alone. A member's account is offered them whatever level
// the track is asked at, and a track asked at 'high' has to be the same file whichever route
// was asked for it: the two are left out at the other levels while another format is offered.
function pickAudioFormat(formats, level = 'high') {
  const audio = formats.filter(format => format.has_audio && !format.has_video && Number(format.content_length) > 0);
  const original = audio.filter(format => !format.is_dubbed && !format.is_auto_dubbed && !format.is_drc
    && format.audio_track?.audio_is_default !== false);
  const every = original.length > 0 ? original : audio;
  if (level === 'ultra') {
    const members = every.filter(format => format.audio_quality === 'AUDIO_QUALITY_HIGH');
    return ULTRA_ITAGS.map(itag => members.find(format => format.itag === itag)).find(Boolean);
  }
  const guests = every.filter(format => !ULTRA_ITAGS.includes(format.itag));
  const offered = guests.length > 0 ? guests : every;
  if (level === 'standard') {
    const audible = offered.filter(format => bitrateOf(format) >= STANDARD_FLOOR_BITRATE);
    const opus = audible.filter(format => /opus/i.test(String(format.mime_type)));
    const among = opus.length > 0 ? opus : audible;
    const nearest = among.find(format => format.itag === STANDARD_ITAG)
      ?? [...among].sort((left, right) => Math.abs(bitrateOf(left) - STANDARD_BITRATE) - Math.abs(bitrateOf(right) - STANDARD_BITRATE))[0];
    if (nearest) return nearest;
  }
  return offered.sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0))[0];
}

// The YouTube Music host side: sign-in, credential storage, the operation whitelist the renderer
// may call, and audio delivery. Four YouTube sessions are used. Two have no account attached:
//   guest  - search, song details, albums, artists (public data);
//   player - playback as YouTube Music's web player.
// Two ask as the account of the web sign-in (webSignIn.cjs), the one sign-in there is:
//   web    - the account as YouTube Music's web client: who it is, its library, its playlists
//            and its music page, and what changes it (a list saved or taken out, a song liked,
//            the songs of an own playlist). Never playback.
//   member - the same account with the player script: the one session that sends the account's
//            cookies with a player request. It is asked for a track at the level 'ultra', whose
//            formats are offered to a Premium member's account only, by an account stored as
//            having Premium; and at the other levels, by any account that is signed in, for a
//            track the player session made no plan for (a guest is refused some, such as
//            age-restricted tracks) or whose download by that session's plan broke.
function createYtmApiBridge({
  store, safeStorage, fetch, evaluate, language = () => 'zh-CN',
  loadLibraries = loadYtmLibraries, now = Date.now, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args), sessionLimitMs = SESSION_LIMIT_MS,
  randomKey = () => crypto.randomBytes(16).toString('hex'),
  mintToken = createYtmTokenMinter({ fetch, evaluate, now }).mint,
  wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  // The web sign-in: `signInFolder()` is the folder its browser window runs on, `browserSignIn`
  // that browser, `browserName()` the User-Agent the account's requests are sent under.
  signInFolder = () => undefined, browserSignIn = createBrowserSignIn({ now, log, warn }), browserName = desktopChromeName,
}) {
  const webRepo = createYtmWebSessionRepository({ store, safeStorage, now, log, warn });
  let libraries = null;

  const library = () => {
    if (!libraries) {
      const loading = loadLibraries().then(loaded => {
        // Player code is evaluated in the sandbox window; its arguments are part of the script.
        loaded.Platform.shim.eval = data => evaluate(`(() => { ${data.output}\n })()`);
        // The parser skips a page element it does not know; its default report prints a page of source.
        loaded.Parser?.setParserErrorHandler?.(() => {});
        return loaded;
      });
      libraries = loading;
      loading.catch(() => { if (libraries === loading) libraries = null; });
    }
    return libraries;
  };

  // `pagesIn()` is the language a session is to ask for its pages in. A session asks in one
  // language for as long as it lives, so one built for another language is replaced.
  const lazySession = (name, create, pagesIn = () => undefined) => {
    let current = null;
    return {
      get() {
        const lang = pagesIn();
        if (!current || current.lang !== lang || now() - current.at > (current.built ? SESSION_MAX_AGE_MS : SESSION_BUILD_LIMIT_MS)) {
          const holder = { promise: create(lang), at: now(), built: false, lang };
          current = holder;
          holder.promise.then(() => {
            holder.built = true;
            log(`[Ytm] The ${name} session${lang ? ` (pages in ${lang})` : ''} is ready after ${now() - holder.at}ms`);
          }, error => {
            if (current === holder) current = null;
            warn(`[Ytm] The ${name} session could not be built: ${describeError(error)}`);
          });
        }
        if (current.built) return current.promise;
        const building = current;
        let limit;
        return Promise.race([
          current.promise,
          new Promise((_, reject) => {
            limit = setTimeout(() => {
              // Every request waiting for this build runs out of time; that it is slow is said once.
              reject(ytmError('network', 'YouTube Music did not answer'));
              const told = building.slow;
              building.slow = true;
              if (!told) warn(`[Ytm] The ${name} session is not ready ${now() - building.at}ms after its build began; requests stop waiting for it`);
            }, sessionLimitMs);
          }),
        ]).finally(() => clearTimeout(limit));
      },
      reset() { current = null; },
    };
  };

  // Songs, artists and albums are named as YouTube's pages name them, and the two sessions that
  // read those pages ask for them in the app's language: a song is named the same in a search and
  // in a playlist, and in the language of the rest of the interface. Each language renames some
  // artists. English romanises Chinese names ("Eason Chan"). zh-CN keeps those, in Simplified
  // characters where YouTube has them so, and gives a few Western acts a Chinese name: 1 of 20
  // tried ("绿洲合唱团" for Oasis), against 4 of 20 in zh-TW, which the app does not have. The
  // lyric sources list an artist under one name; `song_detail_en` and `song_detail_zh` give a
  // lookup the other.
  const pageLanguage = () => PAGE_LANGUAGES[language()];

  const guestSession = lazySession('guest', async lang => {
    const { Innertube } = await library();
    return Innertube.create({ lang, retrieve_player: false, fetch });
  }, pageLanguage);

  const playerSession = lazySession('player', async () => {
    const { Innertube } = await library();
    return Innertube.create({ retrieve_player: true, fetch });
  });

  // The account's headers go with this session's requests to YouTube and nowhere else.
  const accountFetch = guardAccountHeaders(fetch);
  // A session that asks as the account of a web sign-in: the library signs each request with the
  // cookie. Without `player` it loads no player script, and nothing is played through it.
  const createWebSession = async (lang, { cookie, userAgent }, player = false) => {
    const { Innertube } = await library();
    return Innertube.create({ lang, cookie, retrieve_player: player, fetch: accountFetch, user_agent: userAgent });
  };
  const webSession = lazySession('web', lang => createWebSession(lang, webRepo.get()), pageLanguage);
  // The same account with the player script, for playback as the account (memberPlan). Its
  // requests go through the same guard.
  const memberSession = lazySession('member', () => createWebSession(undefined, webRepo.get(), true));

  const audio = createYtmAudio({ loadPlan: (videoId, failed, level) => loadPlan(videoId, failed, level), now, randomKey, log, warn });

  const forgetWeb = () => {
    webRepo.clear();
    webSession.reset();
    memberSession.reset();
    // A track planned as this account is not handed out any more. What the guest's route
    // planned stays: that playback does not depend on this sign-in.
    audio.clear(ACCOUNT_ROUTE);
  };

  // Asks as YouTube Music's web client on a session of the web sign-in and gives the raw answer.
  // An answer given as to a guest is not the account's: withWeb settles what it means.
  const askWeb = async (web, endpoint, body) => {
    const { data } = await web.actions.execute(endpoint, { client: 'YTMUSIC', parse: false, ...body });
    if (webPages.signedInMarkOf(data) === '0') throw new AnsweredAsGuest('YouTube Music answered as to a guest');
    return data;
  };

  const browseWeb = (web, body) => askWeb(web, '/browse', body);

  // Sends a change as the account of the web sign-in. The answer to a change says nothing of
  // whether it was made, so only one marked as given to a signed-in account is taken for it, as
  // `accountOf` asks of a sign-in: an answer with no mark, an error's body or no body is not.
  const changeWeb = async (web, endpoint, body) => {
    const data = await askWeb(web, endpoint, body);
    if (webPages.signedInMarkOf(data) !== '1') {
      warn(`[Ytm] The answer to ${endpoint} is not marked as given to the account; the change is not taken for made`);
      throw ytmError('unavailable', 'YouTube Music did not answer as the account');
    }
    return data;
  };

  // Runs a request as the account of the web sign-in. YouTube has two ways to say that it no
  // longer takes the sign-in: status 401, and an answer given as to a guest. One such answer is
  // not proof that the sign-in is gone for good, so the account is asked for once more before
  // the stored sign-in is removed.
  // The listener may sign out or sign in anew while the request is under way, and what the
  // request then learns is not about the stored sign-in. Nor is it handed on: once the stored
  // sign-in is another, or none, the account is not asked for again here, and an answer that
  // still comes is not given to the renderer. (What `run` itself goes on to ask, it asks with
  // the cookies it began with: the reads of `list_save` after its change, for one.)
  const withWeb = async run => {
    const stored = webRepo.get();
    if (!stored) throw ytmError('auth-required', 'Sign in to YouTube Music');
    const overtaken = () => ytmError('unavailable', 'YouTube Music sign-in changed during the request');
    const web = await webSession.get();
    if (webRepo.get() !== stored) throw overtaken();
    let answer;
    try {
      answer = await run(web);
    } catch (error) {
      if (!isSignedOut(error)) throw error;
      if (webRepo.get() !== stored) throw overtaken();
      const refusedAgain = await askWeb(web, '/account/accounts_list').then(() => false, isSignedOut);
      if (webRepo.get() !== stored) throw overtaken();
      if (!refusedAgain) {
        warn('[Ytm] A request was not answered as the account, the account itself still is; the web sign-in is kept');
        throw ytmError('unavailable', 'YouTube Music did not answer as the account');
      }
      forgetWeb();
      warn('[Ytm] Google no longer accepts the stored web sign-in; it was removed');
      throw ytmError('auth-required', 'YouTube Music sign-in is no longer valid');
    }
    if (webRepo.get() !== stored) throw overtaken();
    return answer;
  };

  // Whether the account of the web sign-in has Premium is read off its account menu
  // (webPages.premiumFromMenu): when the renderer is told that a sign-in is confirmed, and with
  // a track that is asked for (for a sign-in an earlier run stored that is its first track: the
  // account may have become a member or stopped being one since).
  // This read alone stores `user.premium`. What is read is stored, and `login_status`, which
  // answers from the store alone, says it the next time. A menu that does not say, an answer
  // not marked as the account's, and a read that fails leave what is stored.
  // A read that gave an answer, yes or no, stands for the rest of the run. One that gave none is
  // made again with a later track, and so is one that gave an answer when `anew` asks for it
  // (memberPlan); no read is begun sooner than MEMBERSHIP_RETRY_MS after the one before it.
  // Resolves when the read is over, however it ended.
  let membership = null;
  const readMembership = (anew = false) => {
    const stored = webRepo.get();
    if (!stored) return Promise.resolve();
    const last = membership?.of === stored ? membership : null;
    if (last && (now() - last.at < MEMBERSHIP_RETRY_MS || (last.answered && !anew))) return last.read;
    const reading = { of: stored, at: now(), answered: false };
    reading.read = withWeb(web => askWeb(web, '/account/account_menu')).then(menu => {
      if (webRepo.get() !== stored) return;
      const premium = webPages.signedInMarkOf(menu) === '1' ? webPages.premiumFromMenu(menu) : undefined;
      if (premium === undefined) {
        warn('[Ytm] The account menu does not say whether the account has Premium; what is stored stays');
        return;
      }
      reading.answered = true;
      const changed = Boolean(stored.user.premium) !== premium;
      webRepo.setPremium(premium);
      log(`[Ytm] The account menu says Premium: ${premium ? 'yes' : 'no'}${changed ? ', which is stored in place of what was' : ''}`);
    }, error => {
      warn(`[Ytm] Whether the account has Premium could not be read: ${describeError(error)}`);
    });
    membership = reading;
    return reading.read;
  };

  // Gives the grant of a device sign-in back to Google, which ends that sign-in there.
  const revoke = async credentials => {
    try {
      const url = new URL(REVOKE_URL);
      url.searchParams.set('token', credentials.refresh_token);
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(REVOKE_LIMIT_MS) });
      if (!response.ok) warn(`[Ytm] The grant of the device sign-in could not be given back to Google (status ${response.status})`);
    } catch {
      warn('[Ytm] Google could not be reached to give back the grant of the device sign-in');
    }
  };

  // Asks YouTube, as YouTube Music's web player, how a track can be played, and resolves to
  // `{ route, mimeType, contentLength, open() }`; `open()` starts the download and yields the
  // file's bytes in order. `yt` is the session that asked, `ask()` its player request.
  // `level` is the quality level the format is picked for (pickAudioFormat). The plan names it,
  // with the format's itag and bitrate, for the log.
  const planAs = async ({ route, yt, ask, clientInfo, poToken, level }) => {
    const { SabrStream, buildSabrFormat, EnabledTrackTypes } = await library();
    let info;
    try {
      info = await ask();
    } catch (error) {
      // A removed or unknown video is reported as an exception rather than a status. (Status
      // 401 and a network that fails are not about the track, and pass as they are.)
      if (isUnauthorized(error) || toErrorResult(error).error.code === 'network') throw error;
      throw ytmError('not-playable', 'YouTube Music cannot play this track', String(error?.message));
    }
    // A track blocked in the listener's country is one more track that cannot be played: the
    // renderer's `region-restricted` stands for a whole service being out of reach, and stops the queue.
    if (info.playability_status?.status !== 'OK') {
      const { status, reason } = info.playability_status ?? {};
      // The status is one word of a fixed set (LOGIN_REQUIRED, UNPLAYABLE); with it the renderer's
      // log tells an age gate from a removed track. The sentence YouTube adds stays in this process.
      const word = /^[A-Z_]{2,40}$/.test(status) ? ` (${status})` : '';
      throw ytmError('not-playable', `YouTube Music cannot play this track${word}`,
        [status, reason].filter(Boolean).join(': ') || 'no playability status');
    }
    const formats = info.streaming_data?.adaptive_formats ?? [];
    const format = pickAudioFormat(formats, level);
    if (!format) throw level === 'ultra' ? new NoUltraFormat() : ytmError('not-playable', 'YouTube Music offered no audio for this track');
    const file = {
      route, level, itag: format.itag, bitrate: bitrateOf(format), loudnessDb: loudnessOf(format, info),
      mimeType: String(format.mime_type).split(';')[0], contentLength: Number(format.content_length),
    };

    // The web player's formats have an address of their own, which is fetched as a plain file.
    if (format.url || format.signature_cipher || format.cipher) {
      const address = new URL(await format.decipher(yt.session.player));
      address.searchParams.set('pot', poToken);
      return {
        ...file,
        async open() {
          const controller = new AbortController();
          const pieces = async function* () {
            // The next piece starts where the last one ended, whatever size the server chose to send.
            for (let start = 0; start < file.contentLength;) {
              const end = Math.min(start + AUDIO_PIECE_BYTES, file.contentLength) - 1;
              const response = await fetch(address.href, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
              if (!response.ok || !response.body) {
                controller.abort();
                throw new Error(`YouTube Music audio answered ${response.status}`);
              }
              const from = start;
              for await (const chunk of response.body) {
                start += chunk.byteLength;
                yield chunk;
              }
              if (start === from) throw new Error('YouTube Music audio sent nothing');
            }
          };
          return { stream: ReadableStream.from(pieces()), abort: () => controller.abort() };
        },
      };
    }

    // Otherwise the answer names one stream for all formats, read by playback time (SABR).
    const streamingUrl = info.streaming_data?.server_abr_streaming_url;
    const ustreamerConfig = info.player_config?.media_common_config?.media_ustreamer_request_config
      ?.video_playback_ustreamer_config;
    if (!streamingUrl || !ustreamerConfig) throw ytmError('not-playable', 'YouTube Music offered no audio for this track');
    const serverAbrStreamingUrl = await yt.session.player.decipher(streamingUrl);
    return {
      ...file,
      async open() {
        const sabrFormats = formats.map(buildSabrFormat);
        const stream = new SabrStream({
          fetch, formats: sabrFormats, serverAbrStreamingUrl, videoPlaybackUstreamerConfig: ustreamerConfig,
          clientInfo, poToken,
        });
        const { audioStream } = await stream.start({
          audioFormat: sabrFormats[formats.indexOf(format)],
          enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY, stallDetectionMs: 15000, maxRetries: 3,
        });
        return { stream: audioStream, abort: () => stream.abort() };
      },
    };
  };

  // YouTube Music's web player, with no account. Its audio is released only against a token
  // bound to the track.
  const webPlan = async (videoId, level) => {
    const [yt, poToken, { Constants }] = await Promise.all([playerSession.get(), mintToken(videoId), library()]);
    const client = Constants.CLIENTS.YTMUSIC;
    return planAs({
      route: 'web', yt, poToken, level,
      ask: () => yt.getBasicInfo(videoId, { client: 'YTMUSIC', po_token: poToken }),
      clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS[client.NAME]), clientVersion: client.VERSION },
    });
  };

  // YouTube Music's web player as the account of the web sign-in. This is the one player request
  // that carries the account's cookies. It has two uses:
  //   - at the level 'ultra', whose formats are offered to a Premium member's account only. It
  //     is then made only for an account stored as having Premium (loadMemberPlan).
  //   - at the other levels, for a track the guest's player made no plan for, and first for one
  //     whose download by the guest's plan broke (loadPlan): a guest is refused some tracks,
  //     such as age-restricted ones. Any account that is signed in is
  //     asked then, with Premium or without. Measured on a real account: this session is
  //     given, and can fetch, the 'high' format (itag 251) of a track a guest is given too.
  //     Not measured: whether it is given a track a guest is refused. No such track was tried.
  // The token is minted as the guest web player's is. The audio itself is fetched as that
  // player's is too (planAs): from the format's own address, with the app's plain fetch and a
  // Range header, so no header of the account goes to the audio servers. Nothing is reported
  // back to YouTube about what was played.
  // A playable track's answer without a format of 'ultra' does not say whether the account
  // still has Premium: a track may have none for a member too (not measured), and an answer
  // given as to a guest has none either. The track is served at 'high' (audio.cjs), and the
  // account menu is asked again: the menu decides what is stored, the track does not.
  const memberPlan = async (videoId, level) => {
    const stored = webRepo.get();
    if (!stored) throw ytmError('auth-required', 'Nobody is signed in to YouTube Music');
    if (level === 'ultra' && !stored.user.premium) throw ytmError('unavailable', 'The YouTube Music account is not stored as having Premium');
    const [yt, poToken, { Constants }] = await Promise.all([memberSession.get(), mintToken(videoId), library()]);
    // The session was built for the sign-in stored when its turn came. (A sign-in that goes
    // after this takes the plan with it: audio.cjs, `clear`.)
    if (webRepo.get() !== stored) throw ytmError('unavailable', 'YouTube Music sign-in changed during the request');
    const client = Constants.CLIENTS.YTMUSIC;
    return planAs({
      route: ACCOUNT_ROUTE, yt, poToken, level,
      ask: () => yt.getBasicInfo(videoId, { client: 'YTMUSIC', po_token: poToken }),
      clientInfo: { clientName: Number(Constants.CLIENT_NAME_IDS[client.NAME]), clientVersion: client.VERSION },
    }).catch(error => {
      if (error instanceof NoUltraFormat) void readMembership(true);
      throw error;
    });
  };

  // The level 'ultra' has that one route. Where it makes no plan, the track is not to be had
  // at that level: the guest's route is not asked in its place here, and the audio side serves
  // the track at 'high' under that level's own name (audio.cjs, `issue`).
  const loadMemberPlan = async (videoId, failed) => {
    const startedAt = now();
    const before = failed ? ` (after a broken ${failed.route} download)` : '';
    try {
      const made = await memberPlan(videoId, 'ultra');
      log(`[Ytm] Plan for ${videoId} at ultra: the ${ACCOUNT_ROUTE} route, itag ${made.itag} at ${Math.round(made.bitrate / 1000)} kbit/s, ${now() - startedAt}ms${before}`);
      return made;
    } catch (error) {
      warn(`[Ytm] No plan for ${videoId} at ultra after ${now() - startedAt}ms (${ACCOUNT_ROUTE}: ${describeError(error)})${before}`);
      throw error;
    }
  };

  // Two ways to a track's audio at 'standard' and at 'high', tried in turn. The web player with
  // no account goes first: while it works, the account stays out of playback. The same player
  // asked as the account of the web sign-in (memberPlan) is second, where somebody is signed
  // in: it stands here for what a guest is refused, such as age-restricted tracks, and whether
  // the account is given those has not been measured (see memberPlan).
  // A plan can also fail later, when its audio is fetched (a token the audio servers refuse
  // shows only there). `failed` is the track's previous plan in that case, and after a failed
  // download of the guest's plan the account is asked first. (Both routes mint their token the
  // same way: a track whose token was what the audio servers refused may be refused again.)
  // `level` is the quality level the track is asked at; each route picks its format for it.
  // ('ultra' has the account's route alone: loadMemberPlan.)
  async function loadPlan(videoId, failed, level) {
    if (level === 'ultra') return loadMemberPlan(videoId, failed);
    const routes = [webPlan, memberPlan];
    if (failed?.route === 'web') routes.reverse();
    let guestError;
    let accountError;
    const startedAt = now();
    // For the log line: what happened before the route that made the plan.
    const before = failed ? [`after a broken ${failed.route} download`] : [];
    for (const plan of routes) {
      const name = plan === webPlan ? 'web' : ACCOUNT_ROUTE;
      // Whether somebody is signed in is asked when the account's turn comes: the listener may
      // sign in or out while the guest's player is being asked.
      if (plan === memberPlan && !webRepo.get()) {
        before.push(`${name}: nobody is signed in`);
        continue;
      }
      let made;
      try {
        made = await plan(videoId, level);
      } catch (error) {
        if (plan === webPlan) guestError = error;
        else accountError = error;
        before.push(`${name}: ${describeError(error)}`);
        continue;
      }
      log(`[Ytm] Plan for ${videoId} at ${level}: the ${name} route, itag ${made.itag} at ${Math.round(made.bitrate / 1000)} kbit/s, ${now() - startedAt}ms${before.length ? ` (${before.join('; ')})` : ''}`);
      return made;
    }
    warn(`[Ytm] No plan for ${videoId} after ${now() - startedAt}ms (${before.join('; ')})`);
    // The guest's reason is the one reported, as it is where nobody is signed in: it is about
    // the track, and the listener has to do nothing about the account. A guest told to sign in
    // (LOGIN_REQUIRED, which the renderer answers with a sign-in) is the exception while somebody
    // is still signed in whose account was asked and its sign-in taken (no 401): what that
    // account's player said is reported.
    const signedIn = accountError && webRepo.get() && !isUnauthorized(accountError);
    throw signedIn && /\(LOGIN_REQUIRED\)$/.test(String(guestError?.message)) ? accountError : guestError;
  }

  // A tab of the account's library as YouTube Music's web client has it, one page of its grid
  // a call.
  const webLibraryPage = (tabId, type) => async params => {
    if (params.continuation !== undefined && !boundedText(params.continuation, 8192)) throw ytmError('invalid-response', 'Invalid page token');
    return withWeb(async web => {
      const page = webPages.readGrid(await browseWeb(web, params.continuation ? { continuation: params.continuation } : { browseId: tabId }));
      const items = page.rows.map(row => webPages.collectionFromRow(row)).filter(item => item?.type === type);
      return { items, ...(page.continuation ? { continuation: page.continuation } : {}) };
    });
  };

  // The id of an album's own page, which the renderer sends beside the id of the album's list
  // where it has one.
  const albumPageId = params => {
    if (params.albumId === undefined) return undefined;
    const id = entityId(params.albumId);
    if (!id?.startsWith('MPRE')) throw ytmError('invalid-response', 'Invalid album id');
    return id;
  };

  // The page that has a list's save button. An album's is on the album's own page only: the
  // page of the album's list has the rows and no header (2026-10-09).
  const listPage = (id, params) => albumPageId(params) ?? `VL${id}`;

  // One page of a playlist as YouTube Music's web client has it. The first page is a shelf; a
  // further one is an action that appends rows. The row that ends a page names the next one
  // (2026-10-07); the shelf's own field is where it was before.
  // `rowIds` are the ids the page gives its rows (webPages.cjs, `playlistRowsOf`), where the page
  // was read as the account: a song then carries the id of its row as `setVideoId`. Rows and
  // songs are matched song by song, in the page's order: a song is given what the page says of
  // the next row of that song, which may be no id. `trackCount` is the count the first page's
  // header names, where it names one.
  const playlistPageOf = (page, further, YTNodes, rowIds = [], trackCount) => {
    const left = [...rowIds];
    const withRow = song => {
      const at = left.findIndex(row => row.videoId === song.id);
      const setVideoId = at < 0 ? '' : left.splice(at, 1)[0].setVideoId;
      return setVideoId ? { ...song, setVideoId } : song;
    };
    const shelf = further ? undefined : page.contents_memo?.getType(YTNodes.MusicPlaylistShelf)?.[0];
    const rows = [...(further
      ? page.on_response_received_actions?.find(action => action?.type === 'AppendContinuationItemsAction')?.contents ?? []
      : shelf?.contents ?? [])];
    // Read as the end of the list, a further page in a shape not known here would cut the list short.
    if (further && rows.length === 0) throw ytmError('invalid-response', 'YouTube Music playlist page has no rows');
    // So would a first page without the shelf whose header names songs. Without a count, or with
    // a count of 0, no shelf is an empty list.
    if (!further && !shelf && trackCount > 0) throw ytmError('invalid-response', 'YouTube Music playlist page has no rows');
    const next = rows.find(row => row?.type === 'ContinuationItem')?.endpoint?.payload?.token ?? shelf?.continuation;
    return {
      items: rows.map(row => catalog.songFromListItem(row)).filter(Boolean).map(withRow),
      ...(typeof next === 'string' && next ? { continuation: next } : {}),
    };
  };

  // A track as its public watch page names it, or null when the page does not list it.
  const songOfWatchPage = (page, id, YTNodes) => {
    const entries = page.contents_memo?.getType(YTNodes.PlaylistPanelVideo) ?? [];
    const song = catalog.songFromQueueItem(entries.find(entry => entry.video_id === id));
    if (!song) return null;
    // A track asked for by its id is that track, a music video too (asShown is for lists).
    delete song.officialVideo;
    return song;
  };

  // An official music video in a list is shown and played as its song, where YouTube Music pairs
  // it with one: the song's own title, picture, album and length, and its audio, which the
  // lyrics are timed to (a video may have an intro, a scene or another mix). The pair is the one
  // YouTube Music's player switches between, which only a signed-in account's watch page holds:
  // a guest's lists keep their videos. Asked once a run for each video; a video without a song
  // stays as the list has it, and so, for this read, does one whose song could not be asked for
  // or was not answered within PAIRING_WAIT_MS. Pairs are kept for the run only, never stored.
  // (An album page's row of a video holds the album track's length and the album's picture: kept
  // so, it plays the video. The app's record of the songs played asks again, song_versions.)
  const songVersions = new Map();
  // The song of the track `videoId`, or null where it has none; a request that fails rejects and is not kept.
  // The song of a pair is a song: it has no other song of its own, and is not asked about.
  const songVersionOf = videoId => {
    if (!songVersions.has(videoId)) {
      const asked = withWeb(async web => {
        const { Parser, YTNodes } = await library();
        // (A page answered as to a guest holds no pair: askWeb refuses it, and it is not kept.)
        const page = Parser.parseResponse(await askWeb(web, '/next', { videoId }));
        const pairs = page.contents_memo?.getType(YTNodes.PlaylistPanelVideoWrapper) ?? [];
        // (A queue that does not hold the track says nothing of its song: no answer, asked again.)
        const holds = pairs.some(pair => pair?.primary?.video_id === videoId)
          || (page.contents_memo?.getType(YTNodes.PlaylistPanelVideo) ?? []).some(entry => entry.video_id === videoId);
        if (!holds) throw ytmError('invalid-response', 'The watch page does not hold the track');
        return catalog.songFromQueueItem(songVersion.songEntryOf(pairs, videoId));
      });
      songVersions.set(videoId, asked);
      asked.then(song => {
        if (song && !songVersions.has(song.id)) songVersions.set(song.id, Promise.resolve(null));
      }, () => { if (songVersions.get(videoId) === asked) songVersions.delete(videoId); });
    }
    return songVersions.get(videoId);
  };
  // The videos a song was shown in place of, and the video of each playlist row that was: a like
  // taken back, or a row removed, is the video's (song_like, playlist_edit).
  const shownFor = new Map();
  const rowVideos = new Map();
  // The official music videos lists held this run (playedSongOf).
  const listedVideos = new Set();
  // The songs of the tracks `videos`, by track (null: it has none), a few asked for at a time,
  // put in `found` as they are answered. A track whose song could not be asked for is left out;
  // a guest's all are, and so are those left once the listener signed out.
  const songsOfVideos = async (videos, found = new Map()) => {
    for (let at = 0; at < videos.length && webRepo.get(); at += SONG_VERSION_REQUESTS) {
      const batch = videos.slice(at, at + SONG_VERSION_REQUESTS);
      (await Promise.allSettled(batch.map(songVersionOf))).forEach((asked, index) => {
        if (asked.status === 'fulfilled') found.set(batch[index], asked.value);
        else warn(`[Ytm] The song of the track ${batch[index]} could not be asked for: ${describeError(asked.reason)}; it is shown as the list has it`);
      });
    }
    return found;
  };
  const songsIn = found => [...found.values()].filter(Boolean).length;
  // The rows of a list as shown, one for each song handed in: `song` as it is shown, and `video`,
  // the music video it is shown in place of, where it is one. The list waits PAIRING_WAIT_MS at
  // most for the songs of its videos; the ones still being asked for then are asked on, and their
  // answers kept for the next read.
  const pairedRows = async songs => {
    const videos = [...new Set(songs.filter(song => song.officialVideo).map(song => song.id))];
    videos.forEach(id => listedVideos.add(id));
    const found = new Map();
    const asking = songsOfVideos(videos, found);
    let limit;
    const inTime = await Promise.race([asking.then(() => true), new Promise(resolve => { limit = setTimeout(resolve, PAIRING_WAIT_MS, false); })])
      .finally(() => clearTimeout(limit));
    if (videos.length > 0 && webRepo.get()) {
      const late = videos.length - found.size;
      const shown = songsIn(found);
      log(`[Ytm] ${videos.length} music video(s) in a list, ${shown} shown as their song${inTime ? '' : `; ${late} not answered within ${PAIRING_WAIT_MS}ms are shown as they are and asked on`}`);
      if (!inTime) void asking.then(all => log(`[Ytm] The ${late} music video(s) a list showed as they are were asked on: ${songsIn(all) - shown} more have a song, shown from the next read`));
    }
    // (Read now: answers that come later are for the next read.)
    return songs.map(({ officialVideo, ...song }) => {
      const version = officialVideo ? found.get(song.id) : undefined;
      if (!version) return { song };
      shownFor.set(version.id, new Set([...(shownFor.get(version.id) ?? []), song.id]));
      if (song.setVideoId) rowVideos.set(song.setVideoId, song.id);
      return { song: song.setVideoId ? { ...version, setVideoId: song.setVideoId } : version, video: song };
    });
  };
  // A filter that keeps one row of a song that pairing made stand twice in a list (pairedRows): a
  // video beside its song, or two videos of one song. The first row stays, in its place. A song
  // the list itself holds twice stays twice.
  const oneRowEach = () => {
    // Each song's first row: whether it was shown in place of a video.
    const firstPaired = new Map();
    return ({ song, video }) => {
      const paired = firstPaired.get(song.id);
      if (paired === undefined) firstPaired.set(song.id, Boolean(video));
      return paired === undefined || (!paired && !video);
    };
  };
  const asShown = async songs => (await pairedRows(songs)).filter(oneRowEach()).map(row => row.song);
  // The song a music video a list showed as itself is played as, or null: it plays as itself.
  // The renderer plays the song in the video's place (played_as), its name, picture, length and
  // lyrics with it. Decided once a run for each video: the video played again is the same song.
  const playedSongs = new Map();
  const playedSongOf = videoId => {
    if (!listedVideos.has(videoId) || !webRepo.get()) return Promise.resolve(null);
    if (!playedSongs.has(videoId)) {
      let limit;
      // (undefined: not known in time; null: the video has no song.)
      playedSongs.set(videoId, Promise.race([
        songVersionOf(videoId),
        new Promise(resolve => { limit = setTimeout(resolve, PLAYED_PAIR_WAIT_MS, undefined); }),
      ]).catch(() => undefined).finally(() => clearTimeout(limit)).then(song => {
        if (song) log(`[Ytm] ${videoId} is a music video a list showed as itself; its song ${song.id} is played in its place`);
        else if (song === undefined) warn(`[Ytm] The song of the music video ${videoId} was not known within ${PLAYED_PAIR_WAIT_MS}ms; it is played as itself this run`);
        return song ?? null;
      }));
    }
    return playedSongs.get(videoId);
  };

  // A track as the page of one language names it. A session asks in one language only, so this
  // request names the web player and the language itself.
  const songInLanguage = async (params, hl) => {
    const id = typeof params.id === 'string' && tiles.VIDEO_ID.test(params.id) ? params.id : null;
    if (!id) throw ytmError('invalid-response', 'Invalid track id');
    const { Constants, Parser, YTNodes } = await library();
    const { NAME: clientName, VERSION: clientVersion } = Constants.CLIENTS.YTMUSIC;
    const response = await fetch(WATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName, clientVersion, hl } }, videoId: id }),
    });
    if (!response.ok) throw ytmError('unavailable', 'YouTube Music song details are unavailable');
    return songOfWatchPage(Parser.parseResponse(await response.json()), id, YTNodes);
  };

  // The account as the renderer is told it.
  const accountAnswer = user => ({ id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, vipType: user.premium ? 1 : 0 });

  const webSignIn = createYtmWebSignIn({
    browser: browserSignIn, profileDir: signInFolder, browserName, now, log, warn,
    // Asked on a session of its own, before anything is stored. An answer that is not marked as
    // given to a signed-in account means YouTube does not take the cookies.
    async accountOf(signIn) {
      const web = await createWebSession(pageLanguage(), signIn);
      const { data } = await web.actions.execute('/account/accounts_list', { client: 'YTMUSIC', parse: false });
      if (webPages.signedInMarkOf(data) !== '1') throw ytmError('unavailable', 'YouTube Music did not take the sign-in', undefined, 'not-taken');
      const user = webPages.accountFromList(data);
      if (!user) throw ytmError('invalid-response', 'YouTube Music account is missing', undefined, 'account-missing');
      return user;
    },
    keep(signIn) {
      const savedWeb = webRepo.get();
      webRepo.set(signIn);
      // The session in use asks as the account stored before; the next request builds one for this one.
      webSession.reset();
      memberSession.reset();
      // A track planned as the account stored before is not handed out any more.
      if (savedWeb) audio.clear(ACCOUNT_ROUTE);
    },
  });
  // The explore page as the account of the web sign-in (webExplore.cjs).
  const webExplore = createWebExplore({ browse: body => withWeb(web => browseWeb(web, body)), log, warn });

  // An earlier version had a second sign-in: a code typed at Google's device page, answered with
  // OAuth tokens that were stored (session.cjs). Nothing asks with those any more, so one found
  // stored is given up: its key is removed, and where its tokens could be read the grant is
  // given back to Google, which is not waited for. Looked at once a run, with its first request:
  // the keychain cannot be asked before the app is ready.
  let lookedForDeviceSignIn = false;
  const giveUpDeviceSignIn = () => {
    const left = takeDeviceSignIn({ store, safeStorage });
    if (!left) return;
    if (!left.credentials) {
      warn('[Ytm] A device sign-in of an earlier version was stored with no grant that could be read; it was removed, and nothing was given back to Google');
      return;
    }
    void revoke(left.credentials);
    log('[Ytm] A device sign-in of an earlier version was stored; it was removed, and its grant is given back to Google');
  };

  const handlers = {
    // The web sign-in (webSignIn.cjs): the listener signs in to YouTube Music in a browser of
    // their own. This answers once that browser was started; its end is what the sign-in waits for.
    web_login_start: () => webSignIn.start(),

    // How that sign-in stands: `state` is 'waiting', 'confirmed', 'expired' or 'error' (with its
    // `code`, its `message` and, where there is one, the `reason` it failed for). A confirmed one
    // comes with the account as `login_status` gives it.
    // Whether the account has Premium is read before a confirmed sign-in is told (readMembership):
    // the renderer reads the account right after, and goes on with what it is told then. A read
    // that takes longer than the limit is not waited for; what it finds is stored when it ends.
    async web_login_check() {
      const { state, user, ...failure } = webSignIn.check();
      if (state === 'confirmed') {
        let limit;
        await Promise.race([readMembership(), new Promise(resolve => { limit = setTimeout(resolve, MEMBERSHIP_LIMIT_MS); })])
          .finally(() => clearTimeout(limit));
      }
      return { state, ...(user ? { account: accountAnswer(webRepo.get()?.user ?? user) } : {}), ...failure };
    },

    // The sign-in window is seen from here only as a running browser, and that browser's end
    // settles the sign-in. So no sign-in is under way whose window is known to be closed, and
    // nothing is opened. (macOS keeps a browser running after its last window was closed, which
    // cannot be seen from here.)
    async web_login_open() {
      return {};
    },

    async web_login_cancel() {
      webSignIn.cancel();
      return {};
    },

    // Answered from the stored session: called on every app start, before anything needs the network.
    // A sign-in stored that this run cannot read is not answered as nobody: the renderer would
    // take the account for gone.
    async login_status() {
      const user = webRepo.get()?.user;
      if (user) return accountAnswer(user);
      if (webRepo.unreadable()) throw ytmError('unavailable', 'The stored YouTube Music sign-in cannot be read now');
      return null;
    },

    // Removes the sign-in from this computer. It does not end the listener's session with Google.
    async logout() {
      webSignIn.cancel('signed out');
      const saved = webRepo.get();
      forgetWeb();
      // A folder the web sign-in's browser left goes too, once that browser has ended.
      void webSignIn.sweep();
      log(`[Ytm] Signed out${saved ? '' : ' (nobody was signed in)'}`);
      return true;
    },

    async search_songs(params) {
      const guest = await guestSession.get();
      let shelf;
      if (params.continuation !== undefined) {
        if (!boundedText(params.continuation, 8192)) throw ytmError('invalid-response', 'Invalid page token');
        const page = await guest.actions.execute('/search', { continuation: params.continuation, client: 'YTMUSIC', parse: true });
        shelf = page.continuation_contents;
      } else {
        const query = boundedText(typeof params.query === 'string' ? params.query.trim() : null, 200);
        if (!query) throw ytmError('invalid-response', 'Search query is missing');
        const search = await guest.music.search(query, { type: 'song' });
        shelf = (search.contents ?? []).find(section => section?.type === 'MusicShelf');
      }
      const items = await asShown((shelf?.contents ?? []).map(item => catalog.songFromListItem(item)).filter(Boolean));
      return { items, ...(typeof shelf?.continuation === 'string' && shelf.continuation ? { continuation: shelf.continuation } : {}) };
    },

    async song_detail(params) {
      const id = typeof params.id === 'string' && tiles.VIDEO_ID.test(params.id) ? params.id : null;
      if (!id) throw ytmError('invalid-response', 'Invalid track id');
      const [guest, { YTNodes }] = await Promise.all([guestSession.get(), library()]);
      return songOfWatchPage(await guest.actions.execute('/next', { videoId: id, client: 'YTMUSIC', parse: true }), id, YTNodes);
    },

    // The same page in English and in Chinese, whatever the app's language is.
    song_detail_en: params => songInLanguage(params, 'en'),
    song_detail_zh: params => songInLanguage(params, 'zh-CN'),

    // Line-timed lyrics as LRC text, or null when the track has none.
    async lyrics(params) {
      const id = typeof params.id === 'string' && tiles.VIDEO_ID.test(params.id) ? params.id : null;
      if (!id) throw ytmError('invalid-response', 'Invalid track id');
      const guest = await guestSession.get();
      const watch = await guest.actions.execute('/next', { videoId: id, client: 'YTMUSIC', parse: false });
      const browseId = catalog.lyricsBrowseId(watch.data);
      if (!browseId) return null;
      const response = await fetch(MOBILE_BROWSE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: MOBILE_CLIENT }, browseId }),
      });
      if (!response.ok) throw ytmError('unavailable', 'YouTube Music lyrics are unavailable');
      const mainText = catalog.lrcFromLyricsPage(await response.json());
      return mainText ? { mainText } : null;
    },

    async album(params) {
      const id = entityId(params.id);
      if (!id?.startsWith('MPRE')) throw ytmError('invalid-response', 'Invalid album id');
      const guest = await guestSession.get();
      const album = catalog.albumFromPage(await guest.music.getAlbum(id), id);
      return { ...album, items: await asShown(album.items) };
    },

    async artist(params) {
      const id = entityId(params.id);
      if (!id?.startsWith('UC')) throw ytmError('invalid-response', 'Invalid artist id');
      const [guest, { YTNodes }] = await Promise.all([guestSession.get(), library()]);
      const { albumShelves, songs, ...artist } = catalog.artistFromPage(await guest.music.getArtist(id), id);
      const self = [{ id, name: artist.collection.name }];
      // A carousel shows the first few releases; its "more" page lists all of them.
      const shelves = await Promise.all(albumShelves.map(async shelf => {
        if (!shelf.more) return shelf.items;
        try {
          const page = await shelf.more.call(guest.actions, { client: 'YTMUSIC', parse: true });
          const full = (page.contents_memo?.getType(YTNodes.MusicTwoRowItem) ?? [])
            .map(item => catalog.albumFromCard(item, self)).filter(Boolean);
          return full.length > 0 ? full : shelf.items;
        } catch { return shelf.items; }
      }));
      const albums = [...new Map(shelves.flat().map(album => [album.id, album])).values()];
      return { ...artist, songs: await asShown(songs), albums };
    },

    // Playlists are read as the signed-in account, which is the only way to see private ones.
    // The page is YouTube Music's own, with the rows a guest is given for a public playlist.
    async playlist(params) {
      const id = entityId(params.id);
      if (!id) throw ytmError('invalid-response', 'Invalid playlist id');
      if (params.continuation !== undefined && !boundedText(params.continuation, 8192)) {
        throw ytmError('invalid-response', 'Invalid page token');
      }
      return withWeb(async web => {
        const { Parser, YTNodes } = await library();
        const data = await browseWeb(web, params.continuation ? { continuation: params.continuation } : { browseId: `VL${id}` });
        // The first page has the list's header, and with it the song count, where it names one.
        const trackCount = params.continuation ? undefined : webPages.playlistCountOf(data);
        const page = playlistPageOf(Parser.parseResponse(data), Boolean(params.continuation), YTNodes, webPages.playlistRowsOf(data), trackCount);
        const read = { ...page, items: await asShown(page.items) };
        // Of a list's first page only: a long list is read in many.
        if (params.continuation) return read;
        log(`[Ytm] Playlist page: ${read.items.length} song(s), ${read.items.filter(song => song.setVideoId).length} with the id of their row`);
        return trackCount === undefined ? read : { ...read, trackCount };
      });
    },

    // A playlist as a guest of YouTube Music: 100 rows a page (measured 2026-10-07), each named
    // as YouTube Music names the song, with its artists by id. A playlist that is not public has
    // no rows here.
    async public_playlist(params) {
      const id = entityId(params.id);
      if (!id) throw ytmError('invalid-response', 'Invalid playlist id');
      if (params.continuation !== undefined && !boundedText(params.continuation, 8192)) {
        throw ytmError('invalid-response', 'Invalid page token');
      }
      const [guest, { YTNodes }] = await Promise.all([guestSession.get(), library()]);
      const page = await guest.actions.execute('/browse', {
        ...(params.continuation ? { continuation: params.continuation } : { browseId: `VL${id}` }), client: 'YTMUSIC', parse: true,
      });
      const read = playlistPageOf(page, Boolean(params.continuation), YTNodes);
      return { ...read, items: await asShown(read.items) };
    },

    user_playlists: webLibraryPage(PLAYLISTS_TAB, 'playlist'),
    user_albums: webLibraryPage(ALBUMS_TAB, 'album'),

    // The shelves YouTube picks for the account, one page of shelves a call: YouTube Music's own
    // home feed and the pages after it (webExplore.cjs). `continuation` is what the answer
    // before named for the page after it. Asked as the account alone: a guest's shelves are the
    // same for everybody.
    async explore(params) {
      if (params.continuation !== undefined && !boundedText(params.continuation, 8192)) {
        throw ytmError('invalid-response', 'Invalid page token');
      }
      const read = await webExplore.page(params.continuation);
      const rows = await pairedRows(read.sections.flatMap(section => section.items.filter(item => item.kind === 'song').map(item => item.song)));
      // A shelf is a list of its own (oneRowEach): the same song on two shelves stays on both.
      const sections = read.sections.map(section => {
        const isFirst = oneRowEach();
        return {
          ...section,
          items: section.items.flatMap(item => {
            if (item.kind !== 'song') return [item];
            const row = rows.shift();
            if (!isFirst(row)) return [];
            // A song shown for a video has a square picture of its own, not the video's wide one.
            return [row.song.id === item.song.id ? { ...item, song: row.song } : { kind: 'song', song: row.song }];
          }),
        };
      });
      return { ...read, sections };
    },

    // A mix has no page: it is the queue YouTube makes up for a list id, here as a guest of
    // YouTube Music, whose queue names artist and album by id. `videoId` is the mix's first song
    // where its card names one.
    async mix(params) {
      const id = entityId(params.id);
      if (!id) throw ytmError('invalid-response', 'Invalid mix id');
      if (params.videoId !== undefined && !(typeof params.videoId === 'string' && tiles.VIDEO_ID.test(params.videoId))) {
        throw ytmError('invalid-response', 'Invalid track id');
      }
      const [guest, { YTNodes }] = await Promise.all([guestSession.get(), library()]);
      const page = await guest.actions.execute('/next', {
        playlistId: id, ...(params.videoId ? { videoId: params.videoId } : {}), client: 'YTMUSIC', parse: true,
      });
      const entries = page.contents_memo?.getType(YTNodes.PlaylistPanelVideo) ?? [];
      const rows = await pairedRows(entries.map(entry => catalog.songFromQueueItem(entry)).filter(Boolean));
      // The track the mix was asked with stays that track, as one asked for by its id does
      // (songOfWatchPage): a song's radio lists the song itself, which the renderer knows by its
      // id. Its own song, where it is a music video, is not listed beside it.
      const isSeed = row => Boolean(params.videoId) && row.video?.id === params.videoId;
      const seedSong = rows.find(isSeed)?.song.id;
      const items = rows.map(row => (isSeed(row) ? { song: row.video } : row))
        .filter(row => row.song.id !== seedSong).filter(oneRowEach()).map(row => row.song);
      log(`[Ytm] Mix ${id}: ${items.length} song(s)`);
      return { items };
    },

    // Adds songs to one of the account's own playlists, or removes them from it. A song is
    // removed by the id of its row where the request names it (`setVideoIds`, as the `playlist`
    // read gave them), and else by its own id, wherever it stands. The lists the account did not make
    // itself (`ACCOUNT_LISTS`) are refused by their ids, as `list_save` refuses the liked-music
    // list.
    async playlist_edit(params) {
      const id = entityId(params.id);
      const videoIds = typeof params.videoIds === 'string' ? params.videoIds.split(',') : [];
      // The rows to remove, one for each song and in the songs' order; '' where the row is not known.
      const rowIds = params.setVideoIds === undefined ? videoIds.map(() => '')
        : typeof params.setVideoIds === 'string' ? params.setVideoIds.split(',') : [];
      if (!id || ACCOUNT_LISTS.includes(id) || (params.action !== 'add' && params.action !== 'remove')
        || videoIds.length === 0 || videoIds.length > MAX_EDITED_SONGS || !videoIds.every(videoId => tiles.VIDEO_ID.test(videoId))
        || (params.action === 'add' && params.setVideoIds !== undefined)
        || rowIds.length !== videoIds.length || !rowIds.every(rowId => rowId === '' || webPages.ROW_ID.test(rowId))) {
        throw ytmError('invalid-response', 'Invalid playlist change');
      }
      const actions = videoIds.map((videoId, index) => (params.action === 'add'
        // Without the option YouTube adds a second copy of a song the list already has.
        ? { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_DROP_DUPLICATE' }
        : rowIds[index]
          // The row named is the one that goes: the list's other rows of the song stay. This is
          // what YouTube Music's own page sends for "remove from playlist" (as ytmusicapi does).
          // A row shown as a song in place of its video (asShown) is the video's.
          ? { action: 'ACTION_REMOVE_VIDEO', setVideoId: rowIds[index], removedVideoId: rowVideos.get(rowIds[index]) ?? videoId }
          // A song whose row is not known goes by its id, with every row of it.
          : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }));
      return withWeb(async web => {
        const status = (await changeWeb(web, '/browse/edit_playlist', { playlistId: id, actions }))?.status;
        if (status !== 'STATUS_SUCCEEDED') {
          const refusal = ytmError('unavailable', 'YouTube Music did not change the playlist', typeof status === 'string' ? status : 'no status');
          warn(`[Ytm] Playlist change refused: ${describeError(refusal)}`);
          throw refusal;
        }
        const named = rowIds.filter(Boolean).length;
        log(`[Ytm] Playlist change: ${params.action} ${videoIds.length} song(s)${named ? `, ${named} by the id of their row` : ''}`);
        return true;
      });
    },

    // Saves an album, or a playlist that is somebody else's, to the account's library, or takes it
    // out: a like of its list, after which the library's albums or playlists tab holds it. The
    // answer to the like says nothing, so the change is done once the list's page shows it;
    // whoever reads the library next then finds it made.
    // The library's own call sends the id as a bare string, which YouTube answers with 400.
    // `albumId` is the id of the album's own page, sent where the renderer has it: that page is
    // then the one read (`listPage`).
    async list_save(params) {
      const id = entityId(params.id);
      if (!id || id === 'LM' || (params.saved !== 'true' && params.saved !== 'false')) throw ytmError('invalid-response', 'Invalid list change');
      const saved = params.saved === 'true';
      const browseId = listPage(id, params);
      // Nothing is sent for a list whose page does not offer saving (a playlist the account made
      // and the liked-music list have no save button) or cannot be read. The liked-music list is
      // refused by its id as well.
      // The change and the reads after it take separate turns as the account.
      const shownAlready = await withWeb(async web => {
        const page = await browseWeb(web, { browseId });
        const shown = webSaves.savedStateOf(page);
        if (shown === undefined) {
          throw ytmError('invalid-response', 'YouTube Music does not offer to save this list');
        }
        // Nor is anything sent where the page already shows what is asked for: the change was
        // made in another client, or by an earlier request that YouTube showed too late.
        if (shown === saved) return true;
        // The like is the one the page's own save button would send: of another list than the
        // page's where the button says so, which a like of the page's id does not reach.
        const command = webSaves.saveCommandOf(page, saved);
        // The list's own id stands in for a like the button does not name only where the page
        // read is that list's. An album's own page is not: a like of the list the renderer named
        // would change a list whose page was never read.
        if (!command && browseId !== `VL${id}`) {
          warn(`[Ytm] The save button on the album page of list ${id} names no like; nothing is sent`);
          throw ytmError('invalid-response', 'YouTube Music does not offer to save this list');
        }
        if (!command) warn(`[Ytm] The save button of list ${id} names no like; the list's own id is used`);
        else if (command.playlistId !== id) log(`[Ytm] List ${id} is changed as list ${command.playlistId}, which its save button names`);
        await changeWeb(web, saved ? '/like/like' : '/like/removelike', {
          target: { playlistId: command?.playlistId ?? id }, ...(command?.params ? { params: command.params } : {}),
        });
        return false;
      });
      if (shownAlready) {
        log(`[Ytm] List ${id} is already ${saved ? 'in' : 'out of'} the library; nothing was sent`);
        return true;
      }
      return withWeb(async web => {
        for (let checks = 1; checks <= SAVE_CHECKS; checks += 1) {
          await wait(SAVE_CHECK_MS);
          // A read that fails has not shown the change, like one that shows the old state. A
          // refused sign-in is withWeb's to settle.
          const shown = await browseWeb(web, { browseId }).then(webSaves.savedStateOf, error => {
            if (isSignedOut(error)) throw error;
            return undefined;
          });
          if (shown !== saved) continue;
          log(`[Ytm] List ${id} ${saved ? 'saved to' : 'taken out of'} the library (shown after ${checks} read(s))`);
          return true;
        }
        const refusal = ytmError('unavailable', 'YouTube Music did not change the list');
        warn(`[Ytm] List ${id} still ${saved ? 'not ' : ''}in the library after ${SAVE_CHECKS} reads of its page`);
        throw refusal;
      });
    },

    // Whether the list is in the account's library, read off the save button of its page. A
    // page without that button (an own playlist's) does not say. `albumId` is as in `list_save`.
    async list_saved(params) {
      const id = entityId(params.id);
      if (!id) throw ytmError('invalid-response', 'Invalid list id');
      const browseId = listPage(id, params);
      return withWeb(async web => {
        const saved = webSaves.savedStateOf(await browseWeb(web, { browseId }));
        if (saved === undefined) throw ytmError('invalid-response', 'YouTube Music did not say whether the list is saved');
        log(`[Ytm] List ${id} is ${saved ? '' : 'not '}in the library`);
        return { saved };
      });
    },

    // Likes a song as YouTube Music's web client, or takes the like back: the song joins the
    // account's liked music, or leaves it. The answer to the like says nothing; one given to the
    // account is taken for done.
    async song_like(params) {
      const id = typeof params.id === 'string' && tiles.VIDEO_ID.test(params.id) ? params.id : null;
      if (!id || (params.liked !== 'true' && params.liked !== 'false')) throw ytmError('invalid-response', 'Invalid song like');
      const liked = params.liked === 'true';
      return withWeb(async web => {
        // A like taken back from a song shown in place of a music video (asShown) is taken back
        // from the video too: the liked music list would still show the video, as the song.
        // The videos go first and the song last, so that a failure leaves the song liked, as the
        // answer says: the like is not taken back until all of it is.
        for (const videoId of liked ? [id] : [...(shownFor.get(id) ?? []), id]) {
          await changeWeb(web, liked ? '/like/like' : '/like/removelike', { target: { videoId } });
        }
        log(`[Ytm] Song ${id} ${liked ? 'liked' : 'no longer liked'}`);
        return true;
      });
    },

    // The song the track `id` is played as in its place, or null (playedSongOf).
    async played_as(params) {
      const id = typeof params.id === 'string' && tiles.VIDEO_ID.test(params.id) ? params.id : null;
      if (!id) throw ytmError('invalid-response', 'Invalid track id');
      return { song: await playedSongOf(id) };
    },

    // The songs the tracks `ids` (comma-separated) are shown as in a list (asShown), by track:
    // null for a track with no song of its own (a song, a video somebody else uploaded); a track
    // that could not be asked about is left out. The app's own record of the songs played asks
    // about each track it holds, once: a music video may be recorded with its song's album and
    // length (an album page lists it so), and only YouTube Music can tell it.
    // A track answered this run, and the song of a pair found this run, is answered without a
    // request (songVersionOf). The renderer does not hold its page for this answer.
    async song_versions(params) {
      const ids = typeof params.ids === 'string' ? [...new Set(params.ids.split(','))] : [];
      if (ids.length === 0 || ids.length > MAX_SONG_VERSIONS || !ids.every(id => tiles.VIDEO_ID.test(id))) {
        throw ytmError('invalid-response', 'Invalid song ids');
      }
      const unknown = ids.filter(id => !songVersions.has(id)).length;
      const found = await songsOfVideos(ids);
      log(`[Ytm] ${ids.length} recorded track(s) asked about (${unknown} of them asked of YouTube): ${songsIn(found)} shown as their song, ${ids.length - found.size} not answered`);
      return { songs: Object.fromEntries(found) };
    },

    // `quality` is the level of the quality option the renderer asks at: 'standard', 'ultra',
    // and anything else is 'high'. The answer names the level the track is served at where that
    // is another one (`level`): a track that cannot be had at 'ultra' is served at 'high'.
    // (A track is also when a stored web sign-in's Premium is read, as often as readMembership
    // says. That read goes beside the track's request, which does not wait for it.)
    async audio(params) {
      void readMembership();
      return audio.issue(params.id, YTM_AUDIO_LEVELS.includes(params.quality) ? params.quality : 'high');
    },
  };

  return {
    async request(operation, params = {}) {
      if (typeof operation !== 'string' || !YTM_OPERATIONS.includes(operation)) {
        return { ok: false, error: { code: 'unsupported', message: 'Unsupported YouTube Music operation' } };
      }
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        return { ok: false, error: { code: 'invalid-response', message: 'Invalid YouTube Music request' } };
      }
      // A run that ended during a sign-in left the folder of its browser window, and with it a
      // Google session; so does a removal that failed. It is removed with the first request of
      // this run, and after a failure with a later one, until it is gone.
      webSignIn.sweepIfLeft();
      if (!lookedForDeviceSignIn) {
        lookedForDeviceSignIn = true;
        // A store that cannot be read or written leaves the key where it is: nothing reads it.
        try {
          giveUpDeviceSignIn();
        } catch (error) {
          warn(`[Ytm] The device sign-in of an earlier version could not be removed: ${describeError(error)}`);
        }
      }
      try {
        return { ok: true, data: await handlers[operation](params) };
      } catch (error) {
        // An exception of the library or the network reaches the renderer as a code and a fixed
        // sentence; its own words are kept here. What failed in a track's plan, loadPlan has said.
        if (!(error instanceof YtmError) && operation !== 'audio') warn(`[Ytm] ${operation} failed: ${describeError(error)}`);
        return toErrorResult(error);
      }
    },
    // Protocol handler for the audio scheme.
    handleAudioRequest: request => audio.handle(request),
    // The app is quitting. The browser of a sign-in under way is ended: left running it would
    // hold its folder, and with it a Google session, past this run. Answers null when there is
    // nothing to wait for. Else the quit is to be held for the promise answered: it resolves once
    // that browser has ended and its folder is removed, or after SHUTDOWN_LIMIT_MS (the folder is
    // then removed by the next run, as one that was left).
    shutdown() {
      const leaving = webSignIn.quit();
      return leaving && Promise.race([leaving, wait(SHUTDOWN_LIMIT_MS)]);
    },
  };
}

module.exports = { YTM_OPERATIONS, createYtmApiBridge, pickAudioFormat };
