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
