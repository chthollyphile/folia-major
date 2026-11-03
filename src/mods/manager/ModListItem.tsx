import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckSquare, ChevronDown, CircleCheck, CircleOff, FlaskConical, ShieldAlert, ShieldCheck, ShieldQuestion, Square, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { SettingsToggle } from '../../components/modal/settings/SettingsRow';
import type { ModRuntimeInfo } from '../types';
import { ModSurfaceRenderer } from './ModSurfaceRenderer';
import { modSettingsRowId } from '../useModsStore';
import { setFoliumFaultNoticeMuted, useFoliumStatusStore } from '../runtime/status';
import { ModCostLines, ModSlowMark } from './ModCostLines';
import { isModSlow, type ModCost } from './modCost';
import type { ModManagerClasses } from './modManagerClasses';
import { translateModError } from './modErrors';
import { MOD_FILES_PERMISSION, ModStorageUsage, type ModNotice } from './ModStorageUsage';
import { useFoliumOldNameStore } from '../folium/deprecated/warnings';
import { omni } from '@/services/onlineMusic/omni';

// src/mods/manager/ModListItem.tsx
// One mod as a row of the manager's list card. The row expands in place to show the mod's
// metadata, grants, signature state and its own command surface, so params get the full width.

// Moved to modErrors.ts so the row's storage section can share it without importing this file back.
export { translateModError };

/*
 * Everything the trust dialog listed for this mod, as chips: permissions,
 * experimental opt-ins, embeddable origins, and the Folia versions it needs.
 */
const describeModGrants = (mod: ModRuntimeInfo): string[] => [
    ...mod.permissions,
    ...(mod.experimental ?? []).map((feature) => `experimental:${feature}`),
    ...(mod.embedOrigins ?? []).map((origin) => `embed:${origin}`),
    ...(mod.folia ? [`folia:${mod.folia}`] : []),
];

/*
 * Folium 1.7: the platforms the mod may call as the user through the experimental platform.raw
 * (`platform.<id>.read` / `.write`), by their names in the app.
 */
const platformGrantsOf = (mod: ModRuntimeInfo, access: 'read' | 'write'): string[] => mod.permissions
    .map((permission) => /^platform\.([^.]+)\.(read|write)$/.exec(permission))
    .filter((match): match is RegExpExecArray => match !== null && match[2] === access)
    .map((match) => omni.getProviderLabel(match[1]));

/*
 * The signature badge shown in the collapsed row. Unsigned mods get none there
 * (most third-party mods are unsigned, so a badge would be noise); the expanded
 * row explains every state.
 */
const SignatureBadge: React.FC<{ mod: ModRuntimeInfo; isDaylight: boolean }> = ({ mod, isDaylight }) => {
    const { t } = useTranslation();
    const { status } = mod.signature;
    if (status === 'verified') {
        return (
            <span title={t('mods.signatureVerified')} className={`shrink-0 ${isDaylight ? 'text-emerald-600' : 'text-emerald-300'}`}>
                <ShieldCheck size={14} />
            </span>
        );
    }
    if (status === 'beta') {
        return (
            <span title={t('mods.signatureBeta')} className={`shrink-0 ${isDaylight ? 'text-violet-600' : 'text-violet-300'}`}>
                <FlaskConical size={14} />
            </span>
        );
    }
    if (status === 'invalid') {
        return (
            <span title={t('mods.signatureInvalid')} className={`shrink-0 ${isDaylight ? 'text-amber-700' : 'text-amber-300'}`}>
                <ShieldAlert size={14} />
            </span>
        );
    }
    return null;
};

/* One line in the expanded row saying what the signature state means. */
const SignatureNotice: React.FC<{ mod: ModRuntimeInfo; isDaylight: boolean; classes: ModManagerClasses }> = ({ mod, isDaylight, classes }) => {
    const { t } = useTranslation();
    const { status, reason, keyId, keyLabel } = mod.signature;
    if (status === 'verified') {
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.success}`}>
                <ShieldCheck size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureVerified')}</span>
                    {' · '}
                    {t('mods.signatureVerifiedDetail', { key: keyLabel ? `${keyLabel}, ${keyId}` : keyId })}
                </span>
            </div>
        );
    }
    if (status === 'beta') {
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.preview}`}>
                <FlaskConical size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureBeta')}</span>
                    {' · '}
                    {t('mods.signatureBetaDetail', { key: keyLabel ? `${keyLabel}, ${keyId}` : keyId })}
                </span>
            </div>
        );
    }
    if (status === 'invalid') {
        const reasonText = t(`mods.signatureReasons.${reason ?? 'malformed'}`, { defaultValue: reason ?? '' });
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.warning}`}>
                <ShieldAlert size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureInvalid')}</span>
                    {' · '}
                    {t('mods.signatureInvalidDetail', { reason: reasonText })}
                </span>
            </div>
        );
    }
    return (
        <div
            className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${isDaylight ? 'bg-black/[0.04]' : 'bg-white/5'}`}
            style={{ color: 'var(--text-secondary)' }}
        >
            <ShieldQuestion size={14} className="mt-px shrink-0" />
            <span>
                <span className="font-medium">{t('mods.signatureUnsigned')}</span>
                {' · '}
                {t('mods.signatureUnsignedDetail')}
            </span>
        </div>
    );
};

