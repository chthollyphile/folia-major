import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Minus, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../../shared/ThemedDialog';
import { getVisualizerModeLabel, hasVisualizerMode } from '../../visualizer/registry';
import { getVisualizerBackgroundModeLabel, hasVisualizerBackgroundMode } from '../../visualizer/backgrounds/registry';
import { ACTIVATE_CUSTOM_THEME_KEY, THEME_DARK_KEY, THEME_LIGHT_KEY, type ImportChange, type ImportGroup, type ImportPlan } from '../../../utils/appearanceImportPlan';
import { resolveSettingLabelKey, resolveSettingValueLabelKey } from '../../../utils/settingLabelLookup';

// src/components/modal/settings/ImportConfirmDialog.tsx
// What an imported config would change, before it is applied, chosen field by field. Rows spell out
// their own before -> after so the choice is made on values rather than on field names, and a
// declined row shows what it keeps instead of what it would have become.
//
// Derived rows are the reason this dialog exists. They are changes the config never asked for --
// unpinning a custom theme, discarding an uploaded font -- so they are always shown, never folded
// into a collapsed list.

interface ImportConfirmDialogProps {
    isOpen: boolean;
    plan: ImportPlan | null;
    isDaylight: boolean;
    onCancel: () => void;
    onConfirm: (keys: string[]) => void;
}

const GROUP_LABEL_KEYS: Record<ImportGroup, string> = {
    theme: 'options.importGroupTheme',
    visualizer: 'options.importGroupVisualizer',
    fonts: 'options.importGroupFonts',
    background: 'options.importGroupBackground',
    songTheme: 'options.importGroupSongTheme',
    trackCard: 'options.importGroupTrackCard',
    lattice: 'options.importGroupLattice',
};

const DERIVED_LABEL_KEYS: Record<string, string> = {
    isCustomThemePreferred: 'options.importDerivedUnpin',
    uploadedLyricsFont: 'options.importDerivedUploadedFont',
};

// Field names that already have a label elsewhere in settings are reused as-is; the rest get one.
const FIELD_LABEL_KEYS: Record<string, string> = {
    [THEME_LIGHT_KEY]: 'options.importFieldThemeLight',
    [THEME_DARK_KEY]: 'options.importFieldThemeDark',
    [ACTIVATE_CUSTOM_THEME_KEY]: 'options.importFieldActivateCustomTheme',
    followSystemTheme: 'options.followSystemTheme',
    visualizerMode: 'options.visualizerMode',
    visualizerOpacity: 'options.visualizerOpacity',
    hidePlayerTranslationSubtitle: 'options.hidePlayerTranslationSubtitle',
    showSubtitleTranslation: 'options.showSubtitleTranslation',
    subtitleContentMode: 'options.subtitleContentMode',
    subtitleOverlayBackground: 'options.subtitleOverlayBackground',
    subtitleOverlayOpacity: 'options.subtitleOverlayOpacity',
    showHarmonySubtitle: 'options.showHarmonySubtitle',
    harmonySubtitleBackground: 'options.harmonySubtitleBackground',
    subtitleFontInheritsLyrics: 'options.subtitleFontInheritsLyrics',
    subtitleFontFamily: 'options.subtitleFontFamily',
    visualizerBackgroundMode: 'options.visualizerBackgroundMode',
    backgroundOpacity: 'options.backgroundOpacity',
    // The cover-color toggle is the one background row whose label lives outside the options
    // namespace -- the settings card reuses the theme panel's wording for it.
    useCoverColorBg: 'theme.addCoverColor',
    disableVisualizerGeometricBackground: 'options.disableVisualizerGeometricBackground',
    disableVisualizerVignette: 'options.disableVisualizerVignette',
    staticMode: 'options.staticMode',
    lyricsCustomFontFamily: 'options.customFont',
    songThemeAutoSwitchEnabled: 'options.autoSwitchSongTheme',
    songThemeAutoGenerateEnabled: 'options.autoGenerateSongTheme',
    randomVisualizerModePerSong: 'options.importFieldRandomMode',
    lyricsFontStyle: 'options.importFieldLyricsFontStyle',
    lyricsFontScale: 'options.importFieldLyricsFontScale',
    lyricsFontWeight: 'options.fontWeight',
    lyricsFontFallbackFamilies: 'options.importFieldLyricsFallback',
    subtitleFontScale: 'options.subtitleFontScale',
    subtitleFontStyle: 'options.importFieldSubtitleFontStyle',
    subtitleFontWeight: 'options.subtitleFontWeight',
    subtitleFontFallbackFamilies: 'options.importFieldSubtitleFallback',
    urlBackgroundList: 'options.importFieldUrlBackgroundList',
    urlBackgroundSelectedId: 'options.importFieldUrlBackgroundSelected',
    visualizerTunings: 'options.importFieldVisualizerTunings',
    monetBackgroundTuning: 'options.importFieldMonetBackgroundTuning',
    nomandBackgroundTuning: 'options.importFieldNomandBackgroundTuning',
    latentBackgroundTuning: 'options.importFieldLatentBackgroundTuning',
    // The card's three rows reuse the settings panel's own wording. The mode row borrows the
    // section heading, which is what that group of three buttons is actually labelled by.
    stageTrackPillMode: 'options.stageTrackPill',
    stageTrackPillTimeoutSec: 'options.stageTrackPillTimeout',
    stageTrackPillOnHome: 'options.stageTrackPillOnHome',
    latticeVignette: 'options.latticeVignette',
};

