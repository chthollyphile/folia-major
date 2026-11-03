// src/components/modal/settings/settingsCardClasses.ts
// The card and toggle-track classes of the settings sections drawn outside the settings window:
// the command palette's surfaces (grid view cards, reduce motion, lyric export) and the mod
// manager. Declared once, so that none of them keeps a hand-kept copy of these strings. The
// window's own pages are drawn by the kit and do not use them.

export const settingsCardClassFor = (isDaylight: boolean) => (
    isDaylight ? 'bg-black/[0.025] border-black/10' : 'bg-white/5 border-white/5'
);

export const settingsToggleOffClassFor = (isDaylight: boolean) => (
    isDaylight ? 'bg-zinc-300/90' : 'bg-white/10'
);

// Hairline between rows inside a settings card. Chosen by isDaylight rather than a `dark:` variant:
// Tailwind's dark variant follows the OS color scheme, which says nothing about the daylight theme.
export const settingsDividerClassFor = (isDaylight: boolean) => (
    isDaylight ? 'border-black/5' : 'border-white/5'
);
