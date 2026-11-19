// electron/ytm/tiles.cjs
// What the readers of YouTube's raw JSON share: the shape of a video id, and what the save
// buttons of a list's page say (webSaves.cjs finds the buttons).

const VIDEO_ID = /^[\w-]{11}$/;

// Whether the account has saved a list (an album, or a playlist that is somebody else's), as
// the save buttons of the list's own page state it. Undefined when the page has no such button
// (the page of a playlist the account made has none), or has several that do not agree.
function savedStateOn(buttons) {
  const states = new Set(buttons.map(button => button.isToggled));
  return states.size === 1 ? [...states][0] : undefined;
}

// The like with this status in a button's command, which may be wrapped (a playlist's page puts
// it in a list of commands, once for a signed-in viewer and once for one who is not).
function likeIn(command, status) {
  if (!command || typeof command !== 'object') return undefined;
  if (command.likeEndpoint?.status === status) return command.likeEndpoint;
  for (const [key, child] of Object.entries(command)) {
    const found = key === 'unauthenticatedCommand' ? undefined : likeIn(child, status);
    if (found) return found;
  }
  return undefined;
}

// What a page's save buttons would send to save the list (`saved`) or to take it out: the list
// the like is of, and the parameters where the button carries some (a playlist's page does).
// The list is the one the button names, which is not always the one the page was asked for by.
// Undefined where the button names no like, and where the page has several save buttons that
// name different lists: which of them is the page's own cannot be told, and a like of the wrong
// one would save another list to the account.
function saveCommandOn(buttons, saved) {
  const likes = buttons.map(button => likeIn(saved ? button.defaultServiceEndpoint : button.toggledServiceEndpoint, saved ? 'LIKE' : 'INDIFFERENT'));
  const like = likes[0];
  const playlistId = like?.target?.playlistId;
  if (typeof playlistId !== 'string' || !playlistId || likes.some(other => other?.target?.playlistId !== playlistId)) return undefined;
  const params = saved ? like.likeParams : like.removeLikeParams;
  return { playlistId, ...(typeof params === 'string' && params ? { params } : {}) };
}

module.exports = { VIDEO_ID, likeIn, saveCommandOn, savedStateOn };
