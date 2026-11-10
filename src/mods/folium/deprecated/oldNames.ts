// src/mods/folium/deprecated/oldNames.ts
// Folium 1.6 only: the client names Folium 2 removes, one row each, as facts.
// index.ts keeps them working and says which one a mod used; `npm run
// folium:check` finds them in a client entry's code; `npm run folium:api`
// lists them in docs/folium/api.md. Like kinds.ts it imports nothing at run
// time, so the tools under dev/folium/ can import it straight into Node.

/** One old name: what a mod wrote, what it writes now. */
export interface FoliumOldName {
    /** The old name as a mod writes it. */
    old: string;
    /** What to write now; null when nothing takes its place. */
    now: string | null;
    /** What the warning says instead of "removed in Folium 2, use <now>", for a row that is no rename. */
    advice?: string;
    /**
     * Finds a use for `npm run folium:check`, in the code with comments and strings blanked out
     * (`inStrings`: in the text of the strings instead). Null when a reading of the text cannot see it.
     */
    pattern: RegExp | null;
    inStrings?: boolean;
}

export const FOLIUM_OLD_CLIENT_NAMES = {
    subscribe: { old: 'ctx.subscribe', now: 'ctx.onChange', pattern: /\bctx\s*\??\.\s*subscribe\b/ },
    currentTime: {
        old: 'ctx.currentTime',
        now: 'ctx.lyricTime (visualizers, stage layers) or ctx.playbackTime (progress buttons and layers)',
        pattern: /\bctx\s*\??\.\s*currentTime\b/,
    },
    clockOn: {
        old: 'ctx.currentTime.on',
        now: 'ctx.onLyricTime or ctx.onPlaybackTime',
        pattern: /\bcurrentTime\s*\??\.\s*on\s*\(/,
    },
    onTime: { old: 'ctx.onTime', now: 'ctx.onLyricTime or ctx.onPlaybackTime', pattern: /\bctx\s*\??\.\s*onTime\b/ },
    params: {
        old: 'params (of a settings section handle, of ctx in a settingsPanel)',
        now: 'settings',
        pattern: /\.\s*params\s*\??\.\s*(?:get|set|reset|subscribe|schema)\b/,
    },
    settingsSubscribe: { old: 'params.subscribe', now: 'settings.onChange', pattern: /\bparams\s*\??\.\s*subscribe\b/ },
    controlButtons: {
        old: 'folium.registries.controlButtons',
        now: 'folium.registries.progressButtons',
        pattern: /\bregistries\s*\??\.\s*controlButtons\b/,
    },
    tuningParams: {
        old: 'tunings.register({ params })',
        now: 'tunings.register({ settings })',
        pattern: /\btunings\s*\??\.\s*register\s*\(\s*\{[^;]*?\bparams\s*:/,
    },
    controlButtonMount: {
        old: 'data-folium-kind="control-button"',
        now: 'data-folium-kind="progress-button"',
        pattern: /data-folium-kind[^\]]*control-button\b/,
        inStrings: true,
    },
    internals: { old: 'folium.internals', now: null, pattern: /\bfolium\s*\??\.\s*internals\b/ },
    lyricsLrc: {
        old: 'getLyrics answering { lrc, translationLrc }',
        now: "{ main: { format: 'lrc', text, translationText } }",
        pattern: null,
    },
    unknownEvent: {
        old: "folium.events.on('<a name that is no event>')",
        now: null,
        advice: 'does nothing; Folium 2 throws unknown-event:<name>',
        pattern: null,
    },
} as const satisfies Record<string, FoliumOldName>;

/** Old names of `folium.registries`, each with the registry it is now. */
export const FOLIUM_OLD_REGISTRY_NAMES = Object.freeze({ controlButtons: 'progressButtons' } as const);

/** What the warning for one old name says after the name. */
export const foliumOldNameAdvice = ({ now, advice }: Pick<FoliumOldName, 'now' | 'advice'>): string => (
    advice ?? (now === null ? 'removed in Folium 2, nothing takes its place' : `removed in Folium 2, use ${now}`)
);
