import React from 'react';
import { AlertTriangle, Blend, Disc3, Orbit, Sparkles, Waves } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { CROSSFADE_MAX_SEC, CROSSFADE_MIN_SEC } from '../../../services/automix/crossfadePlanner';
import { canAnalyseTracks, type TransitionMode } from '../../../services/automix/transitionStrategy';
import { transitionCapabilities } from '../../../services/automix/stems';
import { modelsPresent, subscribeModelAvailability } from '../../../services/automix/modelAvailability';
import { announceTransition } from '../../../services/automix/transitionCue';
import AutomixModelsSection from './AutomixModelsSection';

// src/components/modal/settings/TransitionSettingsSection.tsx
// The Folia transition block on the playback options page: the master switch, the choice between
// the two strategies, and the one control that belongs to each.
//
// UI only. It reads the store and calls its actions; every question about what a mode DOES is
// answered in services/automix/transitionStrategy.ts. The two things it works out for itself -
// which mode is actually running, and whether this build is the full one - are both asked of the
// services rather than decided here.

/**
 * The pass played when the animation switch goes on: an unremarkable ten-second blend at 120 BPM
 * with the handover slightly past the middle. Long enough to clear the animation's own minimum,
 * and shaped like the blends it will actually be drawing rather than like a demo.
 */
const PREVIEW_CUE = { seconds: 10, crossover: 0.55, periodSec: 0.5 };

type TransitionSettingsSectionProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
};

