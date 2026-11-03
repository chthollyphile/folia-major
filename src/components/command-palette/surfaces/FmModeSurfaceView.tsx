import React, { useEffect, useMemo, useRef } from 'react';
import { Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { getPersonalFmSelectionLabel, DEFAULT_PERSONAL_FM_CATALOG, type PersonalFmCatalog, type PersonalFmSelection } from '../../../services/onlineMusic/fmModes';
import { readPersonalFmOption } from '../commands/fmModeOptions';
import { buildPersonalFmSections } from './fmModeSurface';
import type { CommandPaletteMatch } from '../types';

// src/components/command-palette/surfaces/FmModeSurfaceView.tsx
// Personal FM mode picker, laid out like the volume control: one header stating the current value,
// then the control itself. Modes and scenes are the same pill, because picking a scene is just a
// shorter way of picking Scene mode plus its submode.

type FmModeSurfaceViewProps = {
    matches: CommandPaletteMatch[];
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    executeMatch: (index: number) => Promise<boolean>;
    isDaylight: boolean;
    isExecuting: boolean;
    theme: Theme;
    selection: PersonalFmSelection;
    catalog?: PersonalFmCatalog;
};

const isSelectedOption = (commandId: string, selection: PersonalFmSelection) => {
    const option = readPersonalFmOption(commandId);
    if (!option) return false;
    return option.kind === 'mode' ? option.id === selection.mode : option.id === selection.scene;
};

const FmModeSurfaceView: React.FC<FmModeSurfaceViewProps> = ({
    matches,
    activeIndex,
    setActiveIndex,
    executeMatch,
    isDaylight,
    isExecuting,
    theme,
    selection,
    catalog = DEFAULT_PERSONAL_FM_CATALOG,
}) => {
    const { t } = useTranslation();
    const translate = (key: string, fallback?: string) => t(key, { defaultValue: fallback ?? key });
    const activePillRef = useRef<HTMLButtonElement | null>(null);
    const sections = useMemo(() => buildPersonalFmSections(matches, catalog), [matches, catalog]);

    // Arrow keys move activeIndex through the shared match pipeline, so the view only has to keep
    // the highlighted pill in sight.
    useEffect(() => {
        activePillRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (matches.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center opacity-50">
                <Radio size={26} />
                <div className="text-sm">{t('commandPalette.empty', 'No matching command')}</div>
            </div>
        );
    }

    const mutedText = isDaylight ? 'text-black/45' : 'text-white/45';
    const idleBg = isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]';
    const activeBg = isDaylight ? 'bg-black/[0.08]' : 'bg-white/[0.12]';

    return (
        <div className="flex h-full items-start justify-center px-4 py-8">
            <div className="w-full max-w-lg px-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Radio size={22} style={{ color: theme.accentColor }} />
                        <div>
                            <div className="text-sm font-medium">{t('commandPalette.fmModeTitle', 'Personal FM mode')}</div>
                            <div className="mt-0.5 text-xs opacity-50">
                                {t('commandPalette.fmModeHint', 'Pick a scene to switch straight into scene mode')}
                            </div>
                        </div>
                    </div>
                    <div className="truncate text-base font-semibold" style={{ color: theme.primaryColor }}>
                        {getPersonalFmSelectionLabel(selection, translate, catalog)}
                    </div>
                </div>

                <div className="space-y-2.5">
                    {sections.map(section => (
                        <div key={section.key} className="flex items-start gap-3">
                            <span className={`w-12 shrink-0 pt-1.5 text-[10px] leading-none ${mutedText}`}>
                                {section.labelKey ? t(section.labelKey, section.labelFallback) : section.labelFallback}
                            </span>
                            <div className="flex flex-1 flex-wrap gap-1.5">
                                {section.indices.map(index => {
                                    const match = matches[index];
                                    const isSelected = isSelectedOption(match.command.id, selection);
                                    const isActive = index === activeIndex;
                                    return (
                                        <button
                                            key={match.command.id}
                                            ref={isActive ? activePillRef : undefined}
                                            type="button"
                                            data-fm-option={match.command.id}
                                            data-fm-selected={isSelected ? 'true' : 'false'}
                                            data-fm-active={isActive ? 'true' : 'false'}
                                            disabled={isExecuting}
                                            onMouseEnter={() => {
                                                if (!isExecuting) {
                                                    setActiveIndex(index);
                                                }
                                            }}
                                            onClick={() => {
                                                if (!isExecuting) {
                                                    setActiveIndex(index);
                                                    void executeMatch(index);
                                                }
                                            }}
                                            className={`rounded-full px-3 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                                                isSelected ? 'font-medium' : isActive ? activeBg : idleBg
                                            }`}
                                            style={isSelected
                                                ? { backgroundColor: theme.accentColor, color: 'var(--bg-color)' }
                                                : undefined}
                                        >
                                            {match.command.title}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FmModeSurfaceView;