const StatusIcon: React.FC<{ status: string; isDaylight: boolean }> = ({ status, isDaylight }) => {
    if (status === 'loaded') return <CircleCheck size={15} className={`${isDaylight ? 'text-emerald-600' : 'text-emerald-300'} shrink-0`} />;
    // 'skipped' (this run was started without mods) is not running and not broken: it reads as off.
    if (status === 'disabled' || status === 'skipped') return <CircleOff size={15} className={`${isDaylight ? 'text-zinc-400' : 'text-white/35'} shrink-0`} />;
    return <TriangleAlert size={15} className={`${isDaylight ? 'text-red-600' : 'text-red-300'} shrink-0`} />;
};

type ModListItemProps = {
    mod: ModRuntimeInfo;
    /** What the mod costs, as last read by the manager; absent until the first read is in. */
    cost?: ModCost;
    expanded: boolean;
    selected: boolean;
    selectionMode: boolean;
    isLast: boolean;
    isDaylight: boolean;
    theme: Theme;
    classes: ModManagerClasses;
    onToggleExpand: () => void;
    onToggleEnabled: () => void;
    onToggleSelected: () => void;
    /** Reports an outcome in the manager's notice line (the storage section's "clear cache"). */
    onNotice: (notice: ModNotice) => void;
};

const NO_OLD_NAMES: readonly string[] = [];