const TransitionSettingsSection: React.FC<TransitionSettingsSectionProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const {
        automixEnabled,
        transitionMode,
        crossfadeMaxSec,
        transitionPerformance,
        transitionAnimation,
        enableMediaCache,
        onToggleAutomix,
        onSetTransitionMode,
        onSetCrossfadeMaxSec,
        onToggleTransitionPerformance,
        onToggleTransitionAnimation,
        onToggleMediaCache,
    } = useSettingsUiStore(useShallow(state => ({
        automixEnabled: state.automixEnabled,
        transitionMode: state.transitionMode,
        crossfadeMaxSec: state.crossfadeMaxSec,
        transitionPerformance: state.transitionPerformance,
        transitionAnimation: state.transitionAnimation,
        enableMediaCache: state.enableMediaCache,
        onToggleAutomix: state.handleToggleAutomix,
        onSetTransitionMode: state.handleSetTransitionMode,
        onSetCrossfadeMaxSec: state.handleSetCrossfadeMaxSec,
        onToggleTransitionPerformance: state.handleToggleTransitionPerformance,
        onToggleTransitionAnimation: state.handleToggleTransitionAnimation,
        onToggleMediaCache: state.handleToggleMediaCache,
    })));

    const accentOutlineColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';
    const rangeInputClass = `w-full accent-current ${isDaylight ? 'text-zinc-900' : 'text-white'}`;
    // Asked on every render rather than cached: it is a property lookup, and a cached answer would
    // be a second source of truth for a question whose whole job is to be the current one.
    const analysable = canAnalyseTracks();
    // Subscribed purely to re-render: whether the weights are on disk is answered over IPC and can
    // change while this page is open, and a badge that settled on its first render would go on
    // saying "compatible" after the model it was waiting for arrived.
    React.useSyncExternalStore(subscribeModelAvailability, modelsPresent);
    // Which of the two builds is running. Same reason it is not cached: the answer is the point.
    const capabilities = transitionCapabilities();
    // A desktop build that simply has not downloaded a model yet. Separated from the browser case
    // because one is a limit and the other is an errand.
    const awaitingModels = capabilities.desktop && !capabilities.full;

    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : {
                borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.05)',
            }
    );

    const modes: Array<{
        value: TransitionMode;
        icon: React.ReactNode;
        label: string;
        desc: string;
        disabled: boolean;
    }> = [
        {
            value: 'crossfade',
            icon: <Waves size={14} />,
            label: t('options.transitionCrossfade'),
            desc: t('options.transitionCrossfadeDesc'),
            disabled: false,
        },
        {
            value: 'automix',
            icon: <Disc3 size={14} />,
            label: t('options.transitionAutomix'),
            desc: t('options.transitionAutomixDesc'),
            disabled: !analysable,
        },
    ];

    // Which mode is actually running, which is not always the one that is selected: automix with no
    // way to measure a track degrades to the stable crossfade, and a setting that goes on claiming
    // otherwise is the failure this line exists to prevent.
    const effectiveMode: TransitionMode = transitionMode === 'automix' && !analysable
        ? 'crossfade'
        : transitionMode;

    // Both of these say the selected mode is not the mode that will run, which is the one thing a
    // settings page must never leave quiet. `fix` is what the reader can do about it from here: the
    // caching one is a switch on another page, and a warning that only names the page is a warning
    // most people close.
    const notice: { text: string; fix: (() => void) | null } | null = !analysable
        ? { text: t('options.transitionAutomixUnavailable'), fix: null }
        : !enableMediaCache
            ? { text: t('options.transitionAutomixNeedsCache'), fix: () => onToggleMediaCache(true) }
            : null;

    return (
        <section>
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Blend size={14} /> {t('options.transitionSettings')}
            </h3>
            <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                <div className="p-4 flex items-start justify-between gap-4">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.transitionEnable')}
                    </div>
                    <button
                        type="button"
                        onClick={() => onToggleAutomix(!automixEnabled)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${automixEnabled ? '' : toggleOffBackgroundClass}`}
                        style={{ backgroundColor: automixEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        aria-pressed={automixEnabled}
                        aria-label={t('options.transitionEnable')}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${automixEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                <div
                    className={`p-4 space-y-3 border-t transition-opacity ${automixEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}
                    style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}
                >
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.transitionMode')}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {modes.map((mode) => {
                            const selected = transitionMode === mode.value;
                            return (
                                <button
                                    key={mode.value}
                                    type="button"
                                    onClick={() => onSetTransitionMode(mode.value)}
                                    disabled={mode.disabled}
                                    className="rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                                    style={getAccentOptionStyle(selected)}
                                    aria-pressed={selected}
                                >
                                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                        {mode.icon}
                                        {mode.label}
                                        {selected && (
                                            <span
                                                className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                                                style={{ backgroundColor: `${accentOutlineColor}24`, color: 'var(--text-primary)' }}
                                            >
                                                {effectiveMode === mode.value
                                                    ? t('options.transitionActive')
                                                    : t('options.transitionFellBack')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {mode.desc}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {transitionMode === 'crossfade' ? (
                        <div className="space-y-3 pt-1">
                            <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                <span>{t('options.crossfadeMaxSeconds')}</span>
                                <span className="font-mono opacity-70 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.crossfadeSecondsValue', { seconds: crossfadeMaxSec })}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={CROSSFADE_MIN_SEC}
                                max={CROSSFADE_MAX_SEC}
                                step="1"
                                value={crossfadeMaxSec}
                                onChange={(event) => onSetCrossfadeMaxSec(Number(event.target.value))}
                                className={rangeInputClass}
                                aria-label={t('options.crossfadeMaxSeconds')}
                            />
                            <div className="flex justify-between text-[11px] font-mono opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                <span>{t('options.crossfadeSecondsValue', { seconds: CROSSFADE_MIN_SEC })}</span>
                                <span>{t('options.crossfadeSecondsValue', { seconds: CROSSFADE_MAX_SEC })}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2 pt-1">
                            {/* First, not last. This is the one line on the page that says the mode
                                below it will not do what it says, and at the bottom of a panel of
                                switches it read as a footnote to them. */}
                            {notice && (
                                <div
                                    className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed"
                                    style={{
                                        borderColor: 'rgba(245, 158, 11, 0.5)',
                                        backgroundColor: isDaylight ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.14)',
                                        color: isDaylight ? '#92400e' : '#fcd34d',
                                    }}
                                    role="status"
                                >
                                    <AlertTriangle size={14} className="mt-px shrink-0" />
                                    <div className="min-w-0 font-medium">
                                        {notice.text}
                                        {notice.fix && (
                                            <button
                                                type="button"
                                                onClick={notice.fix}
                                                className="ml-2 font-semibold underline underline-offset-2"
                                            >
                                                {t('options.transitionAutomixEnableCache')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            {/* Which build this is. The desktop app separates the two tracks and
                                hands them over stem by stem; the browser cannot run either model
                                and gets the same planner over less evidence. Said out loud because
                                the two sound different and nothing else would explain why. */}
                            <div
                                className="flex items-center gap-2 text-[11px]"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                <span
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0"
                                    style={{
                                        backgroundColor: capabilities.full
                                            ? `${accentOutlineColor}24`
                                            : isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                                        color: 'var(--text-primary)',
                                    }}
                                >
                                    {t(capabilities.full ? 'options.transitionEngineFull' : 'options.transitionEngineLite')}
                                </span>
                                <span className="opacity-60">
                                    {t(capabilities.full
                                        ? 'options.transitionEngineFullDesc'
                                        : awaitingModels
                                            ? 'options.transitionEngineNeedsModels'
                                            : 'options.transitionEngineLiteDesc')}
                                </span>
                            </div>
                            {/* Greyed, not hidden, when the build cannot separate a track: the
                                gesture is built from the outgoing drum stem, so no separation means
                                nothing to build it from, and a switch that silently does nothing is
                                a failure this codebase has paid for before. A master-track version
                                was rejected - `playbackRate` preserves pitch (see tempoBend.ts), so
                                the rise the gesture is for cannot exist there. */}
                            <div
                                className={`flex items-start justify-between gap-4 rounded-lg border px-3 py-3 transition-opacity ${capabilities.stems ? '' : 'opacity-45'}`}
                                style={{
                                    borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                <div className="min-w-0">
                                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                        <Sparkles size={14} />
                                        {t('options.transitionPerformance')}
                                    </div>
                                    <div className="mt-1 text-[11px] leading-relaxed opacity-60 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                        {capabilities.stems
                                            ? t('options.transitionPerformanceDesc')
                                            : t(capabilities.desktop
                                                ? 'options.transitionPerformanceNeedsModel'
                                                : 'options.transitionPerformanceNeedsStems')}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={!capabilities.stems}
                                    onClick={() => onToggleTransitionPerformance(!transitionPerformance)}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 disabled:cursor-not-allowed ${transitionPerformance && capabilities.stems ? '' : toggleOffBackgroundClass}`}
                                    style={{ backgroundColor: transitionPerformance && capabilities.stems ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                    aria-pressed={transitionPerformance && capabilities.stems}
                                    aria-label={t('options.transitionPerformance')}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${transitionPerformance && capabilities.stems ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            {/* The one control here whose effect is not a sound. Switching it on
                                plays a preview pass immediately: the animation it enables otherwise
                                waits for the next long blend, which may be minutes off and may not
                                be long enough, and a switch that looks inert is the same failure as
                                one that is. */}
                            <div
                                className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3"
                                style={{
                                    borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                <div className="min-w-0">
                                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                        <Orbit size={14} />
                                        {t('options.transitionAnimation')}
                                    </div>
                                    <div className="mt-1 text-[11px] leading-relaxed opacity-60 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.transitionAnimationDesc')}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !transitionAnimation;
                                        onToggleTransitionAnimation(next);
                                        if (next) announceTransition(PREVIEW_CUE);
                                    }}
                                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${transitionAnimation ? '' : toggleOffBackgroundClass}`}
                                    style={{ backgroundColor: transitionAnimation ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                    aria-pressed={transitionAnimation}
                                    aria-label={t('options.transitionAnimation')}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${transitionAnimation ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Below BOTH modes, not inside the automix branch: the beat grid is not an
                        automix-only feature - crossfade reads the same profile for alignment, so
                        profiling is gated on the feature, not the mode (see prefetchService).
                        Inside one branch, the only way to download the weights vanished for anyone
                        on the other mode. Kept in this section though, not a category of its own,
                        because it belongs to Folia transitions. */}
                    {capabilities.desktop && <AutomixModelsSection isDaylight={isDaylight} />}
                </div>
            </div>
        </section>
    );
};

export default TransitionSettingsSection;
