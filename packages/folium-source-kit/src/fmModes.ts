// packages/folium-source-kit/src/fmModes.ts
// The standard modes of a personal FM (Folium 2.0 plan §6.1, `fmModes`): their ids, in the order every mode picker
// shows them, an English name to fall back on and the pinyin a picker answers to. The host builds its own table from
// it (src/services/onlineMusic/fmModes.ts adds its i18n keys); a source builds the `modes` of its
// `recommendations@1.getPersonalFmCatalog` with `personalFmModes`, naming each mode in its own locale files. Nothing
// here knows a platform: which modes a platform's radio takes is the platform's to say.

/** The id of a standard personal FM mode (`FoliumSourceFmLaunch['mode']`). */
export type PersonalFmModeId = 'DEFAULT' | 'FAMILIAR' | 'EXPLORE' | 'PUZZLE_MODE_RCMD' | 'SCENE_RCMD';

/** One standard mode. */
export interface PersonalFmModeInfo {
    readonly id: PersonalFmModeId;
    /** Its English name, for where no translation is at hand. */
    readonly labelFallback: string;
    /** Pinyin, full and initials, so a picker answers to a keyboard that types no Chinese. */
    readonly keywords: readonly string[];
}

const mode = (id: PersonalFmModeId, labelFallback: string, ...keywords: string[]): PersonalFmModeInfo => (
    Object.freeze({ id, labelFallback, keywords: Object.freeze(keywords) })
);

/**
 * The standard modes in the order a picker shows them. SCENE_RCMD sits last: it is the only mode the scene row can
 * select on the listener's behalf, so the row below it reads as its continuation.
 */
export const PERSONAL_FM_MODE_INFO: readonly PersonalFmModeInfo[] = Object.freeze([
    mode('DEFAULT', 'Default', 'moren', 'mr'),
    mode('FAMILIAR', 'Familiar', 'shuxi', 'sx'),
    mode('EXPLORE', 'Explore', 'tansuo', 'ts'),
    mode('PUZZLE_MODE_RCMD', 'Puzzle', 'pintu', 'pt'),
    mode('SCENE_RCMD', 'Scene', 'changjing', 'cj'),
]);

/**
 * The `modes` of a personal FM catalogue: the standard modes among `ids`, in the standard order (not the order of
 * `ids`), each named by `label(id)` (a source hands `folium.i18n.key(…)` of its own locale files) and carrying its
 * keywords. An id that is no standard mode is left out.
 *
 * ```ts
 * modes: personalFmModes(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD'], id => folium.i18n.key(`fm.mode.${id}`)),
 * ```
 */
export const personalFmModes = <Label>(
    ids: readonly string[],
    label: (id: PersonalFmModeId) => Label,
): Array<{ id: PersonalFmModeId; label: Label; keywords: string[] }> => (
    PERSONAL_FM_MODE_INFO
        .filter((info) => ids.includes(info.id))
        .map((info) => ({ id: info.id, label: label(info.id), keywords: [...info.keywords] }))
);
