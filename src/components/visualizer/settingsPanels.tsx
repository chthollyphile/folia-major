import React, { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';
import { DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type PartitaTuning, type TiltColorScheme, type TiltTuning } from '../../types';
import { Button, Group, PictureGrid, Reveal, Row, Segmented, Status, Toggle, Tooltip, type SettingsGroupDef } from '../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from './definition';
import { DioramaGeometrySettings } from './diorama/DioramaGeometrySettings';
import { DioramaBackgroundParticleSettings } from './diorama/DioramaBackgroundParticleSettings';
import { DioramaEffectSettings } from './diorama/DioramaEffectSettings';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from './diorama/dioramaMoteField';
import { percent, SliderRow, times } from './panelRows';
import LyricRenderQualityRows from './renderQuality/LyricRenderQualityRows';
import { DEFAULT_LYRIC_RENDER_OVERRIDE } from '../../utils/lyricRenderQuality';

// src/components/visualizer/settingsPanels.tsx
// Mode-owned preview settings panels used by discoverable visualizer entries. Each returns groups
// of the settings kit and nothing around them; the window stacks what a panel returns.
const CLASSIC_GROUP: SettingsGroupDef = { id: 'vis-classic', titleKey: 'options.classicSettings' };
const PARTITA_GROUP: SettingsGroupDef = { id: 'vis-partita', titleKey: 'options.partitaSettings' };
const FUME_GROUP: SettingsGroupDef = { id: 'vis-fume', titleKey: 'options.fumeSettings' };
// 浮名是 canvas 2D 舞台：「渲染」组只有分辨率一行（#929）。
const FUME_RENDER_GROUP: SettingsGroupDef = { id: 'vis-fume-render', titleKey: 'options.lyricRenderSection' };
const CAPPELLA_GROUP: SettingsGroupDef = { id: 'vis-cappella', titleKey: 'options.cappellaSettings' };
const TILT_GROUP: SettingsGroupDef = { id: 'vis-tilt', titleKey: 'options.tiltSettings' };
const DIORAMA_GROUP: SettingsGroupDef = { id: 'vis-diorama', titleKey: 'options.dioramaSettings' };
// 镜台是 react-three-fiber：「渲染」组有分辨率与抗锯齿两行（#929）。
const DIORAMA_RENDER_GROUP: SettingsGroupDef = { id: 'vis-diorama-render', titleKey: 'options.lyricRenderSection' };
const CLADDAGH_GROUP: SettingsGroupDef = { id: 'vis-claddagh', titleKey: 'options.claddaghSettings' };

const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));
const clampClassicBreathingFloatMultiplier = (value: number) => Math.min(2, Math.max(0, value));
const clampClassicWordSpacing = (value: number) => Math.min(2, Math.max(0, value));
const clampCladdaghFocusScaleRatio = (val: number) => Math.min(1.5, Math.max(0.0, val));
const clampCladdaghRadiusScale = (val: number) => Math.min(1.5, Math.max(0.5, val));
const clampCladdaghEllipseTiltDeg = (val: number) => Math.min(60, Math.max(0, val));

