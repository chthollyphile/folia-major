// src/components/panelTab/controls/panelPictures.ts
// When the player panel's small pictures of lyric styles and backgrounds are made. The panel lies
// over the playing page, and making an image draws a second copy of a style as large as the window:
// measured on a production build with a song playing, one such copy of 绘光, 凝彩 or 商籁 is a long
// task of 90 to 110 ms in the middle of the lyrics, and a song change under an open picker made
// eleven of them again. So while a song plays, images are made only for a picker that is open, and
// a new theme (with AI themes, every song has one) reaches the pictures only when a picker opens.
// Until a picture has an image it shows its glyph.

type PanelState = {
    /** A song is playing. */
    playing: boolean;
    /** One of the two rows has its picker open. */
    pickerOpen: boolean;
};

/** Whether the panel's pictures may make images now. */
export const panelMakesImages = ({ playing, pickerOpen }: PanelState): boolean => pickerOpen || !playing;

/**
 * The theme the panel's pictures are drawn in: `held`, the one they were last drawn in, or `now`,
 * the playing page's. They follow the page while nothing plays; while a song plays they change
 * theme only at the moment a picker opens.
 */
export const panelPictureTheme = <T>(held: T, now: T, state: { playing: boolean; pickerOpens: boolean }): T => (
    !state.playing || state.pickerOpens ? now : held
);