// The per-renderer tunings borrow the renderer's own display name instead of inventing one.
const TUNING_MODES: Record<string, string> = {
    classicTuning: 'classic',
    cadenzaTuning: 'cadenza',
    partitaTuning: 'partita',
    fumeTuning: 'fume',
    claddaghTuning: 'claddagh',
    cappellaTuning: 'cappella',
    tiltTuning: 'tilt',
    dioramaTuning: 'diorama',
    monetTuning: 'monet',
    pendoloTuning: 'pendolo',
    sonnetTuning: 'sonnet',
    temperaTuning: 'tempera',
};

interface BoxTone {
    checkedFill: string;
    uncheckedBorder: string;
    mutedColor: string;
}

// Module scope on purpose. Declared inside the dialog it would be a new component type on every
// render, so React would remount each checkbox on every toggle and drop keyboard focus with it.
//
// `label` is the row's own wording: the visible text sits in a sibling span, so without it the
// control announces as an unnamed button.
const BoxControl: React.FC<{
    state: 'on' | 'off' | 'partial' | 'locked';
    tone: BoxTone;
    label?: string;
    onClick?: () => void;
}> = ({ state, tone, label, onClick }) => {
    const className = `flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
        state === 'off' ? `${tone.uncheckedBorder} bg-transparent`
            : state === 'locked' ? `${tone.uncheckedBorder} opacity-40 cursor-default`
                : 'border-transparent'
    }`;
    const style = state === 'on' || state === 'partial' ? { backgroundColor: tone.checkedFill } : undefined;
    const glyph = (
        <>
            {state === 'partial' && <Minus size={13} className="text-white" />}
            {(state === 'on' || state === 'locked') && <Check size={13} className={state === 'locked' ? tone.mutedColor : 'text-white'} />}
        </>
    );

    // A locked box has nothing to toggle, and the unchanged section puts one inside its own header
    // button -- a button within a button is invalid and swallows clicks on that region.
    if (state === 'locked') {
        return <span aria-hidden="true" className={className} style={style}>{glyph}</span>;
    }

    return (
        <button
            type="button"
            onClick={onClick}
            // A checkbox rather than a toggle button: the group box has a third, mixed state that
            // aria-pressed cannot express and would report as simply unchecked.
            role="checkbox"
            aria-checked={state === 'partial' ? 'mixed' : state === 'on'}
            aria-label={label}
            className={className}
            style={style}
        >
            {glyph}
        </button>
    );
};

const isHexColor = (value: unknown): value is string =>
    typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim());

// A single theme side, as split out by the plan.
const isThemeSide = (value: unknown): value is {
    name?: string;
    backgroundColor?: string;
    primaryColor?: string;
    accentColor?: string;
    secondaryColor?: string;
} => Boolean(value) && typeof value === 'object' && 'backgroundColor' in (value as object);