export const ClassicSettingsPanel: React.FC<VisualizerSettingsPanelProps<ClassicTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: classicTuning = DEFAULT_CLASSIC_TUNING,
    onTuningChange: onClassicTuningChange,
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
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <Group def={CLASSIC_GROUP}>
            <Row label={t('options.classicWordRotation')}>
                <Toggle
                    checked={resolvedClassicTuning.enableWordRotation}
                    onChange={(enabled) => onClassicTuningChange?.({ enableWordRotation: enabled })}
                />
            </Row>
            <Row label={t('options.classicLegacyLayout')}>
                <Segmented
                    value={resolvedClassicTuning.useLegacyLayout ? 'legacy' : 'adaptive'}
                    options={[
                        { value: 'adaptive', label: t('options.classicLegacyLayoutOff') },
                        { value: 'legacy', label: t('options.classicLegacyLayoutOn') },
                    ]}
                    onChange={(next) => onClassicTuningChange?.({ useLegacyLayout: next === 'legacy' })}
                />
            </Row>
            <SliderRow
                {...drag}
                label={t('options.classicBreathingFloatMultiplier')}
                value={resolvedClassicTuning.breathingFloatMultiplier}
                min={0}
                max={2}
                step={0.05}
                format={times}
                onChange={(value) => onClassicTuningChange?.({ breathingFloatMultiplier: value })}
            />
            <Reveal when={!resolvedClassicTuning.useLegacyLayout}>
                <SliderRow
                    {...drag}
                    label={t('options.classicWordSpacing')}
                    value={resolvedClassicTuning.wordSpacing}
                    min={0}
                    max={2}
                    step={0.05}
                    format={times}
                    onChange={(value) => onClassicTuningChange?.({ wordSpacing: value })}
                />
            </Reveal>
        </Group>
    );
};
export const PartitaSettingsPanel: React.FC<VisualizerSettingsPanelProps<PartitaTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: partitaTuning = DEFAULT_PARTITA_TUNING,
    onTuningChange: onPartitaTuningChange,
}) => {
    const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);
    const resolvedPartitaTuning: PartitaTuning = {
        showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: partitaTuning.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
    // A slider moved past the other end takes that end along: both ends are sent. Sent alone, the
    // moved end would be put in order by the tuning's merge (partita/tuning.ts), which swaps the
    // two: the thumb that is held would stop there and the other slider's would move in its place.
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
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };
    const pixels = (value: number) => `${value}px`;

    return (
        <Group def={PARTITA_GROUP}>
            <Row label={t('options.partitaGuideLines')}>
                <Toggle
                    checked={resolvedPartitaTuning.showGuideLines}
                    onChange={(enabled) => onPartitaTuningChange?.({ showGuideLines: enabled })}
                />
            </Row>
            <Row label={t('options.partitaSemanticLayout')}>
                <Toggle
                    checked={resolvedPartitaTuning.useSemanticLayout}
                    onChange={(enabled) => onPartitaTuningChange?.({ useSemanticLayout: enabled })}
                />
            </Row>
            <SliderRow
                {...drag}
                label={t('options.partitaStaggerMin')}
                value={resolvedPartitaTuning.staggerMin}
                min={0}
                max={180}
                step={5}
                format={pixels}
                onChange={handlePartitaMinChange}
            />
            <SliderRow
                {...drag}
                label={t('options.partitaStaggerMax')}
                value={resolvedPartitaTuning.staggerMax}
                min={0}
                max={180}
                step={5}
                format={pixels}
                onChange={handlePartitaMaxChange}
            />
        </Group>
    );
};
const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined): FumeTuning['cameraTrackingMode'] => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export const FumeSettingsPanel: React.FC<VisualizerSettingsPanelProps<FumeTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: fumeTuning = DEFAULT_FUME_TUNING,
    onTuningChange: onFumeTuningChange,
}) => {
    const resolvedFumeTuning: FumeTuning = {
        render: fumeTuning.render ?? DEFAULT_LYRIC_RENDER_OVERRIDE,
        hidePrintSymbols: fumeTuning.hidePrintSymbols,
        disableGeometricBackground: fumeTuning.disableGeometricBackground,
        backgroundObjectOpacity: Math.min(1, Math.max(0, fumeTuning.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity)),
        textHoldRatio: Math.min(1, Math.max(0, fumeTuning.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio)),
        cameraTrackingMode: resolveFumeCameraTrackingMode(fumeTuning.cameraTrackingMode),
        cameraSpeed: Math.min(1.85, Math.max(0.55, fumeTuning.cameraSpeed)),
        glowIntensity: Math.min(1.8, Math.max(0, fumeTuning.glowIntensity)),
        heroScale: Math.min(1.32, Math.max(0.82, fumeTuning.heroScale)),
    };
    const handleFumeTuningChange = (patch: Partial<FumeTuning>) => {
        onFumeTuningChange?.(patch);
    };
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <Group def={FUME_GROUP}>
                <Row label={t('options.fumeHidePrintSymbols')}>
                    <Toggle
                        checked={resolvedFumeTuning.hidePrintSymbols}
                        onChange={(next) => handleFumeTuningChange({ hidePrintSymbols: next })}
                    />
                </Row>
                {/* The switch shows the shapes; the stored value says whether they are off. */}
                <Row label={t('options.fumeGeometricBackground')}>
                    <Toggle
                        checked={!resolvedFumeTuning.disableGeometricBackground}
                        onChange={(shown) => handleFumeTuningChange({ disableGeometricBackground: !shown })}
                    />
                </Row>
                <SliderRow
                    {...drag}
                    label={t('options.fumeBackgroundObjectOpacity')}
                    value={resolvedFumeTuning.backgroundObjectOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    format={percent}
                    onChange={(value) => handleFumeTuningChange({ backgroundObjectOpacity: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.fumeTextHoldRatio')}
                    value={resolvedFumeTuning.textHoldRatio}
                    min={0}
                    max={1}
                    step={0.05}
                    format={percent}
                    onChange={(value) => handleFumeTuningChange({ textHoldRatio: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.fumeCameraSpeed')}
                    value={resolvedFumeTuning.cameraSpeed}
                    min={0.55}
                    max={1.85}
                    step={0.05}
                    format={times}
                    onChange={(value) => handleFumeTuningChange({ cameraSpeed: value })}
                />
                <Row label={t('options.fumeCameraTrackingMode')}>
                    <Segmented
                        value={resolvedFumeTuning.cameraTrackingMode}
                        options={[
                            { value: 'stepped', label: t('options.fumeCameraTrackingStepped') },
                            { value: 'smooth', label: t('options.fumeCameraTrackingSmooth') },
                        ]}
                        onChange={(next) => handleFumeTuningChange({ cameraTrackingMode: next })}
                    />
                </Row>
                <SliderRow
                    {...drag}
                    label={t('options.fumeGlowIntensity')}
                    value={resolvedFumeTuning.glowIntensity}
                    min={0}
                    max={1.8}
                    step={0.05}
                    format={times}
                    onChange={(value) => handleFumeTuningChange({ glowIntensity: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.fumeHeroScale')}
                    value={resolvedFumeTuning.heroScale}
                    min={0.82}
                    max={1.32}
                    step={0.02}
                    format={times}
                    onChange={(value) => handleFumeTuningChange({ heroScale: value })}
                />
            </Group>
            <Group def={FUME_RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={resolvedFumeTuning.render}
                    onChange={(patch) => handleFumeTuningChange({ render: { ...resolvedFumeTuning.render, ...patch } })}
                    antialias={false}
                />
            </Group>
        </>
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

/** The uploaded pictures of a pack, five to a line; an empty pack shows five numbered places. */
const CappellaImageSlots: React.FC<{
    images: ReadonlyArray<{ id: string; name: string; url: string }>;
    emptyName: string;
    round?: boolean;
}> = ({ images, emptyName, round }) => {
    const slots = images.length > 0 ? images : Array.from({ length: 5 }, () => null);

    return (
        <div className="grid grid-cols-5 gap-2">
            {slots.map((image, index) => (
                <Tooltip
                    key={image?.id ?? `empty-${index}`}
                    text={image?.name ?? emptyName}
                    className={`grid aspect-square place-items-center overflow-hidden bg-[var(--st-fill)] text-[11px] text-[color:var(--st-t3)] ${round ? 'rounded-full' : 'rounded-lg'}`}
                >
                    {image ? (
                        <img src={image.url} alt={image.name} className={`h-full w-full ${round ? 'object-cover' : 'object-contain'}`} />
                    ) : index + 1}
                </Tooltip>
            ))}
        </div>
    );
};

export const CappellaSettingsPanel: React.FC<VisualizerSettingsPanelProps<CappellaTuning>> = ({
    t,
    tuning: cappellaTuning,
    onTuningChange: onCappellaTuningChange,
    settings: {
        handleImportCustomCappellaEmojiPack: onImportCappellaCustomEmojiPack,
        handleClearCustomCappellaEmojiPack: onClearCappellaCustomEmojiPack,
        handleImportCustomCappellaAvatar: onImportCappellaCustomAvatar,
        handleClearCustomCappellaAvatar: onClearCappellaCustomAvatar,
    },
}) => {
    // The listener's own pictures and whether they are still being read back: the style's own, so the panel takes them itself.
    const {
        cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack: isCappellaCustomEmojiPackLoading,
        cappellaCustomAvatarImages,
        isLoadingCappellaCustomAvatarPack: isCappellaCustomAvatarLoading,
    } = useVisualizerAssetStore(useShallow(state => ({
        cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack: state.isLoadingCappellaCustomEmojiPack,
        cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
        isLoadingCappellaCustomAvatarPack: state.isLoadingCappellaCustomAvatarPack,
    })));
    const cappellaCustomEmojiCount = cappellaCustomEmojiImages.length;
    const hasCappellaCustomEmojiPack = cappellaCustomEmojiCount > 0;
    const hasCappellaCustomAvatar = cappellaCustomAvatarImages.length > 0;
    const emojiFileInputRef = useRef<HTMLInputElement | null>(null);
    const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isImportingAvatar, setIsImportingAvatar] = useState(false);
    const resolvedTuning = resolveCappellaTuning(cappellaTuning, hasCappellaCustomEmojiPack);

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

    return (
        <Group def={CAPPELLA_GROUP}>
            <Row
                label={t('options.cappellaAvatarSource')}
                below={(
                    <Segmented
                        fill
                        value={resolvedTuning.avatarSource}
                        options={[
                            { value: 'cover', label: t('options.cappellaAvatarSourceCover') },
                            { value: 'builtin', label: t('options.cappellaAvatarSourceBuiltin') },
                            { value: 'color', label: t('options.cappellaAvatarSourceColor') },
                            { value: 'custom', label: t('options.cappellaAvatarSourceCustom'), disabled: !hasCappellaCustomAvatar },
                        ]}
                        onChange={(next) => onCappellaTuningChange?.({ avatarSource: next })}
                    />
                )}
            />
            <Row
                label={t('options.cappellaAvatarPreview')}
                hint={hasCappellaCustomAvatar
                    ? `${t('options.cappellaEmojiCount')} ${cappellaCustomAvatarImages.length}`
                    : t('options.cappellaAvatarUploadHint')}
                below={<CappellaImageSlots round images={cappellaCustomAvatarImages} emptyName={t('options.cappellaEmojiEmptySlot')} />}
            >
                <Button onClick={handleAvatarImportClick} disabled={isImportingAvatar || isCappellaCustomAvatarLoading}>
                    {isImportingAvatar ? t('options.cappellaAvatarUploading') : t('options.cappellaAvatarUpload')}
                </Button>
                <Button
                    onClick={() => void handleClearCustomAvatar()}
                    disabled={!hasCappellaCustomAvatar || isImportingAvatar || isCappellaCustomAvatarLoading}
                >
                    {t('options.cappellaAvatarClear')}
                </Button>
                <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleAvatarFileChange(event)}
                />
            </Row>
            <Row label={t('options.cappellaShowEmoMessages')}>
                <Toggle
                    checked={resolvedTuning.showEmoMessages}
                    onChange={(next) => onCappellaTuningChange?.({ showEmoMessages: next })}
                />
            </Row>
            <Reveal when={resolvedTuning.showEmoMessages}>
                <Row sub label={t('options.cappellaEmojiSource')}>
                    <Segmented
                        value={resolvedTuning.emojiPackSource}
                        options={[
                            { value: 'builtin', label: t('options.cappellaEmojiSourceBuiltin') },
                            { value: 'custom', label: t('options.cappellaEmojiSourceCustom'), disabled: !hasCappellaCustomEmojiPack },
                        ]}
                        onChange={(next) => onCappellaTuningChange?.({ emojiPackSource: next })}
                    />
                </Row>
                <Row
                    sub
                    label={t('options.cappellaEmojiPreview')}
                    hint={hasCappellaCustomEmojiPack
                        ? `${t('options.cappellaEmojiCount')} ${cappellaCustomEmojiCount}`
                        : t('options.cappellaEmojiUploadHint')}
                    below={<CappellaImageSlots images={cappellaCustomEmojiImages} emptyName={t('options.cappellaEmojiEmptySlot')} />}
                >
                    <Button onClick={handleImportClick} disabled={isImporting || isCappellaCustomEmojiPackLoading}>
                        {isImporting ? t('options.cappellaEmojiUploading') : t('options.cappellaEmojiUpload')}
                    </Button>
                    <Button
                        onClick={() => void handleClearCustomPack()}
                        disabled={!hasCappellaCustomEmojiPack || isImporting || isCappellaCustomEmojiPackLoading}
                    >
                        {t('options.cappellaEmojiClear')}
                    </Button>
                    <input
                        ref={emojiFileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                    />
                </Row>
            </Reveal>
            {feedback && <Row label={<Status>{feedback}</Status>} />}
        </Group>
    );
};

const TILT_COLOR_SCHEMES: TiltColorScheme[] = ['default', 'swap', 'accentAll', 'primaryAll'];
const TILT_COLOR_SCHEME_LABEL_KEYS: Record<TiltColorScheme, string> = {
    default: 'options.tiltColorSchemeDefault',
    swap: 'options.tiltColorSchemeSwap',
    accentAll: 'options.tiltColorSchemeAccentAll',
    primaryAll: 'options.tiltColorSchemePrimaryAll',
};

export const TiltSettingsPanel: React.FC<VisualizerSettingsPanelProps<TiltTuning>> = ({
    t,
    theme,
    onSliderPointerDown,
    onSliderCommit,
    tuning: tiltTuning = DEFAULT_TILT_TUNING,
    onTuningChange: onTiltTuningChange,
}) => {
    const resolvedTuning: Required<TiltTuning> = {
        splitProbability: Math.min(1, Math.max(0, tiltTuning.splitProbability ?? DEFAULT_TILT_TUNING.splitProbability)),
        tiltStyleProbability: Math.min(1, Math.max(0, tiltTuning.tiltStyleProbability ?? DEFAULT_TILT_TUNING.tiltStyleProbability)),
        colorScheme: tiltTuning?.colorScheme ?? DEFAULT_TILT_TUNING.colorScheme ?? 'default',
    };

    const handleTiltTuningChange = (patch: Partial<TiltTuning>) => {
        onTiltTuningChange?.(patch);
    };
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    // A scheme as the renderer colours it: an upright word and a slanted one, on the theme's background.
    const { primaryColor, accentColor, backgroundColor } = theme;
    const schemePicture = useCallback((scheme: TiltColorScheme) => {
        const accent = accentColor || primaryColor;
        const upright = scheme === 'swap' || scheme === 'accentAll' ? accent : primaryColor;
        const slanted = scheme === 'default' || scheme === 'accentAll' ? accent : primaryColor;
        return (
            <span className="absolute inset-0 flex items-center justify-center gap-1.5" style={{ backgroundColor }}>
                <span className="h-2 w-[26%] rounded-sm" style={{ backgroundColor: upright }} />
                <span className="h-2 w-[26%] -skew-x-[24deg] rounded-sm" style={{ backgroundColor: slanted }} />
            </span>
        );
    }, [primaryColor, accentColor, backgroundColor]);

    return (
        <Group def={TILT_GROUP}>
            <Row
                label={t('options.tiltColorScheme')}
                below={(
                    <PictureGrid
                        className="-mx-4"
                        columns={4}
                        label={t('options.tiltColorScheme')}
                        value={resolvedTuning.colorScheme}
                        options={TILT_COLOR_SCHEMES.map(value => ({ value, label: t(TILT_COLOR_SCHEME_LABEL_KEYS[value]) }))}
                        picture={schemePicture}
                        onChange={(next) => handleTiltTuningChange({ colorScheme: next })}
                    />
                )}
            />
            <SliderRow
                {...drag}
                label={t('options.tiltSplitProbability')}
                value={resolvedTuning.splitProbability}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={(value) => handleTiltTuningChange({ splitProbability: value })}
            />
            <SliderRow
                {...drag}
                label={t('options.tiltStyleProbability')}
                value={resolvedTuning.tiltStyleProbability}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={(value) => handleTiltTuningChange({ tiltStyleProbability: value })}
            />
        </Group>
    );
};

const clampDioramaCameraSpeed = (value: number) => Math.min(1.85, Math.max(0.55, value));
const clampDioramaMotionAmount = (value: number) => Math.min(1.6, Math.max(0.4, value));
const clampDioramaAudioReactivity = (value: number) => Math.min(1.5, Math.max(0, value));

export const DioramaSettingsPanel: React.FC<VisualizerSettingsPanelProps<DioramaTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: dioramaTuning = DEFAULT_DIORAMA_TUNING,
    onTuningChange: onDioramaTuningChange,
}) => {
    const resolvedTuning: DioramaTuning = {
        render: dioramaTuning.render ?? DEFAULT_LYRIC_RENDER_OVERRIDE,
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
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <Group def={DIORAMA_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.dioramaCameraSpeed')}
                    value={resolvedTuning.cameraSpeed}
                    min={0.55}
                    max={1.85}
                    step={0.05}
                    format={times}
                    onChange={(value) => handleDioramaTuningChange({ cameraSpeed: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.dioramaMotionAmount')}
                    value={resolvedTuning.motionAmount}
                    min={0.4}
                    max={1.6}
                    step={0.05}
                    format={times}
                    onChange={(value) => handleDioramaTuningChange({ motionAmount: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.dioramaAudioReactivity')}
                    value={resolvedTuning.audioReactivity}
                    min={0}
                    max={1.5}
                    step={0.05}
                    format={percent}
                    onChange={(value) => handleDioramaTuningChange({ audioReactivity: value })}
                />

                {/* Three independent, stackable follow-sing effects - each a switch with its strength
                    folded under it. Their rendering paths are fully separate in DioramaScene, so enabling one
                    never stands in for another. */}
                <DioramaEffectSettings
                    label={t('options.dioramaGlowEffect')}
                    enabled={resolvedTuning.glowEnabled}
                    intensity={resolvedTuning.glowIntensity}
                    onEnabledChange={(next) => handleDioramaTuningChange({ glowEnabled: next })}
                    onIntensityChange={(next) => handleDioramaTuningChange({ glowIntensity: next })}
                    t={t}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                {/* 灵魂出窍跟唱, with 当前字漂移 as its nested child (same underlying effect, scoped to the word
                    being sung) shown under it - not a standalone effect in the list. */}
                <DioramaEffectSettings
                    label={t('options.dioramaSoulEffect')}
                    enabled={resolvedTuning.soulEnabled}
                    intensity={resolvedTuning.soulIntensity}
                    onEnabledChange={(next) => handleDioramaTuningChange({ soulEnabled: next })}
                    onIntensityChange={(next) => handleDioramaTuningChange({ soulIntensity: next })}
                    subEffect={{
                        label: t('options.dioramaSoulActiveEffect'),
                        enabled: resolvedTuning.soulActiveEnabled,
                        onEnabledChange: (next) => handleDioramaTuningChange({ soulActiveEnabled: next }),
                    }}
                    t={t}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                <DioramaEffectSettings
                    label={t('options.dioramaGradientEffect')}
                    enabled={resolvedTuning.gradientEnabled}
                    intensity={resolvedTuning.gradientIntensity}
                    onEnabledChange={(next) => handleDioramaTuningChange({ gradientEnabled: next })}
                    onIntensityChange={(next) => handleDioramaTuningChange({ gradientIntensity: next })}
                    t={t}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />

                {/* 关键字着色: a plain on/off - the colours themselves are the theme's 关键词 list, not a
                    strength. Independent of the follow-sing effects above: it sets the colour a unit RESTS
                    at, and they dye away from it and settle back onto it. */}
                <Row label={t('options.dioramaKeywordColoring')}>
                    <Toggle
                        checked={resolvedTuning.keywordColoringEnabled}
                        onChange={(next) => handleDioramaTuningChange({ keywordColoringEnabled: next })}
                    />
                </Row>

                <DioramaGeometrySettings
                    t={t}
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
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />

                <DioramaBackgroundParticleSettings
                    label={t('options.dioramaShowParticles')}
                    enabled={resolvedTuning.showParticles}
                    circumference={resolvedTuning.backgroundParticleCircumference}
                    radial={resolvedTuning.backgroundParticleRadial}
                    onEnabledChange={(next) => handleDioramaTuningChange({ showParticles: next })}
                    onCircumferenceChange={(backgroundParticleCircumference) => handleDioramaTuningChange({ backgroundParticleCircumference })}
                    onRadialChange={(backgroundParticleRadial) => handleDioramaTuningChange({ backgroundParticleRadial })}
                    t={t}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
            </Group>
            <Group def={DIORAMA_RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={resolvedTuning.render}
                    onChange={(patch) => handleDioramaTuningChange({ render: { ...resolvedTuning.render, ...patch } })}
                />
            </Group>
        </>
    );
};

const clampCladdaghLetterSpacingOffset = (val: number) => Math.min(20, Math.max(-5, val));

export const CladdaghSettingsPanel: React.FC<VisualizerSettingsPanelProps<CladdaghTuning>> = ({
    t,
    onSliderPointerDown,
    onSliderCommit,
    tuning: claddaghTuning = DEFAULT_CLADDAGH_TUNING,
    onTuningChange: onCladdaghTuningChange,
}) => {
    const resolvedTuning: CladdaghTuning = {
        focusScaleRatio: clampCladdaghFocusScaleRatio(claddaghTuning.focusScaleRatio ?? DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
        radiusScale: clampCladdaghRadiusScale(claddaghTuning.radiusScale ?? DEFAULT_CLADDAGH_TUNING.radiusScale),
        ellipseTiltDeg: clampCladdaghEllipseTiltDeg(claddaghTuning.ellipseTiltDeg ?? DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
        showAxisLine: claddaghTuning.showAxisLine ?? DEFAULT_CLADDAGH_TUNING.showAxisLine,
        letterSpacingOffset: clampCladdaghLetterSpacingOffset(claddaghTuning.letterSpacingOffset ?? DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
    };
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <Group def={CLADDAGH_GROUP}>
            <SliderRow
                {...drag}
                label={t('options.claddaghFocusScaleRatio')}
                value={resolvedTuning.focusScaleRatio}
                min={0}
                max={1.5}
                step={0.05}
                format={(value) => times(value + 1.0)}
                onChange={(value) => onCladdaghTuningChange?.({ focusScaleRatio: value })}
            />
            <SliderRow
                {...drag}
                label={t('options.claddaghRadiusScale')}
                value={resolvedTuning.radiusScale}
                min={0.5}
                max={1.5}
                step={0.05}
                format={times}
                onChange={(value) => onCladdaghTuningChange?.({ radiusScale: value })}
            />
            <SliderRow
                {...drag}
                label={t('options.claddaghEllipseTiltDeg')}
                value={resolvedTuning.ellipseTiltDeg}
                min={0}
                max={60}
                step={1}
                format={(value) => `${value}°`}
                onChange={(value) => onCladdaghTuningChange?.({ ellipseTiltDeg: value })}
            />
            <Row label={t('options.claddaghShowAxisLine')}>
                <Toggle
                    checked={resolvedTuning.showAxisLine}
                    onChange={(next) => onCladdaghTuningChange?.({ showAxisLine: next })}
                />
            </Row>
            <SliderRow
                {...drag}
                label={t('options.claddaghLetterSpacingOffset')}
                value={resolvedTuning.letterSpacingOffset}
                min={-5}
                max={20}
                step={0.5}
                format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}px`}
                onChange={(value) => onCladdaghTuningChange?.({ letterSpacingOffset: value })}
            />
        </Group>
    );
};
