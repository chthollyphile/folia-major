import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { getVisualizerModeLabel } from '../../../visualizer/registry';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';
import { Button, Group, Reveal, Row, Segmented, Toggle, Value, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { settingsAnchorSubview } from '../navigation/settingsAnchorModel';
import AiProviderSettings, { AI_SETTINGS_OPTIONS } from './ai/AiProviderSettings';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/AppearancePage.tsx
// The 外观 page: which lyric animation the player uses, light or dark, the colour theme, how a
// song's own theme is made and applied, and (desktop app) the AI provider that makes those themes.
// The lyric animation workbench and the theme colour editor are the existing overlays; their rows
// here only open them.

const LYRICS: SettingsGroupDef = { id: 'lyricsRenderer', titleKey: 'options.lyricsRenderer' };
const THEME: SettingsGroupDef = { id: 'themePresets', titleKey: 'options.settingsHeadingTheme' };
const SONG_THEME: SettingsGroupDef = { id: 'songTheme', titleKey: 'options.settingsHeadingSongTheme' };

const O = {
    lyricsAnimation: option(LYRICS, 'lyricsAnimationAdjust', 'options.lyricsAnimationAdjust'),
    daylight: option(THEME, 'daylightMode', 'options.daylightMode'),
    preset: option(THEME, 'themePreset', 'options.themePresets'),
    themePark: option(THEME, 'openThemePark', 'options.openThemePark'),
    autoSwitch: option(SONG_THEME, 'autoSwitchSongTheme', 'options.autoSwitchSongTheme'),
    autoGenerate: option(SONG_THEME, 'autoGenerateSongTheme', 'options.autoGenerateSongTheme'),
    source: option(SONG_THEME, 'themeGenerationSource', 'options.themeGenerationSource'),
    preferCustom: option(SONG_THEME, 'preferCustomTheme', 'options.preferCustomTheme'),

};

export const OPTIONS: SettingsOptionDef[] = [...Object.values(O), ...AI_SETTINGS_OPTIONS];

type DaylightChoice = 'light' | 'dark' | 'system';

const AppearancePage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, themeControls, onOpenVisPlayground, onOpenThemePark } = useSettingsPage();
    const { isDaylight, followSystemTheme, setDaylightPreference, setFollowSystemTheme } = useThemeSettingsStore(useShallow(state => ({
        isDaylight: state.isDaylight,
        followSystemTheme: state.followSystemTheme,
        setDaylightPreference: state.setDaylightPreference,
        setFollowSystemTheme: state.setFollowSystemTheme,
    })));
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const randomEnabled = useVisualizerSettingsStore(state => state.randomVisualizerModePerSong);
    const nativeBlurEnabled = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);

    return (
        <>
            <Group def={LYRICS} bare>
                {nativeBlurEnabled && <Row notice={t('options.nativeBlurBackgroundNotice')} />}
                <Row option={O.lyricsAnimation} hint={t('options.lyricsRendererDesc')} onClick={onOpenVisPlayground}>
                    <Value>{randomEnabled ? t('ui.visualizerRandom') : getVisualizerModeLabel(visualizerMode, t)}</Value>
                </Row>
            </Group>

            <Group def={THEME}>
                <Row option={O.daylight} note={t('options.followSystemThemeDesc')}>
                    <Segmented<DaylightChoice>
                        value={followSystemTheme ? 'system' : isDaylight ? 'light' : 'dark'}
                        options={[
                            { value: 'light', label: t('options.daylightModeLight') },
                            { value: 'dark', label: t('options.daylightModeDark') },
                            { value: 'system', label: t('options.daylightModeSystem') },
                        ]}
                        onChange={(choice) => {
                            if (choice === 'system') {
                                setFollowSystemTheme(true);
                            } else {
                                // A light or dark picked by hand also stops following the system.
                                setDaylightPreference(choice === 'light');
                            }
                        }}
                    />
                </Row>
                <Row option={O.preset}>
                    <Segmented
                        value={themeControls.bgMode}
                        options={[
                            { value: 'default', label: t('options.themePresetsDefault') },
                            { value: 'custom', label: t('options.customTheme'), disabled: !themeControls.hasCustomTheme },
                        ]}
                        onChange={mode => (mode === 'custom' ? themeControls.onApplyCustomTheme() : themeControls.onApplyDefaultTheme())}
                    />
                </Row>
                <Row option={O.themePark} onClick={onOpenThemePark} />
            </Group>

            <Group def={SONG_THEME}>
                <Row option={O.autoSwitch} note={t('options.autoSwitchSongThemeDesc')}>
                    <Toggle checked={themeControls.songThemeAutoSwitchEnabled} onChange={themeControls.onToggleSongThemeAutoSwitch} />
                </Row>
                <Reveal when={themeControls.songThemeAutoSwitchEnabled}>
                    <Row
                        sub
                        option={O.autoGenerate}
                        note={t(themeControls.themeGenerationSource === 'cover' ? 'options.autoGenerateSongThemeCoverDesc' : 'options.autoGenerateSongThemeDesc')}
                    >
                        <Toggle checked={themeControls.songThemeAutoGenerateEnabled} onChange={themeControls.onToggleSongThemeAutoGenerate} />
                    </Row>
                </Reveal>
                <Row
                    option={O.source}
                    note={t(themeControls.themeGenerationSource === 'cover' ? 'options.themeGenerationSourceCoverDesc' : 'options.themeGenerationSourceAiDesc')}
                >
                    <Segmented
                        value={themeControls.themeGenerationSource}
                        options={[
                            { value: 'ai', label: t('options.themeGenerationSourceAi'), disabled: themeControls.aiApiKeyStatus !== 'configured' },
                            { value: 'cover', label: t('options.themeGenerationSourceCover') },
                        ]}
                        onChange={themeControls.onChangeThemeGenerationSource}
                    />
                </Row>
                <Reveal when={themeControls.aiApiKeyStatus === 'missing'}>
                    <Row sub notice={t('options.themeGenerationSourceAiUnavailable')}>
                        <Button onClick={() => openSettings('options', settingsAnchorSubview('electronSettings'), null, 'electronSettings')}>
                            {t('options.configureAiApiKey')}
                        </Button>
                    </Row>
                </Reveal>
                <Row option={O.preferCustom} hint={t('options.preferCustomThemeDesc')}>
                    <Toggle
                        checked={themeControls.isCustomThemePreferred}
                        onChange={themeControls.onToggleCustomThemePreferred}
                        disabled={!themeControls.hasCustomTheme}
                    />
                </Row>
            </Group>

            {isElectron && <AiProviderSettings />}
        </>
    );
};

export default AppearancePage;