const ImportConfirmDialog: React.FC<ImportConfirmDialogProps> = ({
    isOpen, plan, isDaylight, onCancel, onConfirm,
}) => {
    const { t, i18n } = useTranslation();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const selectableKeys = useMemo(
        () => (plan?.changes ?? []).filter(c => !c.derived).map(c => c.key),
        [plan],
    );

    // Everything starts accepted; the unchanged section starts closed since it is reference only --
    // unless there is nothing else, in which case closing it would leave an empty dialog.
    useEffect(() => {
        if (!isOpen || !plan) return;
        setSelected(new Set(selectableKeys));
        setCollapsed(plan.changes.length === 0 ? new Set() : new Set(['__unchanged']));
    }, [isOpen, plan, selectableKeys]);

    if (!plan) return null;

    // Some rows cannot move alone: the setter that applies one also writes another (see the plan's
    // `forces`). Selecting pulls in what it forces; deselecting drops whatever forces it, so the
    // checkbox never claims a combination the import cannot produce.
    const withLinks = (keys: Set<string>, key: string, on: boolean) => {
        const next = new Set(keys);
        const queue = [key];
        while (queue.length) {
            const current = queue.pop() as string;
            if (on === next.has(current)) continue;
            if (on) next.add(current); else next.delete(current);

            const linked = on
                ? (plan.changes.find(c => c.key === current)?.forces ?? [])
                : plan.changes.filter(c => c.forces?.includes(current)).map(c => c.key);
            queue.push(...linked);
        }
        return next;
    };

    const toggleKey = (key: string) => setSelected(withLinks(selected, key, !selected.has(key)));

    const toggleCollapse = (id: string) => {
        const next = new Set(collapsed);
        if (next.has(id)) next.delete(id); else next.add(id);
        setCollapsed(next);
    };

    const rowClass = isDaylight ? 'border-zinc-900/10 bg-zinc-900/[0.03]' : 'border-white/10 bg-white/[0.04]';
    const mutedColor = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    // Neutral rather than a status colour: checking a row is a choice, not a success.
    const checkedFill = isDaylight ? '#52525b' : '#71717a';
    const uncheckedBorder = isDaylight ? 'border-zinc-900/25' : 'border-white/25';

    const tone: BoxTone = { checkedFill, uncheckedBorder, mutedColor };

    const fieldLabel = (change: ImportChange) => {
        const mode = TUNING_MODES[change.key];
        if (mode) return t('options.importFieldTuningOf', { name: getVisualizerModeLabel(mode as never, k => t(k)) });
        const key = FIELD_LABEL_KEYS[change.key];
        return key ? t(key) : change.key;
    };

    // `bare` is the unchanged section: both sides are equal, so a nested object has nothing to say
    // that the label has not already said. `named` is the panel's own wording for an enum value,
    // resolved by the caller that knows the field's label key.
    const renderValue = (value: unknown, dimmed: boolean, key?: string, bare = false, named?: string | null) => {
        const cls = `text-xs ${dimmed ? `${mutedColor} line-through` : ''}`;

        // A row that reads "频谱样式  bar -> line" mixes the panel's wording with the store's ids.
        if (named) return <span className={cls}>{named}</span>;

        // Theme sides are usually named after the preset they were seeded from, so the names would
        // read as an identical pair while the colours are what actually differ.
        if (isThemeSide(value)) {
            // Every colour that renders, so a difference is never hidden behind an identical accent.
            const swatches: Array<[string, string | undefined]> = [
                ['background', value.backgroundColor],
                ['primary', value.primaryColor],
                ['accent', value.accentColor],
                ['secondary', value.secondaryColor],
            ];
            return (
                <span className={`inline-flex items-center gap-1 ${dimmed ? mutedColor : ''}`}>
                    {swatches.map(([name, color]) => (
                        <span
                            key={name}
                            title={`${name} ${color ?? ''}`}
                            className={`h-3.5 w-3.5 rounded-sm border border-white/20 ${dimmed ? 'opacity-40' : ''}`}
                            style={{ backgroundColor: color }}
                        />
                    ))}
                </span>
            );
        }
        if (key === 'visualizerMode' && typeof value === 'string' && hasVisualizerMode(value)) {
            return <span className={cls}>{getVisualizerModeLabel(value, k => t(k))}</span>;
        }
        if (key === 'visualizerBackgroundMode' && typeof value === 'string' && hasVisualizerBackgroundMode(value)) {
            return <span className={cls}>{getVisualizerBackgroundModeLabel(value, k => t(k))}</span>;
        }
        if (isHexColor(value)) {
            return (
                <span className={`inline-flex items-center gap-1 ${cls}`}>
                    <span className="h-3 w-3 rounded-sm border border-white/20" style={{ backgroundColor: value }} />
                    <span className="font-mono">{value}</span>
                </span>
            );
        }
        if (typeof value === 'boolean') return <span className={cls}>{t(value ? 'options.importValueOn' : 'options.importValueOff')}</span>;
        if (value === null || value === undefined || value === '') return <span className={`${cls} opacity-60`}>{t('options.importValueNone')}</span>;
        if (Array.isArray(value)) return <span className={cls}>{t('options.importValueCount', { count: value.length })}</span>;
        // In the unchanged section a bundle is equal on both sides; say so rather than leave a gap.
        if (typeof value === 'object') return <span className={cls}>{t(bare ? 'options.importValueSame' : 'options.importValueGrouped')}</span>;
        return <span className={cls}>{String(value)}</span>;
    };

    const changeRow = (change: ImportChange) => {
        const on = selected.has(change.key);
        // A nested bundle has no readable value of its own, so it reports how many of its own
        // settings move and opens to show them one by one.
        const children = change.children ?? [];
        const opaque = children.length > 0;
        const open = !collapsed.has(`child:${change.key}`);
        // Passed to the label lookup so a key that two of these would share is not used for either.
        const childPaths = children.map(c => c.key);

        return (
            <li key={change.key} className="text-xs">
                <div className="flex items-center gap-2">
                    <BoxControl state={on ? 'on' : 'off'} tone={tone} label={fieldLabel(change)} onClick={() => toggleKey(change.key)} />
                    <span className={`min-w-0 flex-1 truncate ${mutedColor}`}>{fieldLabel(change)}</span>
                    {opaque ? (
                        <button
                            type="button"
                            onClick={() => toggleCollapse(`child:${change.key}`)}
                            className={`flex shrink-0 items-center gap-1 ${!on ? `${mutedColor} line-through` : ''}`}
                        >
                            {t('options.importChildCount', { count: children.length })}
                            <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                    ) : (
                        <>
                            {renderValue(change.from, false, change.key)}
                            {on
                                ? <span className={`shrink-0 ${mutedColor}`}>→</span>
                                : <Undo2 size={12} className={`shrink-0 ${mutedColor}`} aria-label={t('options.importSkipped')} />}
                            {renderValue(change.to, !on, change.key)}
                        </>
                    )}
                </div>

                {opaque && open && (
                    <ul className={`mt-1 space-y-1 border-l pl-3 ${isDaylight ? 'border-zinc-900/10' : 'border-white/10'}`}>
                        {children.map((child) => {
                            // The panel's own label for this setting, if it has one.
                            const labelKey = resolveSettingLabelKey(change.key, child.key, k => i18n.exists(k), childPaths);
                            // The panel names each choice of an enum by hanging it off the field's
                            // own key, so the value can be worded the same way the settings are.
                            const named = (value: unknown) => {
                                const valueKey = resolveSettingValueLabelKey(labelKey, value, k => i18n.exists(k));
                                return valueKey ? t(valueKey) : null;
                            };
                            return (
                            <li key={child.key} className="flex items-center gap-2">
                                <span className={`min-w-0 flex-1 truncate ${mutedColor} ${labelKey ? 'text-xs' : 'font-mono text-[11px]'}`}>
                                    {labelKey ? t(labelKey) : child.key}
                                </span>
                                {renderValue(child.from, false, undefined, false, named(child.from))}
                                <span className={`shrink-0 ${mutedColor}`}>→</span>
                                {renderValue(child.to, !on, undefined, false, named(child.to))}
                            </li>
                            );
                        })}
                    </ul>
                )}
            </li>
        );
    };

    const unchangedByGroup = plan.unchanged.reduce<Record<string, ImportChange[]>>((acc, change) => {
        (acc[change.group] ??= []).push(change);
        return acc;
    }, {});

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onCancel}
            isDaylight={isDaylight}
            title={t('options.importConfirmTitle')}
            description={t('options.importConfirmDesc')}
            maxWidthClass="max-w-xl"
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${isDaylight ? 'hover:bg-zinc-200/60' : 'hover:bg-white/10'}`}
                    >
                        {t('status.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={() => onConfirm([...selected])}
                        // Nothing to pick is not the same as picking nothing: a plan whose changes
                        // are all derived, or which has none at all, still has to be dismissable
                        // through the confirm button rather than only through cancel.
                        disabled={selectableKeys.length > 0 && selected.size === 0}
                        className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {t('options.importApplySelected')}
                    </button>
                </>
            )}
        >
            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {plan.changes.length === 0 && (
                    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${rowClass} ${mutedColor}`}>
                        <Info size={13} className="mt-0.5 shrink-0" />
                        <span>{t('options.importNothingToChange')}</span>
                    </div>
                )}

                {plan.groups.map((group) => {
                    const changes = plan.changes.filter(c => c.group === group);
                    const plain = changes.filter(c => !c.derived);
                    // A derived row is only real while the row that causes it is still accepted, so
                    // it is resolved once here and drives both the warnings and the count.
                    const derived = changes.filter(c => c.derived && (!c.causedBy || c.causedBy.some(k => selected.has(k))));
                    const picked = plain.filter(c => selected.has(c.key)).length;
                    const groupState = picked === 0 ? 'off' : picked === plain.length ? 'on' : 'partial';
                    const isOpen = !collapsed.has(group);

                    // Everything this group had to say has been declined; an empty card with a
                    // count that no longer matches anything is worse than no card.
                    if (plain.length === 0 && derived.length === 0) return null;

                    return (
                        <div key={group} className={`rounded-2xl border px-4 py-3 ${rowClass}`}>
                            <div className="flex items-center gap-3">
                                <BoxControl
                                    state={plain.length === 0 ? 'locked' : groupState}
                                    tone={tone}
                                    label={t(GROUP_LABEL_KEYS[group])}
                                    onClick={() => {
                                        const on = groupState !== 'on';
                                        setSelected(plain.reduce((acc, c) => withLinks(acc, c.key, on), selected));
                                    }}
                                />
                                <span className="text-sm font-medium">{t(GROUP_LABEL_KEYS[group])}</span>
                                <button
                                    type="button"
                                    onClick={() => toggleCollapse(group)}
                                    className={`ml-auto flex items-center gap-1 text-xs ${mutedColor} transition-opacity hover:opacity-100`}
                                >
                                    {t('options.importChangeCount', { count: plain.length + derived.length })}
                                    <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </button>
                            </div>

                            {/* The changes the config did not ask for, shown without a checkbox:
                                they are not chosen, they follow. */}
                            {derived.map(change => (
                                <div key={change.key} className="mt-2 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                    <span>{t(DERIVED_LABEL_KEYS[change.key] ?? change.key)}</span>
                                </div>
                            ))}

                            {plain.some(c => c.note === 'listMerged' && selected.has(c.key)) && (
                                <div className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${isDaylight ? 'bg-zinc-900/5 text-zinc-500' : 'bg-white/5 text-zinc-400'}`}>
                                    <Info size={13} className="mt-0.5 shrink-0" />
                                    <span>{t('options.importListMerged')}</span>
                                </div>
                            )}

                            {plain.some(c => c.note === 'fontUnavailable' && selected.has(c.key)) && (
                                <div className={`mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${isDaylight ? 'bg-zinc-900/5 text-zinc-500' : 'bg-white/5 text-zinc-400'}`}>
                                    <Info size={13} className="mt-0.5 shrink-0" />
                                    <span>{t('options.importFontUnavailable')}</span>
                                </div>
                            )}

                            {isOpen && plain.length > 0 && <ul className="mt-2 space-y-1.5">{plain.map(changeRow)}</ul>}
                        </div>
                    );
                })}

                {plan.unchanged.length > 0 && (
                    <div className={`rounded-2xl border px-4 py-3 ${rowClass} opacity-70`}>
                        <button
                            type="button"
                            onClick={() => toggleCollapse('__unchanged')}
                            className="flex w-full items-center gap-3"
                        >
                            <BoxControl state="locked" tone={tone} />
                            <span className="text-sm font-medium">{t('options.importUnchanged')}</span>
                            <span className={`ml-auto flex items-center gap-1 text-xs ${mutedColor}`}>
                                {t('options.importItemCount', { count: plan.unchanged.length })}
                                <ChevronDown size={13} className={`transition-transform ${collapsed.has('__unchanged') ? '' : 'rotate-180'}`} />
                            </span>
                        </button>

                        {!collapsed.has('__unchanged') && (
                            <div className="mt-2 space-y-2">
                                {Object.entries(unchangedByGroup).map(([group, rows]) => (
                                    <div key={group}>
                                        {/* A heading must not be smaller than the rows it heads. */}
                                        <div className={`text-xs font-medium ${isDaylight ? 'text-zinc-600' : 'text-zinc-300'}`}>
                                            {t(GROUP_LABEL_KEYS[group as ImportGroup])}
                                        </div>
                                        <ul className="mt-1 space-y-1.5">
                                            {rows.map(change => (
                                                <li key={change.key} className="flex items-center gap-2 text-xs">
                                                    <span className={`min-w-0 flex-1 truncate ${mutedColor}`}>{fieldLabel(change)}</span>
                                                    {/* Identical on both sides, so one value says it. */}
                                                    {renderValue(change.from, false, change.key, true)}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </ThemedDialog>
    );
};

export default ImportConfirmDialog;
