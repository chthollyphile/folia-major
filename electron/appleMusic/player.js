// electron/appleMusic/player.js
// Runs without Node or Folia IPC in a dedicated MusicKit browser session.
(() => {
  let music;
  let loading;
  let playbackError = false;
  let login;
  let lastAuthorizationError = null;
  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('musickit-load-failed')), 30000);
      document.addEventListener('musickitloaded', () => { clearTimeout(timeout); resolve(); }, { once: true });
      script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      script.setAttribute('data-web-components', '');
      script.onerror = () => { clearTimeout(timeout); reject(new Error('musickit-load-failed')); };
      document.head.appendChild(script);
    });
    return loading;
  }
  // Only the host's fixed action protocol is exposed, never an arbitrary JavaScript evaluator.
  window.foliaMusic = async (action, input = {}) => {
    if (action === 'configure') {
      const previous = input.restorePlayback && music?.nowPlayingItem ? {
        item: music.nowPlayingItem, position: music.currentPlaybackTime || 0,
        playing: music.isPlaying, volume: music.volume,
      } : null;
      // Verify this application's token from the actual browser origin before asking for login.
      let validation;
      try {
        validation = await fetch('https://api.music.apple.com/v1/test', {
          headers: { Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(10000),
        });
      } catch { throw new Error('token-service-unavailable'); }
      if (validation.status === 401 || validation.status === 403) throw new Error('developer-token-rejected');
      if (!validation.ok) throw new Error('token-service-unavailable');
      await load();
      music = await MusicKit.configure({ developerToken: input.token, app: { name: 'Folia', build: '1' }, bitrate: 256 });
      music.addEventListener('mediaPlaybackError', () => { playbackError = true; });
      // Reconfiguration replaces the SDK instance; preserve the one item owned by Folia's queue.
      if (previous && music.isAuthorized) {
        music.autoplayEnabled = false;
        music.volume = previous.volume;
        await music.setQueue({ items: [previous.item] });
        await music.changeToMediaAtIndex(0);
        await music.seekToTime(previous.position);
        if (previous.playing) await music.play();
        else await music.pause();
      }
      return { authorized: music.isAuthorized };
    }
    if (!music) throw new Error('musickit-not-ready');
    if (action === 'authorize') {
      if (!login) {
        lastAuthorizationError = null;
        login = music.authorize().then(() => {
          if (!music.isAuthorized) throw new Error('authorization-incomplete');
          return true;
        }).catch(error => {
          // Some SDK versions reject after updating authorization; the final state wins.
          if (music.isAuthorized) return true;
          const known = ['AUTHORIZATION_ERROR', 'NETWORK_ERROR', 'TOKEN_EXPIRED', 'ACCESS_DENIED', 'SERVICE_UNAVAILABLE'];
          lastAuthorizationError = known.includes(error?.name) ? error.name : 'UNKNOWN';
          throw new Error(error?.message === 'authorization-incomplete' ? 'authorization-incomplete' : 'authorization-failed');
        }).finally(() => { login = null; });
      }
      return login;
    }
    if (action === 'status') return { authorized: music.isAuthorized, authorizationStatus: music.authorizationStatus, lastAuthorizationError };
    if (action === 'logout') { await music.unauthorize(); return true; }
    if (!music.isAuthorized) throw new Error('auth-required');
    if (action === 'api') {
      // Lyrics are served by Apple's web API, not the public catalog API used by MusicKit.
      // Keep both credentials inside this isolated session and restrict the destination.
      if (/^\/v1\/catalog\/[a-z]{2}\/songs\/\d+\/(syllable-lyrics|lyrics)$/.test(input.path)) {
        let response;
        try {
          response = await fetch(`https://amp-api.music.apple.com${input.path}?platform=web`, {
            headers: { Authorization: `Bearer ${music.developerToken}`, 'Music-User-Token': music.musicUserToken },
            signal: AbortSignal.timeout(15000), redirect: 'error',
          });
        } catch { throw new Error('lyrics-network-error'); }
        if (response.status === 404) return { data: [] };
        if (response.status === 401) throw new Error('auth-required');
        if (!response.ok) throw new Error('lyrics-service-unavailable');
        try {
          const result = await response.json();
          if (!Array.isArray(result.data)) throw new Error('invalid-response');
          return result;
        } catch { throw new Error('lyrics-service-unavailable'); }
      }
      // Writes (ratings, library adds, playlist tracks) go through the SDK's authenticated fetch.
      const write = input.method && input.method !== 'GET';
      const response = write
        ? await music.api.music(input.path, undefined, { fetchOptions: { method: input.method, body: input.body === undefined ? undefined : JSON.stringify(input.body) } })
        : await music.api.music(input.path);
      // Apple answers accepted writes with 202 and no body.
      return response?.data ?? {};
    }
    // Library items need their resource; catalog songs queue by id.
    const queueDescriptor = async id => (id.startsWith('i.')
      ? { items: (await music.api.music(`/v1/me/library/songs/${encodeURIComponent(id)}`)).data.data }
      : { song: id });
    const itemMatches = (item, id) => Boolean(item) && (item.id === id || (item.attributes?.playParams || item.playParams)?.catalogId === id);
    if (action === 'start') {
      playbackError = false;
      if (!await music.hasMusicSubscription()) throw new Error('subscription-required');
      // The queue already handed over to this item on its own; reloading it would restart the song.
      if (input.continueIfCurrent && itemMatches(music.nowPlayingItem, input.id)) {
        if (!music.isPlaying) await music.play();
        return true;
      }
      if (input.bitrate) music.bitrate = input.bitrate;
      music.autoplayEnabled = false;
      music.repeatMode = 0;
      const queue = await queueDescriptor(input.id);
      await music.setQueue(queue);
      // Explicit selection propagates loading failures that play() can silently swallow.
      await music.changeToMediaAtIndex(0);
      await music.play();
      return true;
    }
    if (action === 'queueNext') {
      if (itemMatches(music.queue?.nextPlayableItem, input.id)) return true;
      await music.playLater(await queueDescriptor(input.id));
      return true;
    }
    if (action === 'command') {
      if (input.command === 'seek') await music.seekToTime(input.value);
      else if (input.command === 'volume') music.volume = input.value;
      else await music[input.command]();
      return true;
    }
    if (action === 'snapshot') {
      if (playbackError) throw new Error('playback-failed');
      const item = music.nowPlayingItem;
      const params = item?.attributes?.playParams || item?.playParams;
      return { mediaId: item?.id || params?.id || null, catalogMediaId: params?.catalogId || null,
        position: Math.max(0, music.currentPlaybackTime || 0),
        duration: Math.max(0, music.currentPlaybackDuration || 0), playing: Boolean(music.isPlaying) };
    }
    throw new Error('invalid-action');
  };
})();
