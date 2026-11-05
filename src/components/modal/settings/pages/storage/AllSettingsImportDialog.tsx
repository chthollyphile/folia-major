import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SheetButton } from '../../../../shared/Sheet';
import ThemedDialog from '../../../../shared/ThemedDialog';
import type { SettingsGroupId } from '../../../../../services/settingsTransfer/settingsCatalog';
import type { SettingsImportPlan } from '../../../../../services/settingsTransfer/settingsImportPlan';

// src/components/modal/settings/pages/storage/AllSettingsImportDialog.tsx
// What a whole-settings bundle would change, before any of it is written.
//
// One row per group rather than per setting: a bundle from a well-tuned Folia changes most groups
// at once, and a list of a hundred and forty keys is not something a person reads. The keys are
// still there, under each group, for whoever wants to see exactly what a group carries.
//
// Nothing is preselected by group count: a group with no change is not listed at all, so what may
// be picked is only what would actually change.

const GROUP_LABEL_KEYS: Record<SettingsGroupId, string> = {
    appearance: 'options.allSettingsGroupAppearance',
    player: 'options.allSettingsGroupPlayer',
    home: 'options.allSettingsGroupHome',
    lyrics: 'options.allSettingsGroupLyrics',
    playback: 'options.allSettingsGroupPlayback',
    interaction: 'options.allSettingsGroupInteraction',
    general: 'options.allSettingsGroupGeneral',
    integration: 'options.allSettingsGroupIntegration',
    storage: 'options.allSettingsGroupStorage',
    desktop: 'options.allSettingsGroupDesktop',
    graphics: 'options.allSettingsGroupGraphics',
    mods: 'options.allSettingsGroupMods',
};

interface AllSettingsImportDialogProps {
    isOpen: boolean;
    plan: SettingsImportPlan | null;
    isDaylight: boolean;
    onCancel: () => void;
    onConfirm: (groups: SettingsGroupId[]) => void;
}

