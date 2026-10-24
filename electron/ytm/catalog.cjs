const { VIDEO_ID } = require('./tiles.cjs');
const { videoFieldsOf } = require('./songVersion.cjs');

// electron/ytm/catalog.cjs
// Maps youtubei.js's parsed YouTube Music nodes (search, album, artist, watch queue) to wire shapes.

const str = value => value == null ? '' : String(value);

// Thumbnails come largest-first or smallest-first depending on the node; pick by width, capped
// so an artist banner does not hand the renderer a 2880px image.
// Search rows carry 60px and 120px art; the same image is served at any size named in its suffix.
const squareArt = url => url.replace(/=w(\d+)-h(\d+)(-[^=/]*)?$/, (match, width, height, rest = '') => (
  width === height && Number(width) < 544 ? `=w544-h544${rest}` : match
));

const thumbnailUrl = (thumbnails, maxWidth = 1200) => {
  const byWidth = (Array.isArray(thumbnails) ? thumbnails : [])
    .filter(item => typeof item?.url === 'string')
    .sort((left, right) => (left.width || 0) - (right.width || 0));
  const fitting = byWidth.filter(item => (item.width || 0) <= maxWidth);
  return squareArt((fitting.at(-1) ?? byWidth[0])?.url ?? '');
};

const artistsOf = list => (Array.isArray(list) ? list : [])
  .filter(artist => str(artist?.name).trim())
  .map(artist => ({ id: str(artist.channel_id), name: str(artist.name).trim() }));

const yearToTime = value => {
  const year = Number(/\b(19|20)\d{2}\b/.exec(str(value))?.[0]);
  return Number.isFinite(year) && year > 0 ? Date.UTC(year, 0, 1) : undefined;
};

// A song row: search result, album track or an artist's top song. `context` fills what album rows omit.
function songFromListItem(item, context = {}) {
  const id = item?.id;
  if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null;
  const name = str(item.title);
  if (!name) return null;
  const artists = artistsOf(item.artists?.length ? item.artists : item.authors);
  return {
    id, name,
    artists: artists.length > 0 ? artists : context.artists ?? [],
    album: {
      id: str(item.album?.id) || context.albumId || '',
      name: str(item.album?.name) || context.albumName || '',
      coverUrl: thumbnailUrl(item.thumbnail?.contents ?? item.thumbnails) || context.coverUrl || '',
    },
    durationMs: Math.max(0, Number(item.duration?.seconds) || 0) * 1000,
    // (A row's title leads to what it plays, and says what kind of track that is.)
    ...videoFieldsOf(item.flex_columns?.[0]?.title?.runs?.[0]?.endpoint?.payload),
  };
}

// The current entry of the watch queue; the only public source of a video's structured artist and album.
function songFromQueueItem(item) {
  const id = item?.video_id;
  if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null;
  return {
    id, name: str(item.title),
    artists: artistsOf(item.artists),
    album: { id: str(item.album?.id), name: str(item.album?.name), coverUrl: thumbnailUrl(item.thumbnail) },
    durationMs: Math.max(0, Number(item.duration?.seconds) || 0) * 1000,
    ...videoFieldsOf(item.endpoint?.payload),
  };
}

