const { publicAccountId } = require('./session.cjs');
const { thumbnailUrl } = require('./catalog.cjs');

// electron/ytm/webPages.cjs
// Reads the raw JSON YouTube Music's web client is answered with as the account of the web
// sign-in: whether an answer was given to a signed-in account, who that account is, whether it
// has Premium, the playlist and album cards of the library's tabs, and the song count a playlist's
// page names. (The rows of a playlist's own page are read with youtubei.js's parser, as the guest
// read of the same page is.)

const textOf = node => {
  if (typeof node?.simpleText === 'string') return node.simpleText;
  return Array.isArray(node?.runs) ? node.runs.map(run => run?.text ?? '').join('') : '';
};

// What an answer says about who asked: '1' for a signed-in account, '0' for nobody. YouTube
// answers a request whose sign-in it does not take with status 200 and a guest's page, so this
// mark is what tells the two apart (2026-10-08: '1' on 14 signed-in reads, '0' on a guest's).
function signedInMarkOf(data) {
  const feedback = (data?.responseContext?.serviceTrackingParams ?? []).find(service => service?.service === 'GFEEDBACK');
  const mark = (feedback?.params ?? []).find(param => param?.key === 'logged_in')?.value;
  return typeof mark === 'string' ? mark : undefined;
}

// The account an /account/accounts_list answer names, in the shape a sign-in stores it; null
// when it names none. The answer also holds the account's e-mail address, which is not read.
function accountFromList(data) {
  const accounts = [];
  for (const action of data?.actions ?? []) {
    for (const section of action?.getMultiPageMenuAction?.menu?.multiPageMenuRenderer?.sections ?? []) {
      for (const group of section?.accountSectionListRenderer?.contents ?? []) {
        for (const entry of group?.accountItemSectionRenderer?.contents ?? []) {
          if (entry?.accountItem) accounts.push(entry.accountItem);
        }
      }
    }
  }
  const account = accounts.find(item => item.isSelected) ?? accounts[0];
  const nickname = textOf(account?.accountName);
  if (!nickname) return null;
  const tokens = account.serviceEndpoint?.selectActiveIdentityEndpoint?.supportedTokens ?? [];
  const gaiaId = tokens.map(token => token?.accountStateToken?.obfuscatedGaiaId).find(value => typeof value === 'string' && value);
  const avatarUrl = account.accountPhoto?.thumbnails?.at(-1)?.url;
  return {
    id: publicAccountId(gaiaId ?? (textOf(account.channelHandle) || nickname)),
    nickname,
    avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : '',
    // This answer does not say whether the account has Premium. The account menu is read for
    // it (premiumFromMenu).
    premium: false,
  };
}

// Whether the account has Premium, as an /account/account_menu answer shows it. The answer has
// no field for it, so it is read off the menu's icons (measured 2026-10-09 on one account, before
// and after it became a member: the rule is an inference from those two readings). A non-member's
// menu holds the offer to upgrade (iconType 'UNLIMITED'); a member's holds no such offer and an
// entry for its paid memberships ('MONETIZATION_ON').
// true for a member's menu, false for one with the offer, undefined for one with neither icon:
// that menu does not say.
function premiumFromMenu(data) {
  const icons = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.iconType === 'string') icons.add(value.iconType);
    Object.values(value).forEach(visit);
  };
  visit(data);
  if (icons.has('UNLIMITED')) return false;
  return icons.has('MONETIZATION_ON') ? true : undefined;
}

// The cards of one page of a library tab, and the token of the page after it. The first page
// is a gridRenderer, a further one a gridContinuation. The next page is the grid's own: the
// tab's sort and filter chips carry tokens as well, and those load the tab anew.
function readGrid(data) {
  let grid;
  const visit = value => {
    if (grid || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'gridRenderer' || key === 'gridContinuation') grid ??= child;
      else visit(child);
    }
  };
  visit(data);
  const rows = (Array.isArray(grid?.items) ? grid.items : []).map(item => item?.musicTwoRowItemRenderer).filter(Boolean);
  const continuation = grid?.continuations?.[0]?.nextContinuationData?.continuation;
  return { rows, ...(typeof continuation === 'string' && continuation ? { continuation } : {}) };
}

// The song count a line of a page names, as a number; undefined where it names none. The last
// count in the line is taken. It is looked for in the wordings of the app's three languages, which
// the pages are asked in; a comma, a point or a space (plain, no-break or narrow no-break) may
// group its thousands. A count never starts inside a number: not right after a digit, nor after
// a separator that follows one.
const countIn = text => {
  const count = [...String(text).matchAll(/(?<!\d[.,   ]?)(\d+(?:[.,   ]\d{3})*)\s*(?:首歌曲|首曲目|(?:songs?|videos?|tracks?|lagu)\b)/gi)].at(-1)?.[1];
  return count ? Number(count.replace(/[.,   ]/g, '')) : undefined;
};

