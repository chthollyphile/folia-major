import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { CROSSFADE_MAX_SEC, CROSSFADE_MIN_SEC } from '../../../../services/automix/crossfadePlanner';
import { modelsPresent, subscribeModelAvailability } from '../../../../services/analysis/modelAvailability';
import { transitionCapabilities } from '../../../../services/automix/stems';
import { announceTransition, type TransitionRenderer } from '../../../../services/automix/transitionCue';
import { canAnalyseTracks } from '../../../../services/automix/transitionStrategy';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../../../../stores/useAutomixSettingsStore';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { runsOnWindows } from '../../../../utils/platform';
import { Button, Chips, Group, Reveal, Row, Segmented, Slider, Status, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import AudioOutputDeviceRow from './AudioOutputDeviceRow';
import { PlaybackBackendRow } from './PlaybackBackendRow';
import { selectedPlaybackBackend, subscribePlaybackBackends } from '../../../../services/playbackBackend/registry';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/PlaybackPage.tsx
// The 播放控制 page: how one song hands over to the next (Folia transitions), where the sound goes
// and how loud it is, what play and add-to-queue do, and (desktop app) the folded group of the
// analysis models the full transition engine needs.

const TRANSITION: SettingsGroupDef = { id: 'transitionSettings', titleKey: 'options.transitionSettings' };
const SOUND: SettingsGroupDef = { id: 'audioOutputSettings', titleKey: 'options.settingsHeadingSound' };
const BEHAVIOR: SettingsGroupDef = { id: 'queueSettings', titleKey: 'options.settingsHeadingPlaybackBehavior' };

const O = {
    transition: option(TRANSITION, 'transitionEnable', 'options.transitionEnable'),
    mode: option(TRANSITION, 'transitionMode', 'options.transitionMode'),
    crossfadeMax: option(TRANSITION, 'crossfadeMaxSeconds', 'options.crossfadeMaxSeconds'),
    performance: option(TRANSITION, 'transitionPerformance', 'options.transitionPerformance'),
    animation: option(TRANSITION, 'transitionAnimation', 'options.transitionAnimation'),
    animationRing: option(TRANSITION, 'transitionAnimationRing', 'options.transitionAnimationRing'),
    animationCard: option(TRANSITION, 'transitionAnimationCard', 'options.transitionAnimationCard'),
    outputDevice: option(SOUND, 'audioOutputDevice', 'options.audioOutputDevice'),
    backend: option(SOUND, 'playbackBackend', 'options.playbackBackend', { electronOnly: true }),
    replayGain: option(SOUND, 'replayGainSettings', 'options.replayGainMode'),
    fade: option(SOUND, 'playbackFade', 'options.playbackFade'),
    transcode: option(SOUND, 'transcodeFallback', 'options.transcodeFallback', { electronOnly: true }),
    queueBehavior: option(BEHAVIOR, 'queueDefaultBehavior', 'options.queueDefaultBehavior'),
    autoSkipUnplayable: option(BEHAVIOR, 'autoSkipUnplayable', 'options.autoSkipUnplayable'),
    preventSleep: option(BEHAVIOR, 'preventDisplaySleepDuringPlayback', 'options.preventDisplaySleepDuringPlayback', { electronOnly: true }),
    voiceInputPause: option(BEHAVIOR, 'voiceInputPause', 'options.voiceInputPause', { electronOnly: true, available: () => runsOnWindows() }),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

/**
 * The pass an animation chip plays when it is switched on: a ten-second blend at 120 BPM, addressed
 * to the drawing that was switched on, so the other one does not play again with it.
 */
const previewCue = (renderer: TransitionRenderer) => (
    { seconds: 10, crossover: 0.55, periodSec: 0.5, preview: renderer } as const
);

const PlaybackPage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const nativeOutput = React.useSyncExternalStore(subscribePlaybackBackends, selectedPlaybackBackend) !== null;
    const { replayGainMode, onReplayGainModeChange, onAudioOutputDeviceChange } = viewProps.playback;
    const { voiceInputPause } = viewProps.lab;
    const automix = useAutomixSettingsStore(useShallow(state => ({
        enabled: state.automixEnabled,
        mode: state.transitionMode,
        crossfadeMaxSec: state.crossfadeMaxSec,
        performance: state.transitionPerformance,
        animationRing: state.transitionAnimation,
        animationCard: state.transitionAnimationCard,
        setEnabled: state.handleToggleAutomix,
        setMode: state.handleSetTransitionMode,
        setCrossfadeMaxSec: state.handleSetCrossfadeMaxSec,
        setPerformance: state.handleToggleTransitionPerformance,
        setAnimationRing: state.handleToggleTransitionAnimation,
        setAnimationCard: state.handleToggleTransitionAnimationCard,
    })));
    const audio = useAudioSettingsStore(useShallow(state => ({
        mediaCache: state.enableMediaCache,
        fade: state.playbackFadeEnabled,
        transcode: state.enableTranscodeFallback,
        queueBehavior: state.queueAddBehavior,
        autoSkipUnplayable: state.autoSkipUnplayable,
        setMediaCache: state.handleToggleMediaCache,
        setFade: state.handleTogglePlaybackFade,
        setTranscode: state.handleToggleTranscodeFallback,
        setQueueBehavior: state.handleSetQueueAddBehavior,
        setAutoSkipUnplayable: state.handleToggleAutoSkipUnplayable,
    })));
    const preventSleep = useDesktopSettingsStore(state => state.preventDisplaySleepDuringPlayback);
    const setPreventSleep = useDesktopSettingsStore(state => state.handleTogglePreventDisplaySleepDuringPlayback);

    // Asked on every render, not kept: whether the models are on disk can change while the page is
    // open, and the subscription below only makes the page render again when it does.
    React.useSyncExternalStore(subscribeModelAvailability, modelsPresent);
    const analysable = canAnalyseTracks();
    const capabilities = transitionCapabilities();
    const usesAutomix = automix.mode === 'automix';
    // Automix without a full engine says why in place of what Automix does.
    const modeHint = !usesAutomix
        ? t('options.transitionCrossfadeDesc')
        : !analysable || capabilities.full
            ? t('options.transitionAutomixDesc')
            : t(capabilities.desktop ? 'options.transitionEngineNeedsModels' : 'options.transitionEngineLiteDesc');

    // Switching a drawing on plays it once at once; otherwise it would wait for the next long blend.
    const animationChip = (def: SettingsOptionDef, renderer: TransitionRenderer, checked: boolean, set: (enabled: boolean) => void) => ({
        id: def.id,
        label: t(def.labelKey),
        checked,
        onChange: (next: boolean) => {
            set(next);
            if (next) announceTransition(previewCue(renderer));
        },
    });

    return (
        <>
            <Group def={TRANSITION}>
                <Row option={O.transition} disabled={nativeOutput}>
                    <Toggle checked={automix.enabled} onChange={automix.setEnabled} />
                </Row>
                <Reveal when={automix.enabled && !nativeOutput}>
                    <Row sub option={O.mode} hint={modeHint}>
                        {/* The mode that runs is not always the chosen one: Automix that cannot
                            measure a track runs as a crossfade, and without the models as the
                            lighter engine. */}
                        {usesAutomix && (analysable ? (
                            <Status tone={capabilities.full ? 'ok' : undefined}>
                                {t(capabilities.full ? 'options.transitionEngineFull' : 'options.transitionEngineLite')}
                            </Status>
                        ) : (
                            <Status tone="warn">{t('options.transitionFellBack')}</Status>
                        ))}
                        <Segmented
                            value={automix.mode}
                            options={[
                                { value: 'crossfade', label: t('options.transitionCrossfade') },
                                { value: 'automix', label: t('options.transitionAutomix'), disabled: !analysable },
                            ]}
                            onChange={automix.setMode}
                        />
                    </Row>
                    <Reveal when={!usesAutomix}>
                        <Row sub option={O.crossfadeMax}>
                            <Slider
                                value={automix.crossfadeMaxSec}
                                min={CROSSFADE_MIN_SEC}
                                max={CROSSFADE_MAX_SEC}
                                onChange={automix.setCrossfadeMaxSec}
                                format={seconds => t('options.crossfadeSecondsValue', { seconds })}
                            />
                        </Row>
                    </Reveal>
                    <Reveal when={usesAutomix}>
                        {!analysable && <Row sub notice={t('options.transitionAutomixUnavailable')} />}
                        <Reveal when={analysable && !audio.mediaCache}>
                            <Row sub notice={t('options.transitionAutomixNeedsCache')}>
                                <Button onClick={() => audio.setMediaCache(true)}>{t('options.transitionAutomixEnableCache')}</Button>
                            </Row>
                        </Reveal>
                        {/* Kept in view when the app cannot separate a track: the reason is under the label. */}
                        <Row
                            sub
                            option={O.performance}
                            hint={t(capabilities.stems
                                ? 'options.transitionPerformanceDesc'
                                : capabilities.desktop ? 'options.transitionPerformanceNeedsModel' : 'options.transitionPerformanceNeedsStems')}
                            disabled={!capabilities.stems}
                        >
                            <Toggle checked={automix.performance && capabilities.stems} onChange={automix.setPerformance} />
                        </Row>
                        <Row
                            sub
                            option={O.animation}
                            hint={t('options.transitionAnimationDesc')}
                            note={(
                                <>
                                    <span className="text-[color:var(--st-t1)]">{t('options.transitionAnimationRing')}</span> {t('options.transitionAnimationRingDesc')}
                                    <br />
                                    <span className="text-[color:var(--st-t1)]">{t('options.transitionAnimationCard')}</span> {t('options.transitionAnimationCardDesc')}
                                </>
                            )}
                        >
                            <Chips
                                items={[
                                    animationChip(O.animationRing, 'ring', automix.animationRing, automix.setAnimationRing),
                                    animationChip(O.animationCard, 'card', automix.animationCard, automix.setAnimationCard),
                                ]}
                            />
                        </Row>
                    </Reveal>
                </Reveal>
            </Group>

            <Group def={SOUND}>
                {isElectron && <PlaybackBackendRow option={O.backend} />}
                {!nativeOutput && <AudioOutputDeviceRow option={O.outputDevice} onDeviceChange={onAudioOutputDeviceChange} />}
                <Row option={O.replayGain} note={t('options.replayGainModeDesc')} disabled={nativeOutput}>
                    <Segmented
                        value={replayGainMode}
                        options={[
                            { value: 'off', label: t('localMusic.replayGainOff') },
                            { value: 'track', label: t('localMusic.replayGainTrack') },
                            { value: 'album', label: t('localMusic.replayGainAlbum') },
                        ]}
                        onChange={onReplayGainModeChange}
                    />
                </Row>
                <Row option={O.fade} hint={t('options.playbackFadeDesc')} disabled={nativeOutput}>
                    <Toggle checked={audio.fade} onChange={audio.setFade} />
                </Row>
                {window.electron?.requestTranscodeFallback && (
                    <Row option={O.transcode} hint={t('options.transcodeFallbackDesc')} disabled={nativeOutput}>
                        <Toggle checked={audio.transcode} onChange={audio.setTranscode} />
                    </Row>
                )}
            </Group>

            <Group def={BEHAVIOR}>
                <Row option={O.queueBehavior}>
                    <Segmented
                        value={audio.queueBehavior}
                        options={[
                            { value: 'append', label: t('options.queueAppendLabel') },
                            { value: 'next', label: t('options.queueNextLabel') },
                        ]}
                        onChange={audio.setQueueBehavior}
                    />
                </Row>
                <Row option={O.autoSkipUnplayable} note={t('options.autoSkipUnplayableDesc')}>
                    <Toggle checked={audio.autoSkipUnplayable} onChange={audio.setAutoSkipUnplayable} />
                </Row>
                {isElectron && (
                    <Row option={O.preventSleep} hint={t('options.preventDisplaySleepDuringPlaybackDesc')}>
                        <Toggle checked={preventSleep} onChange={setPreventSleep} />
                    </Row>
                )}
                {voiceInputPause.supported && (
                    <Row option={O.voiceInputPause} hint={t('options.voiceInputPauseDesc')}>
                        <Toggle checked={voiceInputPause.enabled} onChange={voiceInputPause.onToggle} />
                    </Row>
                )}
            </Group>
        </>
    );
};

export default PlaybackPage;
