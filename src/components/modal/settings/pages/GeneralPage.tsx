import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { AppLanguagePreference } from '../../../../i18n/config';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { selectPonderSettingsSnapshot, usePonderStore } from '../../../../stores/usePonderStore';
import { useSettingsModalStore } from '../../../../stores/useSettingsModalStore';
import { Button, Group, Reveal, Row, Segmented, Select, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { FoundUpdateRow } from './FoundUpdateRow';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/GeneralPage.tsx
// The 通用 page: the interface language, what the app does when it starts and how its window
// buttons show, the desktop app's update check (with the new version, once one is found), and the
// hints of the Ponder tutorials.

const LANGUAGE: SettingsGroupDef = { id: 'languageSettings', titleKey: 'options.languageSettings' };
const LAUNCH: SettingsGroupDef = { id: 'labWindowAndTools', titleKey: 'options.settingsHeadingLaunch' };
const UPDATE: SettingsGroupDef = { id: 'updateCheck', titleKey: 'options.updateCheck', electronOnly: true };
const PONDER: SettingsGroupDef = { id: 'ponderHints', titleKey: 'options.ponderHints' };

const O = {
    language: option(LANGUAGE, 'appLanguage', 'options.appLanguage'),
    autoPlay: option(LAUNCH, 'autoPlayOnLaunch', 'options.autoPlayOnLaunch'),
    openPlayer: option(LAUNCH, 'openPlayerOnLaunch', 'options.openPlayerOnLaunch', { electronOnly: true }),
    titlebarButtons: option(LAUNCH, 'alwaysShowMainWindowTitlebar', 'options.alwaysShowMainWindowTitlebar'),
    updateCheck: option(UPDATE, 'enableUpdateCheck', 'options.enableUpdateCheck'),
    autoUpdate: option(UPDATE, 'enableAutoUpdate', 'options.enableAutoUpdate'),
    updateChannel: option(UPDATE, 'updateChannel', 'options.updateChannel'),
    ponderHints: option(PONDER, 'ponderHintVisibility', 'options.ponderHints'),
    ponderTouchButton: option(PONDER, 'ponderTouchButton', 'options.ponderTouchButton'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const GeneralPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const { openPlayerOnLaunch, onToggleOpenPlayerOnLaunch } = viewProps.desktop.preferences;
    const update = viewProps.desktop.model;
    const { electronSettings, updateStatus } = update;
    const languagePreference = useSettingsModalStore(state => state.appLanguagePreference);
    const setLanguagePreference = useSettingsModalStore(state => state.handleSetAppLanguagePreference);
    const autoPlay = useAudioSettingsStore(state => state.autoPlayOnLaunch);
    const setAutoPlay = useAudioSettingsStore(state => state.handleToggleAutoPlayOnLaunch);
    const titlebarButtons = usePlayerChromeSettingsStore(state => state.alwaysShowMainWindowTitlebar);
    const setTitlebarButtons = usePlayerChromeSettingsStore(state => state.handleToggleAlwaysShowMainWindowTitlebar);
    const ponder = usePonderStore(useShallow(selectPonderSettingsSnapshot));

    const resolvedLanguage = i18n.resolvedLanguage;
    const resolvedLanguageLabel = resolvedLanguage === 'zh-TW'
        ? t('options.appLanguageZhTW')
        : resolvedLanguage?.startsWith('zh')
            ? t('options.appLanguageZhCN')
            : resolvedLanguage === 'in' || resolvedLanguage?.startsWith('id')
                ? t('options.appLanguageInID')
                : resolvedLanguage === 'vi' || resolvedLanguage?.startsWith('vi')
                    ? t('options.appLanguageViVN')
                    : t('options.appLanguageEnUS');

    const isInternalBuild = electronSettings.UPDATE_CHANNEL === 'internal';
    const autoUpdateSupported = Boolean(updateStatus?.autoUpdateSupported);

    return (
        <>
            <Group def={LANGUAGE} bare>
                <Row
                    option={O.language}
                    hint={languagePreference === 'system' ? t('options.appLanguageSystemHint', { language: resolvedLanguageLabel }) : undefined}
                >
                    <Select<AppLanguagePreference>
                        value={languagePreference}
                        options={[
                            { value: 'system', label: t('options.appLanguageSystem') },
                            { value: 'zh-CN', label: t('options.appLanguageZhCN') },
                            { value: 'zh-TW', label: t('options.appLanguageZhTW') },
                            { value: 'en', label: t('options.appLanguageEnUS') },
                            { value: 'in', label: t('options.appLanguageInID') },
                            { value: 'vi', label: t('options.appLanguageViVN') },
                        ]}
                        onChange={preference => void setLanguagePreference(preference)}
                    />
                </Row>
            </Group>

            <Group def={LAUNCH}>
                <Row option={O.autoPlay} hint={t('options.autoPlayOnLaunchDesc')} note={t('options.autoPlayOnLaunchDescSub')}>
                    <Toggle checked={autoPlay} onChange={setAutoPlay} />
                </Row>
                {isElectron && (
                    <Row option={O.openPlayer} note={t('options.openPlayerOnLaunchDesc')}>
                        <Toggle checked={openPlayerOnLaunch} onChange={onToggleOpenPlayerOnLaunch} />
                    </Row>
                )}
                <Row option={O.titlebarButtons} hint={t('options.alwaysShowMainWindowTitlebarDesc')}>
                    <Toggle checked={titlebarButtons} onChange={setTitlebarButtons} />
                </Row>
            </Group>

            {isElectron && (
                <Group
                    def={UPDATE}
                    // The state of the check; pressing it checks again.
                    action={(
                        <Button
                            variant="quiet"
                            icon={RefreshCw}
                            onClick={() => void update.onCheckForUpdates()}
                            disabled={!electronSettings.ENABLE_UPDATE_CHECK || !updateStatus?.updateCheckSupported || updateStatus?.status === 'checking'}
                        >
                            {update.updateBadgeLabel}
                        </Button>
                    )}
                    foot={t(autoUpdateSupported ? 'options.autoUpdateGithubNotice' : 'options.updateCheckGithubNotice')}
                >
                    <FoundUpdateRow />
                    <Row
                        option={O.updateCheck}
                        hint={t(updateStatus?.updateCheckSupportReason === 'channel' ? 'options.updateUnsupportedChannel' : 'options.enableUpdateCheckDesc')}
                        disabled={!updateStatus?.updateCheckSupported}
                    >
                        <Toggle checked={electronSettings.ENABLE_UPDATE_CHECK} onChange={() => void update.onToggleUpdateCheck()} />
                    </Row>
                    <Reveal when={electronSettings.ENABLE_UPDATE_CHECK}>
                        {/* Kept in view where the app cannot update itself: the reason is under the label. */}
                        <Row
                            sub
                            option={O.autoUpdate}
                            hint={t(autoUpdateSupported
                                ? 'options.enableAutoUpdateDesc'
                                : updateStatus?.autoUpdateSupportReason === 'system' ? 'options.updateUnsupportedSystem' : 'options.manualUpdateOnlyDesc')}
                            disabled={!update.canEnableAutoUpdate}
                        >
                            <Toggle checked={electronSettings.ENABLE_AUTO_UPDATE && autoUpdateSupported} onChange={() => void update.onToggleAutoUpdate()} />
                        </Row>
                    </Reveal>
                    <Row option={O.updateChannel} disabled={isInternalBuild}>
                        <Select
                            value={electronSettings.UPDATE_CHANNEL}
                            options={isInternalBuild
                                ? [{ value: 'internal', label: t('options.updateChannelInternal') }]
                                : [
                                    { value: 'realeco', label: t('options.updateChannelRealeco') },
                                    { value: 'limo', label: t('options.updateChannelLimo') },
                                    { value: 'cielo', label: t('options.updateChannelCielo') },
                                ]}
                            onChange={channel => void update.onUpdateChannelChange(channel as 'realeco' | 'limo' | 'cielo')}
                        />
                    </Row>
                </Group>
            )}

            <Group def={PONDER}>
                <Row option={O.ponderHints} hint={t('options.ponderHintsDesc')}>
                    <Segmented
                        value={ponder.ponderHintVisibility}
                        options={[
                            { value: 'always', label: t('options.ponderHintsAlways') },
                            { value: 'unseen', label: t('options.ponderHintsUnseen') },
                            { value: 'off', label: t('options.ponderHintsOff') },
                        ]}
                        onChange={ponder.setPonderHintVisibility}
                    />
                </Row>
                <Row option={O.ponderTouchButton} hint={t('options.ponderTouchButtonDesc')}>
                    <Toggle checked={ponder.showPonderTouchButton} onChange={ponder.setShowPonderTouchButton} />
                </Row>
            </Group>
        </>
    );
};

export default GeneralPage;