// Whether anything under `value` goes by one of the names in `keys`.
const holds = (value, keys) => Boolean(value) && typeof value === 'object'
  && Object.entries(value).some(([key, child]) => keys.includes(key) || holds(child, keys));

// A playlist or album card of the library's tabs, in the shape the renderer is answered in.
// null for any other card: the playlists tab begins with one that makes a new playlist.
function collectionFromRow(row) {
  const browseId = row?.navigationEndpoint?.browseEndpoint?.browseId;
  const name = textOf(row?.title).trim();
  if (typeof browseId !== 'string' || !name) return null;
  const coverUrl = thumbnailUrl(row.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  const runs = Array.isArray(row.subtitle?.runs) ? row.subtitle.runs : [];
  const lastWords = String(runs.at(-1)?.text ?? '');
  if (browseId.startsWith('MPRE')) {
    // The list the album is played as, which is also the id it is saved by.
    const playlistId = row.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;
    const artists = runs
      .map(run => ({ id: run?.navigationEndpoint?.browseEndpoint?.browseId, name: String(run?.text ?? '').trim() }))
      .filter(artist => typeof artist.id === 'string' && artist.id.startsWith('UC') && artist.name);
    return {
      id: browseId, type: 'album', name, coverUrl,
      ...(typeof playlistId === 'string' && playlistId ? { playlistId } : {}),
      artists,
      ...(/^(19|20)\d{2}$/.test(lastWords.trim()) ? { year: Number(lastWords) } : {}),
    };
  }
  if (!browseId.startsWith('VL') || browseId.length < 4) return null;
  const id = browseId.slice(2);
  // The count ends the card's second line.
  const count = countIn(lastWords);
  return {
    id, type: 'playlist', name, coverUrl,
    ...(count !== undefined ? { trackCount: count } : {}),
    ...(id === 'LM' ? { isLiked: true } : {}),
    // Only a playlist the account made has an entry in its menu that edits or deletes it.
    ...(holds(row.menu, ['playlistEditorEndpoint', 'deletePlaylistEndpoint']) ? { isOwned: true } : {}),
  };
}

// The rows of a playlist's page, in the page's order: the song of each and the id the page gives
// the row itself (YouTube's "set video id"), '' where it gives none or one not written as these
// ids are. A playlist may hold a song twice, and the two rows differ in that id alone; a change
// names it to mean one row. Only the playlist's own rows are read: those of its shelf, and those
// a further page appends to it. Another list on the page (suggested songs) is not the playlist's.
// (The field is the one youtubei.js and ytmusicapi read; not looked at on a real page.)
const ROW_ID = /^[\w-]{1,64}$/;
const PLAYLIST_ROW_LISTS = ['musicPlaylistShelfRenderer', 'musicPlaylistShelfContinuation', 'appendContinuationItemsAction'];
function playlistRowsOf(data) {
  const rows = [];
  const visit = (value, within) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, within)); return; }
    for (const [key, child] of Object.entries(value)) {
      const row = within && key === 'musicResponsiveListItemRenderer' ? child?.playlistItemData : undefined;
      if (!row) { visit(child, within || PLAYLIST_ROW_LISTS.includes(key)); continue; }
      const { videoId, playlistSetVideoId: setVideoId } = row;
      if (typeof videoId === 'string') rows.push({ videoId, setVideoId: typeof setVideoId === 'string' && ROW_ID.test(setVideoId) ? setVideoId : '' });
    }
  };
  visit(data, false);
  return rows;
}

// The song count a playlist's page names in its header ('1,234 songs • 80+ hours'), undefined
// where it names none. The header is a musicResponsiveHeaderRenderer, which one the account may
// edit wraps; musicDetailHeaderRenderer is its older name. The count is on its second subtitle.
// (The fields are the ones ytmusicapi reads; not looked at on a real page.)
const PLAYLIST_HEADERS = ['musicResponsiveHeaderRenderer', 'musicDetailHeaderRenderer'];
function playlistCountOf(data) {
  let line;
  const visit = value => {
    if (line !== undefined || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (PLAYLIST_HEADERS.includes(key) && child?.secondSubtitle) line ??= textOf(child.secondSubtitle);
      else visit(child);
    }
  };
  visit(data);
  return line === undefined ? undefined : countIn(line);
}

module.exports = { accountFromList, collectionFromRow, playlistCountOf, playlistRowsOf, premiumFromMenu, readGrid, ROW_ID, signedInMarkOf };
