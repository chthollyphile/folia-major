import { settingsCardClassFor, settingsDividerClassFor, settingsToggleOffClassFor } from '../../components/modal/settings/settingsCardClasses';

// src/mods/manager/modManagerClasses.ts
// The class strings the mod manager dresses itself in. Built on the settings page's own card and
// divider tokens so the manager looks the same inside the settings page and the palette surface.

export const modManagerClassesFor = (isDaylight: boolean) => ({
    card: settingsCardClassFor(isDaylight),
    divider: settingsDividerClassFor(isDaylight),
    toggleOff: settingsToggleOffClassFor(isDaylight),
    ghostButton: isDaylight
        ? 'border-black/10 bg-black/[0.025] hover:bg-black/[0.06]'
        : 'border-white/10 bg-white/5 hover:bg-white/10',
    activeButton: isDaylight
        ? 'border-black/20 bg-black/10'
        : 'border-white/25 bg-white/15',
    rowHover: isDaylight ? 'hover:bg-black/[0.03]' : 'hover:bg-white/[0.03]',
    expandedRow: isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.03]',
    chip: isDaylight ? 'bg-black/[0.05]' : 'bg-white/[0.06]',
    muted: isDaylight ? 'text-zinc-400' : 'text-white/35',
    warning: isDaylight
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800'
        : 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    danger: isDaylight
        ? 'border-red-500/25 bg-red-500/10 text-red-700'
        : 'border-red-400/20 bg-red-500/10 text-red-300',
    // Beta (preview-channel) signatures: kept off amber so a preview build never reads as an
    // invalid signature, and off emerald so it never reads as officially verified.
    preview: isDaylight
        ? 'border-violet-500/25 bg-violet-500/10 text-violet-700'
        : 'border-violet-400/20 bg-violet-500/10 text-violet-300',
    success: isDaylight
        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
        : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300',
});

export type ModManagerClasses = ReturnType<typeof modManagerClassesFor>;

/*
 * The same in the settings kit's colours (its --st-* variables), for the mods view: Settings → Mods sets them as
 * the settings window, and the palette's mods surface sets them around the view.
 */
export const MOD_KIT_CLASSES: ModManagerClasses = {
    card: 'border-transparent bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]',
    divider: 'border-[color:var(--st-line)]',
    toggleOff: 'bg-[var(--st-track)]',
    ghostButton: 'border-transparent bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]',
    activeButton: 'border-transparent bg-[var(--st-track)]',
    rowHover: 'hover:bg-[var(--st-fill)]',
    expandedRow: 'bg-[var(--st-fill)]',
    chip: 'bg-[var(--st-fill)]',
    muted: 'text-[color:var(--st-t3)]',
    warning: 'border-[color:var(--st-warn)]/25 bg-[var(--st-warn)]/10 text-[color:var(--st-t1)]',
    danger: 'border-[color:var(--st-err)]/25 bg-[var(--st-err)]/10 text-[color:var(--st-t1)]',
    preview: 'border-violet-400/25 bg-violet-500/10 text-[color:var(--st-t1)]',
    success: 'border-[color:var(--st-ok)]/25 bg-[var(--st-ok)]/10 text-[color:var(--st-t1)]',
};