export const AllSettingsImportDialog: React.FC<AllSettingsImportDialogProps> = ({ isOpen, plan, isDaylight, onCancel, onConfirm }) => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<Set<SettingsGroupId>>(new Set());
    const [openGroups, setOpenGroups] = useState<Set<SettingsGroupId>>(new Set());

    // Every group that would change starts picked, so the ordinary case (move my settings to a new
    // machine) is one press; a group is unticked to keep what this machine has.
    useEffect(() => {
        setSelected(new Set(plan?.groups.map(group => group.group) ?? []));
        setOpenGroups(new Set<SettingsGroupId>());
    }, [plan]);

    const rowClass = isDaylight ? 'border-zinc-900/10 bg-zinc-900/[0.03]' : 'border-white/10 bg-white/[0.04]';
    const mutedColor = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const checkedFill = isDaylight ? '#52525b' : '#71717a';
    const uncheckedBorder = isDaylight ? 'border-zinc-900/25' : 'border-white/25';
    const hoverClass = isDaylight ? 'hover:bg-zinc-900/[0.05]' : 'hover:bg-white/[0.06]';

    const groups = useMemo(() => plan?.groups ?? [], [plan]);

    const toggleGroup = (group: SettingsGroupId) => {
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });
    };

    const toggleOpen = (group: SettingsGroupId) => {
        setOpenGroups(previous => {
            const next = new Set(previous);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });
    };

    const checkedCount = groups.filter(group => selected.has(group.group)).length;
    const allChecked = groups.length > 0 && checkedCount === groups.length;
    // What the confirm press would actually write: the picked groups' own counts, not the file's.
    const selectedChangeCount = groups
        .filter(group => selected.has(group.group))
        .reduce((total, group) => total + group.changes.length, 0);

    const box = (checked: boolean) => (
        <span
            aria-hidden="true"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${checked ? 'border-transparent' : `${uncheckedBorder} bg-transparent`}`}
            style={checked ? { backgroundColor: checkedFill } : undefined}
        >
            {checked ? <Check size={13} className="text-white" /> : null}
        </span>
    );

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onCancel}
            isDaylight={isDaylight}
            title={t('options.allSettingsImportConfirmTitle')}
            description={t('options.allSettingsImportConfirmDesc')}
            size="m"
            footer={(
                <>
                    <SheetButton onClick={onCancel}>{t('status.cancel')}</SheetButton>
                    {/* Always live: a plan with nothing picked, or nothing to pick, is still
                        dismissed through its own confirm rather than only through cancel. */}
                    <SheetButton variant="primary" onClick={() => onConfirm([...selected])}>
                        {t('options.allSettingsImportApply', { n: selectedChangeCount })}
                    </SheetButton>
                </>
            )}
        >
            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {groups.length === 0 && (
                    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${rowClass} ${mutedColor}`}>
                        <Info size={13} className="mt-0.5 shrink-0" />
                        <span>{t('options.allSettingsImportNothing')}</span>
                    </div>
                )}

                {groups.length > 0 && (
                    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-xs ${rowClass} ${mutedColor}`}>
                        <span>{t('options.allSettingsImportSummary', { groups: groups.length, n: plan?.totalChanged ?? 0 })}</span>
                        <button
                            type="button"
                            onClick={() => setSelected(allChecked ? new Set<SettingsGroupId>() : new Set(groups.map(group => group.group)))}
                            className={`ml-auto shrink-0 rounded-lg px-2 py-1 text-xs transition-colors ${hoverClass}`}
                        >
                            {allChecked ? t('options.allSettingsImportPickNone') : t('options.allSettingsImportPickAll')}
                        </button>
                    </div>
                )}

                {groups.map(groupPlan => {
                    const checked = selected.has(groupPlan.group);
                    const open = openGroups.has(groupPlan.group);
                    return (
                        <div key={groupPlan.group} className={`overflow-hidden rounded-2xl border ${rowClass}`}>
                            <div className="flex items-center gap-3 px-4 py-3">
                                {/* A checkbox, not a toggle: the group is picked, not on or off. */}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    aria-label={t(GROUP_LABEL_KEYS[groupPlan.group])}
                                    onClick={() => toggleGroup(groupPlan.group)}
                                    className="shrink-0"
                                >
                                    {box(checked)}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(groupPlan.group)}
                                    className="min-w-0 flex-1 text-left text-sm text-[color:var(--st-t1)]"
                                >
                                    {t(GROUP_LABEL_KEYS[groupPlan.group])}
                                </button>
                                <span className={`shrink-0 text-xs ${mutedColor}`}>
                                    {t('options.allSettingsImportGroupCount', { n: groupPlan.changes.length })}
                                </span>
                                <button
                                    type="button"
                                    aria-expanded={open}
                                    aria-label={t('options.allSettingsImportShowKeys')}
                                    onClick={() => toggleOpen(groupPlan.group)}
                                    className={`shrink-0 rounded-lg p-1 transition-colors ${hoverClass} ${mutedColor}`}
                                >
                                    <ChevronRight size={14} className={`transition-transform${open ? ' rotate-90' : ''}`} />
                                </button>
                            </div>
                            {open && (
                                <ul className={`ml-12 mr-4 mb-3 space-y-1 border-l pl-3 text-[11px] leading-5 ${isDaylight ? 'border-zinc-900/10' : 'border-white/10'} ${mutedColor}`}>
                                    {groupPlan.changes.map(change => (
                                        <li key={change.key} className="truncate font-mono">{change.key}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}

                {(plan?.skipped.length ?? 0) > 0 && (
                    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${rowClass} ${mutedColor}`}>
                        <Info size={13} className="mt-0.5 shrink-0" />
                        <span>{t('options.allSettingsImportSkipped', { n: plan?.skipped.length ?? 0 })}</span>
                    </div>
                )}

                {(plan?.mods?.length ?? 0) > 0 && (
                    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${rowClass} ${mutedColor}`}>
                        <Info size={13} className="mt-0.5 shrink-0" />
                        <span>{t('options.allSettingsImportMods', { n: plan?.mods?.length ?? 0 })}</span>
                    </div>
                )}

                <p className={`px-1 text-[11px] leading-[18px] ${mutedColor}`}>
                    {t('options.allSettingsImportReloadHint')}
                </p>
            </div>
        </ThemedDialog>
    );
};

export default AllSettingsImportDialog;
