import React, { useMemo, useRef, useState } from 'react';
import { DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type PartitaTuning, type TiltColorScheme, type TiltTuning } from '../../types';
import { colorWithAlpha } from './colorMix';
import { type VisualizerSettingsPanelProps } from './definition';
import { DioramaGeometrySettings } from './diorama/DioramaGeometrySettings';
import { DioramaBackgroundParticleSettings } from './diorama/DioramaBackgroundParticleSettings';
import { DioramaEffectSettings } from './diorama/DioramaEffectSettings';
import { DioramaSettingsToggle } from './diorama/DioramaSettingsToggle';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from './diorama/dioramaMoteField';

// src/components/visualizer/settingsPanels.tsx
// Mode-owned preview settings panels used by discoverable visualizer entries.
interface PresetOption<T> {
    label: string;
    value: T;
}

interface PresetGroupProps<T> {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (next: T) => void;
    isDaylight: boolean;
    theme: VisualizerSettingsPanelProps['theme'];
}

const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));
const clampClassicBreathingFloatMultiplier = (value: number) => Math.min(2, Math.max(0, value));
const clampClassicWordSpacing = (value: number) => Math.min(2, Math.max(0, value));
const clampCladdaghFocusScaleRatio = (val: number) => Math.min(1.5, Math.max(0.0, val));
const clampCladdaghRadiusScale = (val: number) => Math.min(1.5, Math.max(0.5, val));
const clampCladdaghEllipseTiltDeg = (val: number) => Math.min(60, Math.max(0, val));

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    theme,
}: PresetGroupProps<T>) => (
    <div className="space-y-2.5">
        <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
            {label}
        </div>
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = option.value === value;

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className="px-3 py-2 rounded-full text-sm transition-all border"
                        style={{
                            color: theme.primaryColor,
                            borderColor: isActive ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                            backgroundColor: isActive
                                ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            boxShadow: isActive ? `inset 0 0 0 1px ${theme.accentColor}` : 'none',
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

export const ClassicSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    classicTuning = DEFAULT_CLASSIC_TUNING,
    onClassicTuningChange,
}) => {
    const resolvedClassicTuning: Required<ClassicTuning> = {
        enableWordRotation: classicTuning.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
        breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
            classicTuning.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
        ),
        useLegacyLayout: classicTuning.useLegacyLayout ?? DEFAULT_CLASSIC_TUNING.useLegacyLayout ?? false,
        wordSpacing: clampClassicWordSpacing(
            classicTuning.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7
        ),
    };
    const wordRotationOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.classicWordRotationOn')  },
        { value: false, label: t('options.classicWordRotationOff')  },
    ]), [t]);
    const legacyLayoutOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: false, label: t('options.classicLegacyLayoutOff')  },
        { value: true, label: t('options.classicLegacyLayoutOn')  },
    ]), [t]);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.classicSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.classicSettingsDesc')}
                </div>
            </div>

            <PresetGroup
                label={t('options.classicWordRotation') }
                value={resolvedClassicTuning.enableWordRotation}
                options={wordRotationOptions}
                onChange={(enabled) => onClassicTuningChange?.({ enableWordRotation: enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <PresetGroup
                label={t('options.classicLegacyLayout') }
                value={resolvedClassicTuning.useLegacyLayout || false}
                options={legacyLayoutOptions}
                onChange={(enabled) => onClassicTuningChange?.({ useLegacyLayout: enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.classicBreathingFloatMultiplier') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedClassicTuning.breathingFloatMultiplier.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={resolvedClassicTuning.breathingFloatMultiplier}
                    onChange={(event) => onClassicTuningChange?.({ breathingFloatMultiplier: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            {!resolvedClassicTuning.useLegacyLayout && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                        <span>{t('options.classicWordSpacing') }</span>
                        <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                            {resolvedClassicTuning.wordSpacing.toFixed(2)}x
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={resolvedClassicTuning.wordSpacing}
                        onChange={(event) => onClassicTuningChange?.({ wordSpacing: parseFloat(event.target.value) })}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                        className={rangeInputClass}
                    />
                </div>
            )}
        </div>
    );
};

export const PartitaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    onPartitaTuningChange,
}) => {
    const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);
    const resolvedPartitaTuning: PartitaTuning = {
        showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: partitaTuning.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
    const guideLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn')  },
        { value: false, label: t('options.partitaGuideLinesOff')  },
    ]), [t]);
    const semanticLayoutOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaSemanticLayoutOn')  },
        { value: false, label: t('options.partitaSemanticLayoutOff')  },
    ]), [t]);
    const handlePartitaMinChange = (next: number) => {
        const clampedNext = clampPartitaStagger(next);
        onPartitaTuningChange?.({
            staggerMin: clampedNext,
            staggerMax: Math.max(clampedNext, resolvedPartitaTuning.staggerMax),
        });
    };
    const handlePartitaMaxChange = (next: number) => {
        const clampedNext = clampPartitaStagger(next);
        onPartitaTuningChange?.({
            staggerMin: Math.min(resolvedPartitaTuning.staggerMin, clampedNext),
            staggerMax: clampedNext,
        });
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.partitaSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.partitaSettingsDesc')}
                </div>
            </div>

            <PresetGroup
                label={t('options.partitaGuideLines') }
                value={resolvedPartitaTuning.showGuideLines}
                options={guideLineOptions}
                onChange={(enabled) => onPartitaTuningChange?.({ showGuideLines: enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <PresetGroup
                label={t('options.partitaSemanticLayout') }
                value={resolvedPartitaTuning.useSemanticLayout}
                options={semanticLayoutOptions}
                onChange={(enabled) => onPartitaTuningChange?.({ useSemanticLayout: enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.partitaStaggerMin') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedPartitaTuning.staggerMin}px
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="180"
                    step="5"
                    value={resolvedPartitaTuning.staggerMin}
                    onChange={(event) => handlePartitaMinChange(parseFloat(event.target.value))}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.partitaStaggerMax') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedPartitaTuning.staggerMax}px
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="180"
                    step="5"
                    value={resolvedPartitaTuning.staggerMax}
                    onChange={(event) => handlePartitaMaxChange(parseFloat(event.target.value))}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined): FumeTuning['cameraTrackingMode'] => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export const FumeSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    fumeTuning = DEFAULT_FUME_TUNING,
    onFumeTuningChange,
}) => {
    const resolvedFumeTuning: FumeTuning = {
        hidePrintSymbols: fumeTuning.hidePrintSymbols,
        disableGeometricBackground: fumeTuning.disableGeometricBackground,
        backgroundObjectOpacity: Math.min(1, Math.max(0, fumeTuning.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity)),
        textHoldRatio: Math.min(1, Math.max(0, fumeTuning.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio)),
        cameraTrackingMode: resolveFumeCameraTrackingMode(fumeTuning.cameraTrackingMode),
        cameraSpeed: Math.min(1.85, Math.max(0.55, fumeTuning.cameraSpeed)),
        glowIntensity: Math.min(1.8, Math.max(0, fumeTuning.glowIntensity)),
        heroScale: Math.min(1.32, Math.max(0.82, fumeTuning.heroScale)),
    };
    const visibilityOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: false, label: t('options.partitaGuideLinesOn')  },
        { value: true, label: t('options.partitaGuideLinesOff')  },
    ]), [t]);
    const fumeCameraTrackingOptions: PresetOption<FumeTuning['cameraTrackingMode']>[] = useMemo(() => ([
        { value: 'stepped', label: t('options.fumeCameraTrackingStepped')  },
        { value: 'smooth', label: t('options.fumeCameraTrackingSmooth')  },
    ]), [t]);
    const handleFumeTuningChange = (patch: Partial<FumeTuning>) => {
        onFumeTuningChange?.(patch);
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.fumeSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.fumeSettingsDesc')}
                </div>
            </div>

            <PresetGroup
                label={t('options.fumeHidePrintSymbols') }
                value={resolvedFumeTuning.hidePrintSymbols}
                options={visibilityOptions}
                onChange={(next) => handleFumeTuningChange({ hidePrintSymbols: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <PresetGroup
                label={t('options.fumeGeometricBackground') }
                value={resolvedFumeTuning.disableGeometricBackground}
                options={visibilityOptions}
                onChange={(next) => handleFumeTuningChange({ disableGeometricBackground: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeBackgroundObjectOpacity') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedFumeTuning.backgroundObjectOpacity * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedFumeTuning.backgroundObjectOpacity}
                    onChange={(event) => handleFumeTuningChange({ backgroundObjectOpacity: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeTextHoldRatio') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedFumeTuning.textHoldRatio * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedFumeTuning.textHoldRatio}
                    onChange={(event) => handleFumeTuningChange({ textHoldRatio: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeCameraSpeed') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedFumeTuning.cameraSpeed.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.55"
                    max="1.85"
                    step="0.05"
                    value={resolvedFumeTuning.cameraSpeed}
                    onChange={(event) => handleFumeTuningChange({ cameraSpeed: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <PresetGroup
                label={t('options.fumeCameraTrackingMode') }
                value={resolvedFumeTuning.cameraTrackingMode}
                options={fumeCameraTrackingOptions}
                onChange={(next) => handleFumeTuningChange({ cameraTrackingMode: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeGlowIntensity') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedFumeTuning.glowIntensity.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1.8"
                    step="0.05"
                    value={resolvedFumeTuning.glowIntensity}
                    onChange={(event) => handleFumeTuningChange({ glowIntensity: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeHeroScale') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedFumeTuning.heroScale.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.82"
                    max="1.32"
                    step="0.02"
                    value={resolvedFumeTuning.heroScale}
                    onChange={(event) => handleFumeTuningChange({ heroScale: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

const resolveCappellaTuning = (
    tuning: CappellaTuning | undefined,
    hasCustomEmojiPack: boolean,
): CappellaTuning => ({
    showEmoMessages: tuning?.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: tuning?.emojiPackSource === 'custom' && hasCustomEmojiPack
        ? 'custom'
        : 'builtin',
    avatarSource: tuning?.avatarSource === 'builtin' || tuning?.avatarSource === 'color' || tuning?.avatarSource === 'cover' || tuning?.avatarSource === 'custom'
        ? tuning.avatarSource
        : DEFAULT_CAPPELLA_TUNING.avatarSource,
});

export const CappellaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    cappellaTuning,
    cappellaCustomEmojiImages = [],
    onCappellaTuningChange,
    cappellaCustomEmojiCount = 0,
    hasCappellaCustomEmojiPack = false,
    isCappellaCustomEmojiPackLoading = false,
    onImportCappellaCustomEmojiPack,
    onClearCappellaCustomEmojiPack,
    cappellaCustomAvatarImages = [],
    onImportCappellaCustomAvatar,
    onClearCappellaCustomAvatar,
    hasCappellaCustomAvatar = false,
    isCappellaCustomAvatarLoading = false,
}) => {
    const emojiFileInputRef = useRef<HTMLInputElement | null>(null);
    const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isImportingAvatar, setIsImportingAvatar] = useState(false);
    const resolvedTuning = resolveCappellaTuning(cappellaTuning, hasCappellaCustomEmojiPack);
    const emojiSourceOptions: PresetOption<CappellaTuning['emojiPackSource']>[] = useMemo(() => ([
        { value: 'builtin', label: t('options.cappellaEmojiSourceBuiltin')  },
        { value: 'custom', label: t('options.cappellaEmojiSourceCustom')  },
    ]), [t]);
    const avatarSourceOptions: PresetOption<CappellaTuning['avatarSource']>[] = useMemo(() => ([
        { value: 'cover', label: t('options.cappellaAvatarSourceCover')  },
        { value: 'builtin', label: t('options.cappellaAvatarSourceBuiltin')  },
        { value: 'color', label: t('options.cappellaAvatarSourceColor')  },
        { value: 'custom', label: t('options.cappellaAvatarSourceCustom')  },
    ]), [t]);

    const handleImportClick = () => {
        setFeedback(null);
        emojiFileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomEmojiPack) {
            return;
        }

        setIsImporting(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomEmojiPack(files);
            if (result.ok) {
                setFeedback(t('options.cappellaEmojiImportSuccess'));
            } else {
                setFeedback(result.error || t('options.cappellaEmojiImportFailed'));
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleClearCustomPack = async () => {
        if (!onClearCappellaCustomEmojiPack) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomEmojiPack();
        setFeedback(t('options.cappellaEmojiCleared'));
    };

    const handleAvatarImportClick = () => {
        setFeedback(null);
        avatarFileInputRef.current?.click();
    };

    const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomAvatar) {
            return;
        }

        setIsImportingAvatar(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomAvatar(files);
            if (result.ok) {
                setFeedback(t('options.cappellaAvatarImportSuccess'));
            } else {
                setFeedback(result.error || t('options.cappellaAvatarImportFailed'));
            }
        } finally {
            setIsImportingAvatar(false);
        }
    };

    const handleClearCustomAvatar = async () => {
        if (!onClearCappellaCustomAvatar) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomAvatar();
        setFeedback(t('options.cappellaAvatarCleared'));
    };

    const avatarPreviewSlots = cappellaCustomAvatarImages.length > 0
        ? cappellaCustomAvatarImages
        : Array.from({ length: 5 }, (_, index) => cappellaCustomAvatarImages[index] ?? null);
    const previewSlots = cappellaCustomEmojiImages.length > 0
        ? cappellaCustomEmojiImages
        : Array.from({ length: 5 }, (_, index) => cappellaCustomEmojiImages[index] ?? null);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.cappellaSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaSettingsDesc')}
                </div>
            </div>

            <PresetGroup
                label={t('options.cappellaShowEmoMessages') }
                value={resolvedTuning.showEmoMessages}
                options={[
                    { value: true, label: t('options.partitaGuideLinesOn')  },
                    { value: false, label: t('options.partitaGuideLinesOff')  },
                ]}
                onChange={(next) => onCappellaTuningChange?.({ showEmoMessages: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
                    {t('options.cappellaAvatarSource') }
                </div>
                <div className="flex flex-wrap gap-2">
                    {avatarSourceOptions.map(option => {
                        const isActive = option.value === resolvedTuning.avatarSource;
                        const isDisabled = option.value === 'custom' && !hasCappellaCustomAvatar;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => onCappellaTuningChange?.({ avatarSource: option.value })}
                                className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-45"
                                style={{
                                    color: theme.primaryColor,
                                    borderColor: isActive ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                    backgroundColor: isActive
                                        ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                        : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                                    boxShadow: isActive ? `inset 0 0 0 1px ${theme.accentColor}` : 'none',
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaAvatarPreview') }
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {avatarPreviewSlots.map((image, index) => (
                        <div
                            key={image?.id ?? `empty-${index}`}
                            className="aspect-square rounded-full border overflow-hidden flex items-center justify-center text-[11px] text-center"
                            style={{
                                borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                                backgroundColor: isDaylight ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.04)',
                                color: 'var(--text-secondary)',
                            }}
                            title={image?.name ?? (t('options.cappellaEmojiEmptySlot') )}
                        >
                            {image ? (
                                <img
                                    src={image.url}
                                    alt={image.name}
                                    className="h-full w-full rounded-full object-cover"
                                />
                            ) : (
                                <span className="opacity-45">{index + 1}</span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {hasCappellaCustomAvatar
                        ? `${t('options.cappellaEmojiCount') } ${cappellaCustomAvatarImages.length}`
                        : t('options.cappellaAvatarUploadHint')}
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleAvatarImportClick}
                        disabled={isImportingAvatar || isCappellaCustomAvatarLoading}
                        className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                            color: 'var(--text-primary)',
                            borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                        }}
                    >
                        {isImportingAvatar
                            ? t('options.cappellaAvatarUploading')
                            : (t('options.cappellaAvatarUpload') )}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleClearCustomAvatar()}
                        disabled={!hasCappellaCustomAvatar || isImportingAvatar || isCappellaCustomAvatarLoading}
                        className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                            color: 'var(--text-primary)',
                            borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                        }}
                    >
                        {t('options.cappellaAvatarClear') }
                    </button>
                </div>

                <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleAvatarFileChange(event)}
                />
            </div>

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaEmojiSource') }
                </div>
                <div className="flex flex-wrap gap-2">
                    {emojiSourceOptions.map(option => {
                        const isActive = option.value === resolvedTuning.emojiPackSource;
                        const isDisabled = option.value === 'custom' && !hasCappellaCustomEmojiPack;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => onCappellaTuningChange?.({ emojiPackSource: option.value })}
                                className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-45"
                                style={{
                                    color: 'var(--text-primary)',
                                    borderColor: isActive ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                    backgroundColor: isActive
                                        ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                        : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                                    boxShadow: isActive ? `inset 0 0 0 1px ${theme.accentColor}` : 'none',
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaEmojiPreview') }
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {previewSlots.map((image, index) => (
                        <div
                            key={image?.id ?? `empty-${index}`}
                            className="aspect-square rounded-2xl border overflow-hidden flex items-center justify-center text-[11px] text-center px-1"
                            style={{
                                borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                                backgroundColor: isDaylight ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.04)',
                                color: 'var(--text-secondary)',
                            }}
                            title={image?.name ?? (t('options.cappellaEmojiEmptySlot') )}
                        >
                            {image ? (
                                <img
                                    src={image.url}
                                    alt={image.name}
                                    className="h-full w-full object-contain"
                                />
                            ) : (
                                <span className="opacity-45">{index + 1}</span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {hasCappellaCustomEmojiPack
                        ? `${t('options.cappellaEmojiCount') } ${cappellaCustomEmojiCount}`
                        : t('options.cappellaEmojiUploadHint')}
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleImportClick}
                    disabled={isImporting || isCappellaCustomEmojiPackLoading}
                    className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        color: 'var(--text-primary)',
                        borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                    }}
                >
                    {isImporting
                        ? t('options.cappellaEmojiUploading')
                        : (t('options.cappellaEmojiUpload') )}
                </button>
                <button
                    type="button"
                    onClick={() => void handleClearCustomPack()}
                    disabled={!hasCappellaCustomEmojiPack || isImporting || isCappellaCustomEmojiPackLoading}
                    className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        color: 'var(--text-primary)',
                        borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                    }}
                >
                    {t('options.cappellaEmojiClear') }
                </button>
            </div>

            <input
                ref={emojiFileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                multiple
                className="hidden"
                onChange={(event) => void handleFileChange(event)}
            />

            {feedback && (
                <div className="text-xs leading-5 opacity-70" style={{ color: 'var(--text-secondary)' }}>
                    {feedback}
                </div>
            )}
        </div>
    );
};

export const TiltSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    tiltTuning = DEFAULT_TILT_TUNING,
    onTiltTuningChange,
}) => {
    const resolvedTuning: Required<TiltTuning> = {
        splitProbability: Math.min(1, Math.max(0, tiltTuning.splitProbability ?? DEFAULT_TILT_TUNING.splitProbability)),
        tiltStyleProbability: Math.min(1, Math.max(0, tiltTuning.tiltStyleProbability ?? DEFAULT_TILT_TUNING.tiltStyleProbability)),
        colorScheme: tiltTuning?.colorScheme ?? DEFAULT_TILT_TUNING.colorScheme ?? 'default',
    };

    const colorSchemeOptions: PresetOption<TiltColorScheme>[] = useMemo(() => ([
        { label: t('options.tiltColorSchemeDefault') , value: 'default' },
        { label: t('options.tiltColorSchemeSwap') , value: 'swap' },
        { label: t('options.tiltColorSchemeAccentAll') , value: 'accentAll' },
        { label: t('options.tiltColorSchemePrimaryAll') , value: 'primaryAll' },
    ]), [t]);

    const handleTiltTuningChange = (patch: Partial<TiltTuning>) => {
        onTiltTuningChange?.(patch);
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.tiltSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.tiltSettingsDesc')}
                </div>
            </div>

            <PresetGroup<TiltColorScheme>
                label={t('options.tiltColorScheme') }
                value={resolvedTuning.colorScheme}
                options={colorSchemeOptions}
                onChange={(next) => handleTiltTuningChange({ colorScheme: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.tiltSplitProbability') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.splitProbability * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedTuning.splitProbability}
                    onChange={(event) => handleTiltTuningChange({ splitProbability: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.tiltStyleProbability') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.tiltStyleProbability * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedTuning.tiltStyleProbability}
                    onChange={(event) => handleTiltTuningChange({ tiltStyleProbability: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

const clampDioramaCameraSpeed = (value: number) => Math.min(1.85, Math.max(0.55, value));
const clampDioramaMotionAmount = (value: number) => Math.min(1.6, Math.max(0.4, value));
const clampDioramaAudioReactivity = (value: number) => Math.min(1.5, Math.max(0, value));

export const DioramaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    dioramaTuning = DEFAULT_DIORAMA_TUNING,
    onDioramaTuningChange,
}) => {
    const resolvedTuning: DioramaTuning = {
        cameraSpeed: clampDioramaCameraSpeed(dioramaTuning.cameraSpeed ?? DEFAULT_DIORAMA_TUNING.cameraSpeed),
        motionAmount: clampDioramaMotionAmount(dioramaTuning.motionAmount ?? DEFAULT_DIORAMA_TUNING.motionAmount),
        audioReactivity: clampDioramaAudioReactivity(dioramaTuning.audioReactivity ?? DEFAULT_DIORAMA_TUNING.audioReactivity),
        geometryVisibility: {
            ...DEFAULT_DIORAMA_TUNING.geometryVisibility,
            ...dioramaTuning.geometryVisibility,
        },
        particleDensity: Math.round(Math.min(
            DIORAMA_PARTICLE_DENSITY_MAX,
            Math.max(DIORAMA_PARTICLE_DENSITY_MIN, dioramaTuning.particleDensity ?? DEFAULT_DIORAMA_TUNING.particleDensity),
        )),
        particleScale: Math.min(
            DIORAMA_PARTICLE_SIZE_MAX,
            Math.max(DIORAMA_PARTICLE_SIZE_MIN, dioramaTuning.particleScale ?? DEFAULT_DIORAMA_TUNING.particleScale),
        ),
        particleGlowEnabled: dioramaTuning.particleGlowEnabled ?? DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
        particleGlowIntensity: Math.min(
            DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
            Math.max(
                DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
                dioramaTuning.particleGlowIntensity ?? DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
            ),
        ),
        showParticles: dioramaTuning.showParticles ?? DEFAULT_DIORAMA_TUNING.showParticles,
        backgroundParticleCircumference: resolveDioramaMoteCircumference(
            dioramaTuning.backgroundParticleCircumference ?? DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
        ),
        backgroundParticleRadial: resolveDioramaMoteRadial(
            dioramaTuning.backgroundParticleRadial ?? DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
        ),
        glowEnabled: dioramaTuning.glowEnabled ?? DEFAULT_DIORAMA_TUNING.glowEnabled,
        glowIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.glowIntensity ?? DEFAULT_DIORAMA_TUNING.glowIntensity)),
        soulEnabled: dioramaTuning.soulEnabled ?? DEFAULT_DIORAMA_TUNING.soulEnabled,
        soulIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.soulIntensity ?? DEFAULT_DIORAMA_TUNING.soulIntensity)),
        soulActiveEnabled: dioramaTuning.soulActiveEnabled ?? DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
        gradientEnabled: dioramaTuning.gradientEnabled ?? DEFAULT_DIORAMA_TUNING.gradientEnabled,
        gradientIntensity: Math.min(1.5, Math.max(0.1, dioramaTuning.gradientIntensity ?? DEFAULT_DIORAMA_TUNING.gradientIntensity)),
        keywordColoringEnabled: dioramaTuning.keywordColoringEnabled ?? DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
    };

    const handleDioramaTuningChange = (patch: Partial<DioramaTuning>) => {
        onDioramaTuningChange?.(patch);
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.dioramaSettings') || '镜台参数'}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaCameraSpeed') || '镜头速度'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.cameraSpeed.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.55"
                    max="1.85"
                    step="0.05"
                    value={resolvedTuning.cameraSpeed}
                    onChange={(event) => handleDioramaTuningChange({ cameraSpeed: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaMotionAmount') || '运动幅度'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.motionAmount.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.4"
                    max="1.6"
                    step="0.05"
                    value={resolvedTuning.motionAmount}
                    onChange={(event) => handleDioramaTuningChange({ motionAmount: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.dioramaAudioReactivity') || '点云音频响应'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.audioReactivity * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.audioReactivity}
                    onChange={(event) => handleDioramaTuningChange({ audioReactivity: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            {/* Three independent, stackable follow-sing effects - each an on/off toggle plus strength
                tiers (slider only under 自定义). Their rendering paths are fully separate in
                DioramaScene, so enabling one never stands in for another. */}
            <DioramaEffectSettings
                label={t('options.dioramaGlowEffect') || '普通辉光跟唱'}
                enabled={resolvedTuning.glowEnabled}
                intensity={resolvedTuning.glowIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ glowEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ glowIntensity: next })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
            {/* 灵魂出窍跟唱, with 当前字漂移 as its nested child (same underlying effect, scoped to the word
                being sung) rendered inside its expanded panel - not a standalone effect in the list. */}
            <DioramaEffectSettings
                label={t('options.dioramaSoulEffect') || '灵魂出窍跟唱'}
                enabled={resolvedTuning.soulEnabled}
                intensity={resolvedTuning.soulIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ soulEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ soulIntensity: next })}
                subEffect={{
                    label: t('options.dioramaSoulActiveEffect') || '当前字出窍',
                    enabled: resolvedTuning.soulActiveEnabled,
                    onEnabledChange: (next) => handleDioramaTuningChange({ soulActiveEnabled: next }),
                }}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
            <DioramaEffectSettings
                label={t('options.dioramaGradientEffect') || '渐变跟唱'}
                enabled={resolvedTuning.gradientEnabled}
                intensity={resolvedTuning.gradientIntensity}
                onEnabledChange={(next) => handleDioramaTuningChange({ gradientEnabled: next })}
                onIntensityChange={(next) => handleDioramaTuningChange({ gradientIntensity: next })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />

            {/* 关键字着色: a plain on/off - the colours themselves are the theme's 关键词 list, not a
                strength. Independent of the follow-sing effects above: it sets the colour a unit RESTS
                at, and they dye away from it and settle back onto it. */}
            <div
                className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3"
                style={{
                    borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.17 : 0.14),
                    backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                }}
            >
                <span className="min-w-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.dioramaKeywordColoring') || '关键字着色'}
                </span>
                <DioramaSettingsToggle
                    checked={resolvedTuning.keywordColoringEnabled}
                    label={t('options.dioramaKeywordColoring') || '关键字着色'}
                    onChange={(next) => handleDioramaTuningChange({ keywordColoringEnabled: next })}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            </div>

            <DioramaGeometrySettings
                t={t}
                theme={theme}
                isDaylight={isDaylight}
                value={resolvedTuning.geometryVisibility}
                onChange={(geometryVisibility) => handleDioramaTuningChange({ geometryVisibility })}
                density={resolvedTuning.particleDensity}
                onDensityChange={(particleDensity) => handleDioramaTuningChange({ particleDensity })}
                particleScale={resolvedTuning.particleScale}
                onParticleScaleChange={(particleScale) => handleDioramaTuningChange({ particleScale })}
                glowEnabled={resolvedTuning.particleGlowEnabled}
                onGlowEnabledChange={(particleGlowEnabled) => handleDioramaTuningChange({ particleGlowEnabled })}
                glowIntensity={resolvedTuning.particleGlowIntensity}
                onGlowIntensityChange={(particleGlowIntensity) => handleDioramaTuningChange({ particleGlowIntensity })}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />

            <DioramaBackgroundParticleSettings
                label={t('options.dioramaShowParticles') || '背景粒子'}
                enabled={resolvedTuning.showParticles}
                circumference={resolvedTuning.backgroundParticleCircumference}
                radial={resolvedTuning.backgroundParticleRadial}
                onEnabledChange={(next) => handleDioramaTuningChange({ showParticles: next })}
                onCircumferenceChange={(backgroundParticleCircumference) => handleDioramaTuningChange({ backgroundParticleCircumference })}
                onRadialChange={(backgroundParticleRadial) => handleDioramaTuningChange({ backgroundParticleRadial })}
                t={t}
                isDaylight={isDaylight}
                theme={theme}
                rangeInputClass={rangeInputClass}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
        </div>
    );
};

const clampCladdaghLetterSpacingOffset = (val: number) => Math.min(20, Math.max(-5, val));

export const CladdaghSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    claddaghTuning = DEFAULT_CLADDAGH_TUNING,
    onCladdaghTuningChange,
}) => {
    const resolvedTuning: CladdaghTuning = {
        focusScaleRatio: clampCladdaghFocusScaleRatio(claddaghTuning.focusScaleRatio ?? DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
        radiusScale: clampCladdaghRadiusScale(claddaghTuning.radiusScale ?? DEFAULT_CLADDAGH_TUNING.radiusScale),
        ellipseTiltDeg: clampCladdaghEllipseTiltDeg(claddaghTuning.ellipseTiltDeg ?? DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
        showAxisLine: claddaghTuning.showAxisLine ?? DEFAULT_CLADDAGH_TUNING.showAxisLine,
        letterSpacingOffset: clampCladdaghLetterSpacingOffset(claddaghTuning.letterSpacingOffset ?? DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
    };

    const axisLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.claddaghSettings') }
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.claddaghSettingsDesc')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghFocusScaleRatio') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {(resolvedTuning.focusScaleRatio + 1.0).toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.0"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.focusScaleRatio}
                    onChange={(event) => onCladdaghTuningChange?.({ focusScaleRatio: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghRadiusScale') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.radiusScale.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.radiusScale}
                    onChange={(event) => onCladdaghTuningChange?.({ radiusScale: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghEllipseTiltDeg') }</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.ellipseTiltDeg}°
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="60"
                    step="1"
                    value={resolvedTuning.ellipseTiltDeg}
                    onChange={(event) => onCladdaghTuningChange?.({ ellipseTiltDeg: parseInt(event.target.value, 10) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <PresetGroup
                label={t('options.claddaghShowAxisLine') || '中间轴线'}
                value={resolvedTuning.showAxisLine}
                options={axisLineOptions}
                onChange={(next) => onCladdaghTuningChange?.({ showAxisLine: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.claddaghLetterSpacingOffset') || '字符间距'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.letterSpacingOffset > 0 ? '+' : ''}{resolvedTuning.letterSpacingOffset.toFixed(1)}px
                    </span>
                </div>
                <input
                    type="range"
                    min="-5"
                    max="20"
                    step="0.5"
                    value={resolvedTuning.letterSpacingOffset}
                    onChange={(event) => onCladdaghTuningChange?.({ letterSpacingOffset: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};
