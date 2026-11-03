const { likeIn, saveCommandOn, savedStateOn } = require('./tiles.cjs');

// electron/ytm/webSaves.cjs
// Reads, off a page YouTube Music's web client is answered with as the account of the web
// sign-in, whether the account has saved the page's list (an album, or a playlist that is
// somebody else's) and what saving it or taking it out would send. The buttons are found here;
// what a button says is read in tiles.cjs.

// The save buttons of a list's page: among the buttons of the page's header, a toggle whose
// press sends a like of a list (2026-10-08 and 10-09: one on an album's page and one on the page
// of somebody else's playlist, with the icons BOOKMARK_BORDER and BOOKMARK). The header's other
// toggle opens its description out and sends nothing. The page of the liked-music list has no
// such button, and neither has the page an album's list is given (`VL` + the list's id), which
// has the album's rows and no header: an album's button is on the album's own page (`MPRE…`).
function saveButtonsOf(data) {
  const buttons = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'musicResponsiveHeaderRenderer') { visit(child); continue; }
      for (const item of Array.isArray(child?.buttons) ? child.buttons : []) {
        const button = item?.toggleButtonRenderer;
        const list = likeIn(button?.defaultServiceEndpoint, 'LIKE')?.target?.playlistId;
        if (typeof button?.isToggled === 'boolean' && typeof list === 'string' && list) buttons.push(button);
      }
    }
  };
  visit(data);
  return buttons;
}

// Whether the account has saved the page's list. Undefined when the page has no save button.
const savedStateOf = data => savedStateOn(saveButtonsOf(data));

// What the page's save button would send to save the list (`saved`) or to take it out: the list
// the like is of, and its parameters where the button carries some. Undefined where the button
// names no like for that.
const saveCommandOf = (data, saved) => saveCommandOn(saveButtonsOf(data), saved);

module.exports = { saveCommandOf, savedStateOf };
