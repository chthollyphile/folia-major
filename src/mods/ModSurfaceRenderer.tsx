import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, TriangleAlert, CircleCheck, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModsStore } from './useModsStore';
import type { FoliumParam } from './folium/contract';
import { FoliumParamFields, type FoliumParamFieldToken } from './folium/FoliumParamFields';
import { mergeFoliumParamValues, resolveFoliumLabel } from './folium/params';
import { useFoliumRegistryEntries, type FoliumRegistryEntry } from './folium/registry';
import { commandsRegistry, runFoliumCommand, useFoliumCommandState, type StoredFoliumCommand } from './folium/registries/commands';
import { useFoliumStatusStore } from './folium/status';
import { FoliumSettingsSections, settingsSectionsRegistry } from './folium/registries/settingsSections';
import type { Theme } from '@/types';

// src/mods/ModSurfaceRenderer.tsx
// A mod's surface inside the mods panel: the runtime problems its client ran
// into, its settings sections, and the commands it registered (each a card
// built from its param schema). Everything here reads Folium registries; the
// loader state only decides whether the mod is running at all.

interface ModSurfaceRendererProps {
    modId: string;
    theme: Theme;
    isDaylight: boolean;
}

/*
 * The mod panel is dark chrome regardless of app theme, so its field token is
 * hardcoded here rather than derived from `theme`.
 */
const MOD_PANEL_FIELD_TOKEN: FoliumParamFieldToken = {
    label: 'text-[11px] opacity-60 truncate',
    readonlyLabel: 'text-[10px] opacity-50',
    input: 'w-full bg-black/25 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-white/30 disabled:opacity-50 min-w-0',
    rangeClass: 'w-full h-1.5 appearance-none rounded-full bg-white/10 cursor-pointer disabled:opacity-40 min-w-0',
    rangeStyle: { accentColor: 'var(--text-primary, #e8e8ec)' } as React.CSSProperties,
    toggleOn: 'bg-white/20 text-white',
    toggleOff: 'bg-black/20 text-white/50',
    dotOn: 'bg-emerald-400',
    dotOff: 'bg-white/20',
};

const ModCommandCard: React.FC<{ modId: string; entry: FoliumRegistryEntry<StoredFoliumCommand> }> = ({ modId, entry }) => {
    const { t, i18n } = useTranslation();
    const exportedProgress = useModsStore((state) => state.exportProgress);
    const cancelActiveExport = useModsStore((state) => state.cancelActiveExport);
    const runState = useFoliumCommandState((state) => state.byId[entry.id]);
    const params: FoliumParam[] = entry.def.params;
    const [values, setValues] = useState<Record<string, unknown>>(() => mergeFoliumParamValues(params, undefined));

    const title = useMemo(
        () => resolveFoliumLabel(entry.def.def.label, i18n.language, entry.name),
        [entry.def.def.label, i18n.language, entry.name],
    );
    const description = resolveFoliumLabel(entry.def.def.description, i18n.language, '');
    const showProgress = exportedProgress !== null && exportedProgress.modId === modId;
    const isRunning = Boolean(runState?.running) || (showProgress && exportedProgress?.phase === 'rendering');

    const updateParam = (param: FoliumParam, value: unknown) => {
        setValues((previous) => ({ ...previous, [param.key]: value }));
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-2.5 bg-black/20 rounded-xl p-3"
        >
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{title}</div>
                    {description ? (
                        <div className="text-[11px] opacity-55 mt-0.5 leading-snug">{description}</div>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={() => void runFoliumCommand(entry, values)}
                    disabled={isRunning}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors ${
                        isRunning
                            ? 'bg-white/10 text-white/40 cursor-not-allowed'
                            : 'bg-white/10 hover:bg-white/20 text-white/90'
                    }`}
                >
                    {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    {isRunning ? t('mods.running') : t('mods.runCommand')}
                </button>
            </div>

            {params.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <FoliumParamFields
                        params={params}
                        values={values}
                        disabled={isRunning}
                        token={MOD_PANEL_FIELD_TOKEN}
                        onChange={updateParam}
                    />
                </div>
            ) : null}

            {showProgress && exportedProgress?.phase === 'rendering' ? (
                <div className="flex flex-col gap-1.5">
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                            className="h-full rounded-full bg-white/70"
                            animate={{ width: `${exportedProgress.percent}%` }}
                            transition={{ duration: 0.2 }}
                        />
                    </div>
                    <div className="flex items-center justify-between text-[10px] opacity-70">
                        <span>{exportedProgress.frame} / {exportedProgress.totalFrames} ({exportedProgress.percent}%)</span>
                        <button
                            type="button"
                            onClick={cancelActiveExport}
                            className="text-red-300 hover:text-red-200"
                        >
                            {t('mods.cancelExport')}
                        </button>
                    </div>
                </div>
            ) : null}

            {runState?.lastError ? (
                <div className="flex items-center gap-1.5 text-[11px] text-red-300">
                    <TriangleAlert size={13} />
                    {t(`mods.errors.${runState.lastError}`, runState.lastError)}
                </div>
            ) : null}
            {runState?.lastResult && !runState.lastError ? (
                <div className="flex flex-col gap-1">
                    {runState.lastResult.summary ? (
                        <div className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                            <CircleCheck size={13} className="mt-px shrink-0" />
                            <span className="break-all">{runState.lastResult.summary}</span>
                        </div>
                    ) : null}
                    {runState.lastResult.warnings.map((warning) => (
                        <div key={warning} className="flex items-start gap-1.5 text-[11px] text-amber-300">
                            <TriangleAlert size={13} className="mt-px shrink-0" />
                            <span>{t(`mods.warnings.${warning}`, warning)}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </motion.div>
    );
};

const EMPTY_ISSUES: never[] = [];

export const ModSurfaceRenderer: React.FC<ModSurfaceRendererProps> = ({ modId, theme, isDaylight }) => {
    const { t, i18n } = useTranslation();
    const mod = useModsStore((state) => state.mods.find((entry) => entry.id === modId));
    const commands = useFoliumRegistryEntries(commandsRegistry);
    const sections = useFoliumRegistryEntries(settingsSectionsRegistry);
    const issues = useFoliumStatusStore((state) => state.issues[modId] ?? EMPTY_ISSUES);
    const own = commands.filter((entry) => entry.modId === modId);
    const hasSections = sections.some((entry) => entry.modId === modId);
    if (!mod || mod.status !== 'loaded' || (own.length === 0 && issues.length === 0 && !hasSections)) {
        return null;
    }
    return (
        <div className="flex flex-col gap-2.5">
            {issues.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-xl bg-red-500/10 p-2.5">
                    <div className="text-[11px] font-medium text-red-300">{t('mods.clientIssues')}</div>
                    {issues.map((issue) => (
                        <div key={`${issue.at}-${issue.where}`} className="text-[11px] text-red-200/90 break-words">
                            <span className="opacity-60">{issue.where}: </span>{issue.message}
                        </div>
                    ))}
                </div>
            ) : null}
            <FoliumSettingsSections
                modId={modId}
                theme={theme}
                isDaylight={isDaylight}
                language={i18n.language}
                controlCardBg={isDaylight ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.2)'}
            />
            {own.map((entry) => (
                <ModCommandCard key={entry.id} modId={modId} entry={entry} />
            ))}
        </div>
    );
};