function albumFromCard(item, artists = []) {
  const id = item?.id;
  if (typeof id !== 'string' || !id.startsWith('MPRE')) return null;
  const publishedAt = yearToTime(item.year ?? item.subtitle);
  return {
    id, type: 'album', name: str(item.title), coverUrl: thumbnailUrl(item.thumbnail),
    artists: artistsOf(item.artists).length > 0 ? artistsOf(item.artists) : artists,
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

// The list id in a YouTube Music address (`…/playlist?list=OLAK5uy_…`), or '' when it names none.
const listIdOf = url => {
  try { return new URL(str(url)).searchParams.get('list') ?? ''; } catch { return ''; }
};

function albumFromPage(album, id) {
  const header = album?.header ?? {};
  // The id the album goes by where it is saved: the page names it only in its own address.
  const playlistId = listIdOf(album?.url);
  const name = str(header.title);
  const coverUrl = thumbnailUrl(header.thumbnail?.contents);
  const linked = (Array.isArray(header.strapline_text_one?.runs) ? header.strapline_text_one.runs : [])
    .filter(run => str(run?.endpoint?.payload?.browseId).startsWith('UC'))
    .map(run => ({ id: run.endpoint.payload.browseId, name: str(run.text).trim() }));
  const artistText = str(header.strapline_text_one).trim();
  const artists = linked.length > 0 ? linked : artistText ? [{ id: '', name: artistText }] : [];
  const items = (Array.isArray(album?.contents) ? album.contents : [])
    .map(item => songFromListItem(item, { artists, albumId: id, albumName: name, coverUrl }))
    .filter(Boolean);
  const publishedAt = yearToTime(header.subtitle);
  return {
    collection: {
      id, type: 'album', name, coverUrl, artists, trackCount: items.length,
      description: str(header.description?.description),
      ...(playlistId ? { playlistId } : {}),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    },
    items,
  };
}

// An artist page: header, the top-songs shelf and the album carousels. `more` is the endpoint
// of a carousel's full list, followed by the caller.
function artistFromPage(artist, id) {
  const header = artist?.header ?? {};
  const name = str(header.title);
  const self = [{ id, name }];
  const sections = Array.isArray(artist?.sections) ? artist.sections : [];
  const shelf = sections.find(section => section?.type === 'MusicShelf');
  const albumShelves = sections
    .filter(section => section?.type === 'MusicCarouselShelf' && section.contents?.[0]?.item_type === 'album')
    .map(section => ({
      items: section.contents.map(item => albumFromCard(item, self)).filter(Boolean),
      more: str(section.header?.more_content?.endpoint?.payload?.browseId).startsWith('MPAD')
        ? section.header.more_content.endpoint : null,
    }));
  return {
    collection: {
      id, type: 'artist', name,
      coverUrl: thumbnailUrl(header.thumbnail?.contents ?? header.foreground_thumbnail?.contents),
      description: str(header.description),
    },
    songs: (Array.isArray(shelf?.contents) ? shelf.contents : [])
      .map(item => songFromListItem(item, { artists: self })).filter(Boolean),
    albumShelves,
  };
}

// The id of a song's lyrics page, read from its watch page (raw JSON); null when it has no lyrics.
function lyricsBrowseId(watchPage) {
  const tabs = watchPage?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
    ?.watchNextTabbedResultsRenderer?.tabs ?? [];
  for (const tab of tabs) {
    const endpoint = tab?.tabRenderer?.endpoint?.browseEndpoint;
    const pageType = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof endpoint.browseId === 'string') return endpoint.browseId;
  }
  return null;
}

const lrcTime = ms => {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `[${String(minutes).padStart(2, '0')}:${seconds}]`;
};

// The mobile app's lyrics page (raw JSON) as LRC text; null when its lyrics carry no timing.
// Lines without a letter or digit are the "♪" that marks a break: leaving them out leaves a gap,
// which is how the lyric parser recognises an interlude.
function lrcFromLyricsPage(page) {
  const timed = page?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel
    ?.lyricsData?.timedLyricsData;
  if (!Array.isArray(timed)) return null;
  const lines = [];
  for (const entry of timed) {
    const text = typeof entry?.lyricLine === 'string' ? entry.lyricLine.replace(/\s+/g, ' ').trim() : '';
    const startMs = Number(entry?.cueRange?.startTimeMilliseconds);
    if (/[\p{L}\p{N}]/u.test(text) && Number.isFinite(startMs) && startMs >= 0) lines.push(`${lrcTime(startMs)}${text}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

module.exports = {
  albumFromCard, albumFromPage, artistFromPage, lrcFromLyricsPage, lyricsBrowseId, songFromListItem, songFromQueueItem,
  thumbnailUrl,
};
