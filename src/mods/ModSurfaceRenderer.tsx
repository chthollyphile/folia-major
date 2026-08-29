import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, TriangleAlert, CircleCheck, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModCommandInfo, ModCommandParam, ModLabelMap } from './types';
import { buildDefaultCommandParams, resolveModLabel, useModsStore } from './useModsStore';
import { setVisualizerModulation, useModVisualizerModulationStore } from './visualizerModulation';

// src/mods/ModSurfaceRenderer.tsx
// Declarative command surface for a mod. Numeric params render as native range
// sliders (with a value readout); `live` sliders re-submit the command on a
// short debounce so post-processing knobs react while dragging, matching the
// project's visual language instead of a wall of number inputs.

interface ModSurfaceRendererProps {
    modId: string;
}

interface ModCommandCardProps {
    modId: string;
    command: ModCommandInfo;
}

const resolveLabel = (label: ModLabelMap | undefined, language: string, fallback: string) =>
    resolveModLabel(label, language, fallback);

// Range sliders span the full width; boolean switches stay compact half-width.
const isFullRowParam = (param: ModCommandParam) => param.type !== 'boolean';

const ModCommandCard: React.FC<ModCommandCardProps> = ({ modId, command }) => {
    const { t, i18n } = useTranslation();
    const runCommand = useModsStore((state) => state.runCommand);
    const exportedProgress = useModsStore((state) => state.exportProgress);
    const commandState = useModsStore((state) => state.commandState[`${modId}/${command.id}`]);
    const cancelActiveExport = useModsStore((state) => state.cancelActiveExport);

    const [values, setValues] = useState<Record<string, unknown>>(() => {
        const defaults = buildDefaultCommandParams(command.params ?? []);
        // Seed modulate sliders from the shared store so reopening the panel keeps the last tweak.
        for (const param of command.params ?? []) {
            if (param.modulate) {
                const current = useModVisualizerModulationStore.getState().byMode[param.modulate.mode]?.[param.key];
                if (typeof current === 'number') {
                    defaults[param.key] = current;
                }
            }
        }
        return defaults;
    });
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const liveTimerRef = useRef<number | null>(null);

    const title = useMemo(
        () => resolveLabel(command.label, i18n.language, command.id),
        [command.label, i18n.language, command.id]
    );
    const description = resolveLabel(command.description, i18n.language, '');
    const isRunning = commandState?.runningCommandId === command.id || (
        exportedProgress !== null &&
        exportedProgress.modId === modId &&
        exportedProgress.phase === 'rendering'
    );

    const commit = (latest: Record<string, unknown>) => {
        void runCommand(modId, command.id, latest);
    };

    const updateParam = (param: ModCommandParam, value: unknown) => {
        setValues((previous) => {
            const next = { ...previous, [param.key]: value };
            valuesRef.current = next;
            if (param.modulate && typeof value === 'number') {
                // Renderer-side modulation: write straight into the shared store so the
                // visualizer updates on the very next frame (no main-process round-trip).
                setVisualizerModulation(param.modulate.mode, { [param.key]: value });
            } else if (param.live) {
                if (liveTimerRef.current !== null) {
                    window.clearTimeout(liveTimerRef.current);
                }
                liveTimerRef.current = window.setTimeout(() => {
                    liveTimerRef.current = null;
                    commit(valuesRef.current);
                }, 220);
            }
            return next;
        });
    };

    useEffect(() => () => {
        if (liveTimerRef.current !== null) {
            window.clearTimeout(liveTimerRef.current);
        }
    }, []);

    const handleRun = async () => {
        if (liveTimerRef.current !== null) {
            window.clearTimeout(liveTimerRef.current);
            liveTimerRef.current = null;
        }
        await runCommand(modId, command.id, values);
    };

    const showProgress = exportedProgress !== null && exportedProgress.modId === modId;

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
                {!command.params?.some((p) => p.live || p.modulate) ? (
                    <button
                        type="button"
                        onClick={handleRun}
                        disabled={isRunning}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors ${
                            isRunning
                                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                                : 'bg-white/10 hover:bg-white/20 text-white/90'
                        }`}
                    >
                        {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                        {isRunning ? t('mods.exporting') : t('mods.runCommand')}
                    </button>
                ) : null}
            </div>

            {(command.params ?? []).length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    {(command.params ?? []).map((param) => (
                        <ModParamField
                            key={param.key}
                            param={param}
                            value={values[param.key]}
                            disabled={isRunning}
                            fullRow={isFullRowParam(param)}
                            onChange={(value) => updateParam(param, value)}
                        />
                    ))}
                </div>
            ) : null}

            {showProgress && exportedProgress.phase === 'rendering' ? (
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

            {commandState?.lastError ? (
                <div className="flex items-center gap-1.5 text-[11px] text-red-300">
                    <TriangleAlert size={13} />
                    {t(`mods.errors.${commandState.lastError}`, commandState.lastError)}
                </div>
            ) : null}
            {commandState?.lastResult && !commandState?.lastError ? (
                <div className="flex flex-col gap-1">
                    {commandState.lastResult.summary ? (
                        <div className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                            <CircleCheck size={13} className="mt-px shrink-0" />
                            <span className="break-all">{commandState.lastResult.summary}</span>
                        </div>
                    ) : null}
                    {commandState.lastResult.warnings.map((warning) => (
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

interface ModParamFieldProps {
    param: ModCommandParam;
    value: unknown;
    disabled: boolean;
    fullRow: boolean;
    onChange: (value: unknown) => void;
}

const ModParamField: React.FC<ModParamFieldProps> = ({ param, value, disabled, fullRow, onChange }) => {
    const { t, i18n } = useTranslation();
    const label = resolveLabel(param.label, i18n.language, param.key);
    const inputClass = 'w-full bg-black/25 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-white/30 disabled:opacity-50 min-w-0';

    const numeric = typeof value === 'number' || param.type === 'number';
    const numericValue = numeric && typeof value === 'number' ? value : Number(value ?? param.defaultValue ?? 0);

    return (
        <label className={`flex flex-col gap-1 min-w-0 ${fullRow ? 'col-span-2' : ''}`}>
            {param.type === 'number' ? (
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-[11px] opacity-60 truncate" title={label}>{label}</span>
                    <span className="text-[10px] tabular-nums opacity-50 shrink-0 min-w-[2.5rem] text-right">
                        {Number.isFinite(numericValue) ? formatNum(numericValue) : '—'}
                    </span>
                </div>
            ) : (
                <span className="text-[11px] opacity-60 truncate" title={label}>{label}</span>
            )}

            {param.type === 'number' ? (
                <input
                    type="range"
                    className="w-full h-1.5 appearance-none rounded-full bg-white/10 accent-emerald-300 cursor-pointer disabled:opacity-40 min-w-0"
                    style={{ accentColor: 'var(--text-primary, #e8e8ec)' } as React.CSSProperties}
                    value={numericValue}
                    min={param.min ?? 0}
                    max={param.max ?? 100}
                    step={param.step ?? 1}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.valueAsNumber)}
                />
            ) : null}
            {param.type === 'text' ? (
                <input
                    type="text"
                    className={inputClass}
                    value={typeof value === 'string' ? value : ''}
                    placeholder={param.placeholder}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                />
            ) : null}
            {param.type === 'boolean' ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(!value)}
                    className={`flex items-center gap-2 w-fit px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                        value ? 'bg-white/20 text-white' : 'bg-black/20 text-white/50'
                    } disabled:opacity-50`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${value ? 'bg-emerald-400' : 'bg-white/20'}`} />
                    {value ? t('mods.enabled') : t('mods.disabled')}
                </button>
            ) : null}
            {param.type === 'select' ? (
                <select
                    className={inputClass}
                    value={typeof value === 'string' ? value : ''}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                >
                    {(param.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                            {resolveLabel(option.label, i18n.language, option.value)}
                        </option>
                    ))}
                </select>
            ) : null}
        </label>
    );
};

const formatNum = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
};

export const ModSurfaceRenderer: React.FC<ModSurfaceRendererProps> = ({ modId }) => {
    const mod = useModsStore((state) => state.mods.find((entry) => entry.id === modId));
    if (!mod || mod.status !== 'loaded' || mod.commands.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-2.5">
            {mod.commands.map((command) => (
                <ModCommandCard key={command.id} modId={modId} command={command} />
            ))}
        </div>
    );
};