export const ModListItem: React.FC<ModListItemProps> = ({
    mod, cost, expanded, selected, selectionMode, isLast, isDaylight, theme, classes, onToggleExpand, onToggleEnabled, onToggleSelected, onNotice,
}) => {
    // Only a running mod has a cost to show.
    const runningCost = mod.status === 'loaded' ? cost : undefined;
    const { t } = useTranslation();
    const noticeMuted = useFoliumStatusStore((state) => state.mutedNotices.includes(mod.id));
    // Folium 1.6 only: the old names the mod uses, its mod.json's and main entry's, then its client's (folium/deprecated/).
    const clientOldNames = useFoliumOldNameStore((state) => state.byMod[mod.id] ?? NO_OLD_NAMES);
    const oldNames = [...(mod.warnings ?? []), ...clientOldNames];
    const grants = describeModGrants(mod);
    const readPlatforms = platformGrantsOf(mod, 'read');
    const writePlatforms = platformGrantsOf(mod, 'write');
    const meta = [mod.id, `v${mod.version ?? '-'}`, mod.author].filter(Boolean).join(' · ');

    const activate = () => {
        if (selectionMode) {
            onToggleSelected();
            return;
        }
        onToggleExpand();
    };

    return (
        <div className={isLast ? '' : `border-b ${classes.divider}`} data-settings-row={modSettingsRowId(mod.id)}>
            <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={activate}
                onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        activate();
                    }
                }}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors ${
                    expanded ? classes.expandedRow : classes.rowHover
                } ${selected ? classes.expandedRow : ''}`}
            >
                {selectionMode ? (
                    <span className={`shrink-0 ${selected ? '' : classes.muted}`} style={selected ? { color: 'var(--text-primary)' } : undefined}>
                        {selected ? <CheckSquare size={15} /> : <Square size={15} />}
                    </span>
                ) : (
                    <StatusIcon status={mod.status} isDaylight={isDaylight} />
                )}
                <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{mod.name}</span>
                        <SignatureBadge mod={mod} isDaylight={isDaylight} />
                        {isModSlow(runningCost) ? <ModSlowMark isDaylight={isDaylight} /> : null}
                    </div>
                    <div className="text-[11px] opacity-50 truncate" style={{ color: 'var(--text-secondary)' }}>{meta}</div>
                </div>
                <div onClick={(event) => event.stopPropagation()} className="shrink-0">
                    <SettingsToggle
                        checked={mod.enabled}
                        onChange={onToggleEnabled}
                        offClass={classes.toggleOff}
                        onColor={theme.secondaryColor}
                        ariaLabel={mod.enabled ? t('mods.enabled') : t('mods.disabled')}
                    />
                </div>
                <motion.span
                    animate={{ rotate: expanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className={`shrink-0 ${classes.muted} ${selectionMode ? 'invisible' : ''}`}
                >
                    <ChevronDown size={15} />
                </motion.span>
            </div>

            <AnimatePresence initial={false}>
                {expanded ? (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden"
                    >
                        <div className={`px-4 pb-4 pt-3 flex flex-col gap-3 border-t text-left ${classes.divider} ${classes.expandedRow}`}>
                            {mod.description ? (
                                <div className="text-xs leading-relaxed opacity-75" style={{ color: 'var(--text-primary)' }}>{mod.description}</div>
                            ) : null}
                            {grants.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {grants.map((grant) => (
                                        <span
                                            key={grant}
                                            className={`px-1.5 py-0.5 rounded font-mono text-[10px] opacity-70 ${classes.chip}`}
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            {grant}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <SignatureNotice mod={mod} isDaylight={isDaylight} classes={classes} />
                            {mod.devSource ? (
                                <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>{t('mods.devSourceHint')}</div>
                            ) : null}
                            {readPlatforms.length > 0 ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.platformReadHint', { platforms: readPlatforms.join(' / ') })}
                                    {writePlatforms.length > 0
                                        ? ` ${t('mods.platformWriteHint', { platforms: writePlatforms.join(' / ') })}`
                                        : ''}
                                </div>
                            ) : null}
                            {/* Folium 1.7: the one permission that lets a mod drop the user's queue, said in words. */}
                            {mod.permissions.includes('playback.queue') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.queueReplaceHint')}
                                </div>
                            ) : null}
                            {mod.permissions.includes('equalizer.control') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.equalizerControlHint')}
                                </div>
                            ) : null}
                            {/* Folium 1.8: the global lyric render quality, which every canvas or WebGL style follows. */}
                            {mod.permissions.includes('visualizer.renderQuality') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.renderQualityHint')}
                                </div>
                            ) : null}
                            {/* Folium 1.8: the mode, the styles' options and the beat effects, each its own permission. */}
                            {mod.permissions.includes('visualizer.mode') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.visualizerModeHint')}
                                </div>
                            ) : null}
                            {mod.permissions.includes('visualizer.tuning') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.visualizerTuningHint')}
                                </div>
                            ) : null}
                            {mod.permissions.includes('visualizer.beatEffects') ? (
                                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('mods.visualizerBeatEffectsHint')}
                                </div>
                            ) : null}
                            {mod.trustStale ? (
                                <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.warning}`}>
                                    <TriangleAlert size={14} className="mt-px shrink-0" />
                                    <span>{t('mods.trustRevoked')}</span>
                                </div>
                            ) : null}
                            {mod.error ? (
                                <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.danger}`}>
                                    <TriangleAlert size={14} className="mt-px shrink-0" />
                                    <span className="break-all">{translateModError(t, mod.error, 'unknown')}</span>
                                </div>
                            ) : null}
                            {/* Folium 1.6 only: the old names above (electron/modSystem/deprecated.cjs, src/mods/folium/deprecated/). */}
                            {oldNames.length > 0 ? (
                                <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.warning}`}>
                                    <TriangleAlert size={14} className="mt-px shrink-0" />
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <span>{t('mods.oldNames')}</span>
                                        {oldNames.map((warning) => (
                                            <span key={warning} className="break-words opacity-80">{warning}</span>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {/* The notice a failing mod raises can be turned off from the notice itself; this turns it back on. */}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs opacity-75" style={{ color: 'var(--text-primary)' }}>{t('mods.faultNoticeSwitch')}</span>
                                <SettingsToggle
                                    checked={!noticeMuted}
                                    onChange={() => setFoliumFaultNoticeMuted(mod.id, !noticeMuted)}
                                    offClass={classes.toggleOff}
                                    onColor={theme.secondaryColor}
                                    ariaLabel={t('mods.faultNoticeSwitch')}
                                />
                            </div>

                            {runningCost ? <ModCostLines cost={runningCost} isDaylight={isDaylight} /> : null}

                            {/* Mounted with the expanded row, so the directories are only counted when looked at. */}
                            {mod.permissions.includes(MOD_FILES_PERMISSION) ? (
                                <ModStorageUsage mod={mod} isDaylight={isDaylight} classes={classes} onNotice={onNotice} />
                            ) : null}

                            {mod.status === 'loaded' ? (
                                <ModSurfaceRenderer modId={mod.id} theme={theme} isDaylight={isDaylight} />
                            ) : (
                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {mod.status === 'skipped'
                                        ? t('mods.skippedThisRun')
                                        : mod.enabled ? t('mods.notLoaded') : t('mods.modDisabledHint')}
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
};

export default ModListItem;
