import React, { useMemo, useState } from 'react';
import { Loader2, Play, TriangleAlert, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { colorWithAlpha } from '@/components/visualizer/colorMix';
import type { FoliumParam } from './contract';
import { FoliumParamFields, type FoliumParamFieldToken } from './FoliumParamFields';
import { mergeFoliumParamValues, resolveFoliumLabel } from './params';
import { useFoliumRegistryEntries } from './registry';
import { commandsRegistry, runFoliumCommand, useFoliumCommandState } from './registries/commands';

// src/mods/folium/FoliumCommandSurfaceView.tsx
// Command-palette body for a mod command that declares params: the same form
// the mods panel shows, themed for the palette, with a Run button. Loaded
// lazily through the command's surface (see commandPaletteSync.ts).

interface FoliumCommandSurfaceViewProps {
    commandId: string;
    theme: Theme;
    isDaylight: boolean;
    close: () => void;
}

const FoliumCommandSurfaceView: React.FC<FoliumCommandSurfaceViewProps> = ({ commandId, theme, isDaylight, close }) => {
    const { t, i18n } = useTranslation();
    const entries = useFoliumRegistryEntries(commandsRegistry);
    const entry = entries.find((candidate) => candidate.id === commandId) ?? null;
    const params: FoliumParam[] = entry?.def.params ?? [];
    const [values, setValues] = useState<Record<string, unknown>>(() => mergeFoliumParamValues(params, undefined));
    const runState = useFoliumCommandState((state) => state.byId[commandId]);

    const fieldBorder = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.2 : 0.18);
    const token: FoliumParamFieldToken = useMemo(() => ({
        label: 'text-xs opacity-70 truncate',
        readonlyLabel: 'text-xs opacity-60 font-mono',
        input: 'w-full rounded-lg px-2.5 py-1.5 text-xs outline-none min-w-0',
        inputStyle: { backgroundColor: colorWithAlpha(theme.backgroundColor, 0.3), border: `1px solid ${fieldBorder}`, color: 'var(--text-primary)' },
        rangeStyle: { accentColor: theme.accentColor },
        toggleOn: '',
        toggleOff: '',
        dotOn: '',
        dotOff: '',
        toggleOnStyle: { backgroundColor: colorWithAlpha(theme.accentColor, 0.22), border: `1px solid ${fieldBorder}`, color: 'var(--text-primary)' },
        toggleOffStyle: { border: `1px solid ${fieldBorder}`, color: 'var(--text-primary)' },
        dotOnStyle: { backgroundColor: theme.accentColor },
        dotOffStyle: { backgroundColor: colorWithAlpha(theme.primaryColor, 0.3) },
    }), [theme, fieldBorder]);

    if (!entry) {
        return <div className="p-4 text-xs opacity-60">{t('mods.commandUnavailable')}</div>;
    }

    const description = resolveFoliumLabel(entry.def.def.description, i18n.language, '');
    const running = Boolean(runState?.running);
    const run = async () => {
        const result = await runFoliumCommand(entry, values);
        if (result.ok && result.result === undefined) close();
    };

    return (
        <div className="flex flex-col gap-3 p-4" style={{ color: 'var(--text-primary)' }}>
            {description ? <div className="text-xs opacity-60 leading-snug">{description}</div> : null}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <FoliumParamFields
                    params={params}
                    values={values}
                    disabled={running}
                    token={token}
                    onChange={(param, value) => setValues((previous) => ({ ...previous, [param.key]: value }))}
                />
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    disabled={running}
                    onClick={() => void run()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ backgroundColor: colorWithAlpha(theme.accentColor, 0.22), border: `1px solid ${fieldBorder}` }}
                >
                    {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    {running ? t('mods.running') : t('mods.runCommand')}
                </button>
                {runState?.lastError ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-red-400">
                        <TriangleAlert size={13} />
                        {t(`mods.errors.${runState.lastError}`, runState.lastError)}
                    </span>
                ) : null}
                {runState?.lastResult?.summary && !runState.lastError ? (
                    <span className="flex items-center gap-1.5 text-[11px] opacity-80 break-all">
                        <CircleCheck size={13} className="shrink-0" />
                        {runState.lastResult.summary}
                    </span>
                ) : null}
            </div>
        </div>
    );
};

export default FoliumCommandSurfaceView;
