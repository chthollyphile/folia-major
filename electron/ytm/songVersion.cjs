// electron/ytm/songVersion.cjs
// A video and its song: which entries of YouTube Music's pages are videos (official music videos
// or uploads), and the song YouTube Music pairs with an official one.

const OFFICIAL_VIDEO = 'MUSIC_VIDEO_TYPE_OMV';
const UPLOADED_VIDEO = 'MUSIC_VIDEO_TYPE_UGC';
const SONG = 'MUSIC_VIDEO_TYPE_ATV';

// The kind of track a watch endpoint plays (a page's raw endpoint, or youtubei.js's payload of one).
const kindOf = watchEndpoint => watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;

// What a track's kind adds to its wire shape: `video`, where the track is a video, whose audio is
// the video's (an official music video, or one somebody else uploaded: a cover, a live
// recording); `officialVideo`, where it is an official music video, which a list shows as its
// song (asShown). A song and an endpoint that names no kind add nothing.
const videoFieldsOf = watchEndpoint => {
  const kind = kindOf(watchEndpoint);
  if (kind === OFFICIAL_VIDEO) return { video: true, officialVideo: true };
  return kind === UPLOADED_VIDEO ? { video: true } : {};
};

// The song a watch page pairs with the video `videoId`, of the page's queue entries that hold a
// pair (youtubei.js PlaylistPanelVideoWrapper): the song of the switch between song and video
// in YouTube Music's own player. Only a signed-in account's page holds the pairs (2026-10-23).
// Null where the video has no song.
function songEntryOf(wrappers, videoId) {
  const wrapper = wrappers.find(item => item?.primary?.video_id === videoId);
  return (wrapper?.counterpart ?? []).find(entry => kindOf(entry?.endpoint?.payload) === SONG) ?? null;
}

module.exports = { songEntryOf, videoFieldsOf };
