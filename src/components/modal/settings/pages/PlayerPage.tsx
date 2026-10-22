import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { PLAYER_CONTROL_SLOT_OPTIONS } from '../../../floating-player/playerControlSlotActions';
import FastColorPicker from '../../../shared/FastColorPicker';
import { useColorPreviewThrottle } from '../../../shared/useColorPreviewThrottle';
import { playerBottomBarLiveOffset } from '../../../../stores/motionSignals';
import { useLatticeSettingsStore } from '../../../../stores/useLatticeSettingsStore';
import { usePlaybackEntryViewStore } from '../../../../stores/usePlaybackEntryViewStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlayerBottomBarLayoutStore } from '../../../../stores/usePlayerBottomBarLayoutStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { hasNowPlayingCardSong, useNowPlayingCardLayoutStore } from '../../../app/overlays/now-playing-toast/nowPlayingCardLayoutStore';
import { useStageSettingsStore } from '../../../../stores/useStageSettingsStore';
import { useTypographySettingsStore } from '../../../../stores/useTypographySettingsStore';
import { ensureVideoLayerFileRestored, useVideoLayerSettingsStore, VIDEO_LAYER_OPACITY_BOUNDS } from '../../../../stores/useVideoLayerSettingsStore';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, resolvePlayerBottomBarMaxOffset } from '../../../../utils/playerBottomBarLayout';
import { Button, FoldedGroup, Group, PictureChoice, Reveal, Row, Segmented, Select, Slider, TextField, Toggle, Value, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { EntryViewPicture } from './pictures';

// src/components/modal/settings/pages/PlayerPage.tsx
// The 播放页 page: what the playing screen looks like. Which view play opens and the look of the
// queue collage, the control bar, the now-playing card, the video behind the lyrics, and a folded
// group of switches that hide or pin parts of the player.

const VIEW: SettingsGroupDef = { id: 'playbackEntryView', titleKey: 'options.settingsHeadingView' };
const BAR: SettingsGroupDef = { id: 'bottomUiSettings', titleKey: 'options.settingsHeadingControlBar' };
const CARD: SettingsGroupDef = { id: 'stageTrackPill', titleKey: 'options.stageTrackPill' };
const VIDEO: SettingsGroupDef = { id: 'videoLayerSettings', titleKey: 'options.videoLayerSettings' };
const PLAYER_UI: SettingsGroupDef = { id: 'labPlayerUi', titleKey: 'options.labPlayerUiSection' };

const O = {
    entryView: option(VIEW, 'playbackEntryViewChoice', 'options.playbackEntryView'),
    vignette: option(VIEW, 'latticeSettings', 'options.latticeVignette'),
    tint: option(VIEW, 'latticePosterTint', 'options.latticePosterTint'),
    tintCustomColor: option(VIEW, 'latticePosterTintCustomColor', 'options.latticePosterTintCustomColor'),
    tintColor: option(VIEW, 'latticePosterTintColor', 'options.latticePosterTintColor'),
    tintIntensity: option(VIEW, 'latticePosterTintIntensity', 'options.latticePosterTintIntensity'),
    autoHide: option(BAR, 'autoHidePlayerChrome', 'options.autoHidePlayerChrome'),
    autoHideCursor: option(BAR, 'autoHideCursorWithPlayerChrome', 'options.autoHideCursorWithPlayerChrome'),
    idleCursorHide: option(BAR, 'hideCursorWhenIdle', 'options.hideCursorWhenIdle'),
    barOffset: option(BAR, 'playerBottomBarOffset', 'options.playerBottomBarOffset'),
    barReposition: option(BAR, 'playerBottomBarReposition', 'options.playerBottomBarReposition'),
    controlSlots: option(BAR, 'playerControlSlots', 'options.playerControlSlots'),
    cardMode: option(CARD, 'stageTrackPillMode', 'options.stageTrackPillMode'),
    cardTimeout: option(CARD, 'stageTrackPillTimeout', 'options.stageTrackPillTimeout'),
    cardPosition: option(CARD, 'stageTrackPillReposition', 'options.stageTrackPillReposition'),
    cardOnHome: option(CARD, 'stageTrackPillOnHome', 'options.stageTrackPillOnHome'),
    cardCloseButton: option(CARD, 'showOpenPanelCloseButton', 'options.showOpenPanelCloseButton'),
    videoEnabled: option(VIDEO, 'videoLayerEnabled', 'options.videoLayerEnabled'),
    videoFile: option(VIDEO, 'videoLayerLocalFile', 'options.videoLayerLocalFile'),
    videoUrl: option(VIDEO, 'videoLayerUrl', 'options.videoLayerUrl'),
    videoOpacity: option(VIDEO, 'videoLayerOpacity', 'options.videoLayerOpacity'),
    videoFit: option(VIDEO, 'videoLayerFit', 'options.videoLayerFit'),
    hideProgressBar: option(PLAYER_UI, 'hidePlayerProgressBar', 'options.hidePlayerProgressBar'),
    hideSubtitle: option(PLAYER_UI, 'hidePlayerTranslationSubtitle', 'options.hidePlayerTranslationSubtitle'),
    hidePanelButton: option(PLAYER_UI, 'hidePlayerRightPanelButton', 'options.hidePlayerRightPanelButton'),
    alwaysBackButton: option(PLAYER_UI, 'alwaysShowPlayerBackButton', 'options.alwaysShowPlayerBackButton'),
    alwaysTrackSwitch: option(PLAYER_UI, 'alwaysShowTrackSwitchButtons', 'options.alwaysShowTrackSwitchButtons'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const percent = (value: number) => `${Math.round(value * 100)}%`;

const PlayerPage: React.FC = () => {
    const { t } = useTranslation();
    const { playbackEntryView, setPlaybackEntryView } = usePlaybackEntryViewStore(useShallow(state => ({
        playbackEntryView: state.playbackEntryView,
        setPlaybackEntryView: state.setPlaybackEntryView,
    })));
    const lattice = useLatticeSettingsStore(useShallow(state => ({
        vignette: state.latticeVignette,
        tintEnabled: state.latticePosterTintEnabled,
        tintUseCustomColor: state.latticePosterTintUseCustomColor,
        tintColor: state.latticePosterTintColor,
        tintIntensity: state.latticePosterTintIntensity,
        setVignette: state.handleToggleLatticeVignette,
        setTintEnabled: state.handleToggleLatticePosterTint,
        setTintUseCustomColor: state.handleToggleLatticePosterTintCustomColor,
        setTintColor: state.handleSetLatticePosterTintColor,
        setTintIntensity: state.handleSetLatticePosterTintIntensity,
    })));
    const chrome = usePlayerChromeSettingsStore(useShallow(state => ({
        autoHide: state.autoHidePlayerChrome,
        autoHideCursor: state.autoHideCursorWithPlayerChrome,
        hideCursorWhenIdle: state.hideCursorWhenIdle,
        barOffset: state.playerBottomBarOffset,
        slotPrimary: state.playerControlSlotPrimary,
        slotSecondary: state.playerControlSlotSecondary,
        hideProgressBar: state.hidePlayerProgressBar,
        hidePanelButton: state.hidePlayerRightPanelButton,
        alwaysBackButton: state.alwaysShowPlayerBackButton,
        alwaysTrackSwitch: state.alwaysShowTrackSwitchButtons,
        cardCloseButton: state.showOpenPanelCloseButton,
        setAutoHide: state.handleToggleAutoHidePlayerChrome,
        setAutoHideCursor: state.handleToggleAutoHideCursorWithPlayerChrome,
        setHideCursorWhenIdle: state.handleToggleHideCursorWhenIdle,
        setBarOffset: state.handleSetPlayerBottomBarOffset,
        setSlot: state.handleSetPlayerControlSlot,
        setHideProgressBar: state.handleToggleHidePlayerProgressBar,
        setHidePanelButton: state.handleToggleHidePlayerRightPanelButton,
        setAlwaysBackButton: state.handleToggleAlwaysShowPlayerBackButton,
        setAlwaysTrackSwitch: state.handleToggleAlwaysShowTrackSwitchButtons,
        setCardCloseButton: state.handleToggleOpenPanelCloseButton,
    })));
    const card = useStageSettingsStore(useShallow(state => ({
        mode: state.stageTrackPillMode,
        timeoutSec: state.stageTrackPillTimeoutSec,
        onHome: state.stageTrackPillOnHome,
        setMode: state.handleSetStageTrackPillMode,
        setTimeoutSec: state.handleSetStageTrackPillTimeoutSec,
        setOnHome: state.handleToggleStageTrackPillOnHome,
    })));
    const video = useVideoLayerSettingsStore(useShallow(state => ({
        enabled: state.videoLayerEnabled,
        url: state.videoLayerUrl,
        opacity: state.videoLayerOpacity,
        fit: state.videoLayerFit,
        localFileName: state.localFileName,
        localFileStatus: state.localFileStatus,
        canPersistLocalFile: state.canPersistLocalFile,
        setEnabled: state.setVideoLayerEnabled,
        setUrl: state.setVideoLayerUrl,
        setOpacity: state.setVideoLayerOpacity,
        setFit: state.setVideoLayerFit,
        pickLocalFile: state.pickLocalFile,
        clearLocalFile: state.clearLocalFile,
        regrantLocalFile: state.regrantLocalFile,
    })));
    const hideSubtitle = useTypographySettingsStore(state => state.hidePlayerTranslationSubtitle);
    const setHideSubtitle = useTypographySettingsStore(state => state.handleToggleHidePlayerTranslationSubtitle);
    const hasCurrentSong = usePlaybackStore(state => Boolean(state.currentSong));
    const canPositionCard = usePlaybackStore(hasNowPlayingCardSong);
    const requestCardPosition = useNowPlayingCardLayoutStore(state => state.requestPositioning);
    const requestPositioning = usePlayerBottomBarLayoutStore(state => state.requestPositioning);
    const tintColorPreview = useColorPreviewThrottle(lattice.setTintColor);

    // The slider's upper end follows the viewport height, also while the settings are open.
    const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
    useEffect(() => {
        const syncHeight = () => setViewportHeight(window.innerHeight);
        window.addEventListener('resize', syncHeight);
        return () => window.removeEventListener('resize', syncHeight);
    }, []);
    const maxBarOffset = resolvePlayerBottomBarMaxOffset(viewportHeight);
    // The slider and dragging on the player change the same value, so the live MotionValue gets it
    // too; otherwise the player would not move while the slider does.
    const applyBarOffset = (next: number) => {
        chrome.setBarOffset(next);
        playerBottomBarLiveOffset.set(next);
    };
    const canReposition = hasCurrentSong && !chrome.hideProgressBar;
    const slotOptions = useMemo(
        () => PLAYER_CONTROL_SLOT_OPTIONS.map(slot => ({ value: slot.id, label: t(slot.labelKey) })),
        [t],
    );

    // The URL commits on blur/Enter, so a half-typed address never reaches the <video>.
    const [urlDraft, setUrlDraft] = useState(video.url);
    useEffect(() => {
        ensureVideoLayerFileRestored();
    }, []);
    useEffect(() => {
        setUrlDraft(video.url);
    }, [video.url]);
    const pickVideo = async () => {
        try {
            await video.pickLocalFile();
        } catch (error) {
            console.error('[VideoLayer] Failed to pick a video:', error);
            setStatusMessage({ type: 'error', text: t('options.videoLayerPickFailed') });
        }
    };

    return (
        <>
            <Group def={VIEW}>
                <Row option={O.entryView} hint={t('options.playbackEntryViewDesc')}>
                    <PictureChoice
                        value={playbackEntryView}
                        options={[
                            { value: 'player', label: t('playbackEntryView.player.title'), picture: <EntryViewPicture view="player" /> },
                            { value: 'lattice', label: t('playbackEntryView.lattice.title'), picture: <EntryViewPicture view="lattice" /> },
                            { value: 'stay', label: t('playbackEntryView.stay.title'), picture: <EntryViewPicture view="stay" /> },
                        ]}
                        onChange={setPlaybackEntryView}
                    />
                </Row>
                <Row option={O.vignette} note={t('options.latticeVignetteDesc')}>
                    <Toggle checked={lattice.vignette} onChange={lattice.setVignette} />
                </Row>
                <Row option={O.tint} note={t('options.latticePosterTintDesc')}>
                    <Toggle checked={lattice.tintEnabled} onChange={lattice.setTintEnabled} />
                </Row>
                <Reveal when={lattice.tintEnabled}>
                    <Row sub option={O.tintCustomColor} hint={t('options.latticePosterTintCustomColorDesc')}>
                        <Toggle checked={lattice.tintUseCustomColor} onChange={lattice.setTintUseCustomColor} />
                    </Row>
                    <Reveal when={lattice.tintUseCustomColor}>
                        <Row
                            sub
                            option={O.tintColor}
                            below={(
                                <div onPointerUpCapture={tintColorPreview.flushColor} onPointerCancelCapture={tintColorPreview.flushColor}>
                                    <FastColorPicker color={lattice.tintColor} height={128} onChange={tintColorPreview.previewColor} />
                                </div>
                            )}
                        >
                            <Value>{lattice.tintColor.toUpperCase()}</Value>
                        </Row>
                    </Reveal>
                    <Row sub option={O.tintIntensity}>
                        <Slider value={lattice.tintIntensity} min={0} max={1} step={0.01} onChange={lattice.setTintIntensity} format={percent} />
                    </Row>
                </Reveal>
            </Group>

            <Group def={BAR}>
                <Row option={O.autoHide} note={t('options.autoHidePlayerChromeDesc')}>
                    <Toggle checked={chrome.autoHide} onChange={chrome.setAutoHide} />
                </Row>
                <Reveal when={chrome.autoHide}>
                    <Row sub option={O.autoHideCursor} note={t('options.autoHideCursorWithPlayerChromeDesc')}>
                        <Toggle checked={chrome.autoHideCursor} onChange={chrome.setAutoHideCursor} />
                    </Row>
                </Reveal>
                <Row option={O.idleCursorHide} note={t('options.hideCursorWhenIdleDesc')}>
                    <Toggle checked={chrome.hideCursorWhenIdle} onChange={chrome.setHideCursorWhenIdle} />
                </Row>
                <Row option={O.barOffset} note={t('options.playerBottomBarOffsetDesc')}>
                    <Button
                        icon={RotateCcw}
                        tip={t('options.playerBottomBarReset')}
                        onClick={() => applyBarOffset(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX)}
                        disabled={chrome.barOffset === PLAYER_BOTTOM_BAR_BASE_OFFSET_PX}
                    />
                    <Slider
                        value={chrome.barOffset}
                        min={PLAYER_BOTTOM_BAR_BASE_OFFSET_PX}
                        max={maxBarOffset}
                        onChange={applyBarOffset}
                        format={value => `${value}px`}
                    />
                </Row>
                <Row
                    option={O.barReposition}
                    hint={canReposition ? undefined : t('options.playerBottomBarRepositionUnavailable')}
                    onClick={requestPositioning}
                    disabled={!canReposition}
                />
                <Row option={O.controlSlots} note={t('options.playerControlSlotsDesc')}>
                    <Select
                        name={t('options.playerControlSlotPrimary')}
                        value={chrome.slotPrimary}
                        options={slotOptions}
                        onChange={next => chrome.setSlot('primary', next)}
                    />
                    <Select
                        name={t('options.playerControlSlotSecondary')}
                        value={chrome.slotSecondary}
                        options={slotOptions}
                        onChange={next => chrome.setSlot('secondary', next)}
                    />
                </Row>
            </Group>

            <Group def={CARD}>
                <Row option={O.cardPosition}>
                    <Button onClick={requestCardPosition} disabled={!canPositionCard}>{t('options.stageTrackPillReposition')}</Button>
                </Row>
                <Row option={O.cardMode} note={t('options.stageTrackPillDesc')}>
                    <Segmented
                        value={card.mode}
                        options={[
                            { value: 'auto', label: t('options.stageTrackPillMode_auto') },
                            { value: 'always', label: t('options.stageTrackPillMode_always') },
                            { value: 'never', label: t('options.stageTrackPillMode_never') },
                        ]}
                        onChange={card.setMode}
                    />
                </Row>
                <Reveal when={card.mode === 'auto'}>
                    <Row sub option={O.cardTimeout}>
                        <Slider value={card.timeoutSec} min={3} max={60} onChange={card.setTimeoutSec} format={value => `${value}s`} />
                    </Row>
                </Reveal>
                <Reveal when={card.mode !== 'never'}>
                    <Row option={O.cardOnHome} note={t('options.stageTrackPillOnHomeDesc')}>
                        <Toggle checked={card.onHome} onChange={card.setOnHome} />
                    </Row>
                </Reveal>
                <Row option={O.cardCloseButton} hint={t('options.showOpenPanelCloseButtonDesc')}>
                    <Toggle checked={chrome.cardCloseButton} onChange={chrome.setCardCloseButton} />
                </Row>
            </Group>

            <Group def={VIDEO}>
                <Row
                    option={O.videoEnabled}
                    note={(
                        <>
                            {t('options.videoLayerDesc')}
                            <br />
                            {t('options.videoLayerNotInExport')}
                        </>
                    )}
                >
                    <Toggle checked={video.enabled} onChange={video.setEnabled} />
                </Row>
                <Reveal when={video.enabled || video.localFileStatus !== 'none'}>
                    <Row
                        sub
                        option={O.videoFile}
                        note={t(video.canPersistLocalFile ? 'options.videoLayerLocalFileDesc' : 'options.videoLayerLocalFileSessionDesc')}
                    >
                        {video.localFileStatus !== 'none' && (
                            <>
                                <Value tip={video.localFileName ?? undefined}>{video.localFileName}</Value>
                                <Button icon={X} tip={t('options.videoLayerClearFile')} onClick={() => void video.clearLocalFile()} />
                            </>
                        )}
                        {video.localFileStatus === 'needs-permission' && (
                            <Button onClick={() => void video.regrantLocalFile()}>{t('options.videoLayerRegrant')}</Button>
                        )}
                        <Button onClick={() => void pickVideo()}>{t('options.videoLayerPickFile')}</Button>
                    </Row>
                </Reveal>
                <Reveal when={video.enabled}>
                    <Row sub option={O.videoUrl} hint={t('options.videoLayerUrlDesc')}>
                        <TextField
                            type="url"
                            value={urlDraft}
                            onChange={setUrlDraft}
                            onCommit={() => video.setUrl(urlDraft)}
                            placeholder="https://example.com/loop.mp4"
                        />
                    </Row>
                    <Row sub option={O.videoOpacity}>
                        <Slider
                            value={video.opacity}
                            min={VIDEO_LAYER_OPACITY_BOUNDS.min}
                            max={VIDEO_LAYER_OPACITY_BOUNDS.max}
                            step={0.05}
                            onChange={video.setOpacity}
                            format={percent}
                        />
                    </Row>
                    <Row sub option={O.videoFit}>
                        <Segmented
                            value={video.fit}
                            options={[
                                { value: 'cover', label: t('options.videoLayerFitCover') },
                                { value: 'contain', label: t('options.videoLayerFitContain') },
                            ]}
                            onChange={video.setFit}
                        />
                    </Row>
                </Reveal>
            </Group>

            <FoldedGroup def={PLAYER_UI}>
                <Row option={O.hideProgressBar} note={t('options.labHidePlayerUiDesc')}>
                    <Toggle checked={chrome.hideProgressBar} onChange={chrome.setHideProgressBar} />
                </Row>
                <Row option={O.hideSubtitle} hint={t('options.hidePlayerTranslationSubtitleDesc')}>
                    <Toggle checked={hideSubtitle} onChange={setHideSubtitle} />
                </Row>
                <Row option={O.hidePanelButton}>
                    <Toggle checked={chrome.hidePanelButton} onChange={chrome.setHidePanelButton} />
                </Row>
                <Row option={O.alwaysBackButton} hint={t('options.alwaysShowPlayerBackButtonDesc')}>
                    <Toggle checked={chrome.alwaysBackButton} onChange={chrome.setAlwaysBackButton} />
                </Row>
                <Row option={O.alwaysTrackSwitch} note={t('options.alwaysShowTrackSwitchButtonsDesc')}>
                    <Toggle checked={chrome.alwaysTrackSwitch} onChange={chrome.setAlwaysTrackSwitch} />
                </Row>
            </FoldedGroup>
        </>
    );
};

export default PlayerPage;
