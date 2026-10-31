import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePlaybackReportReady } from '../../../../services/onlineMusic/playbackReportGate';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { useStageSettingsStore } from '../../../../stores/useStageSettingsStore';
import { Button, CopyValue, Group, Reveal, Row, Status, Toggle, Value, type SettingsOptionDef } from '../kit';
import NavidromeRows from './integration/NavidromeRows';
import { O, SERVICES, STREAMING } from './integration/options';
import { DesktopStageRows, WebStageRows } from './integration/StageModeRows';
import SyncServerRows from './integration/SyncServerRows';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/IntegrationPage.tsx
// The 连接与集成 page: what Folia connects to and what it shows to other programs. Services first
// (Navidrome, the sync server, Discord, the NetEase listening report), then streaming and stage
// (the transparent player background, the OBS browser source, the lyric interface, stage mode).
// Discord, OBS and the lyric interface exist in the desktop app only. The rows of Navidrome, the
// sync server and stage mode are in pages/integration.

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const OBS_GUIDE_STEPS = [1, 2, 3, 4, 5, 6];

const IntegrationPage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, viewProps, onToggleTransparentPlayerBackground } = useSettingsPage();
    const { discord, lyricApi, stage } = viewProps.integration;
    const obs = stage.obsBrowserSourceStatus;
    const lyricApiStatus = lyricApi.status;
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);
    const obsKeepAnimation = useStageSettingsStore(state => state.obsKeepMainWindowAnimation);
    const setObsKeepAnimation = useStageSettingsStore(state => state.handleToggleObsKeepMainWindowAnimation);
    const scrobbleEnabled = useAudioSettingsStore(state => state.neteaseScrobbleEnabled);
    const setScrobbleEnabled = useAudioSettingsStore(state => state.handleToggleNeteaseScrobble);
    // Subscribed to, so the row follows the reporting account signing in or out while the page is open.
    const canScrobble = usePlaybackReportReady();

    return (
        <>
            <Group def={SERVICES}>
                <NavidromeRows />
                <SyncServerRows />
                {isElectron && (
                    <>
                        <Row option={O.discord} hint={t('options.discordRichPresenceDesc')}>
                            {discord.enabled && (
                                <Status tone={!discord.status?.enabled ? undefined : discord.status.connected ? 'ok' : 'warn'}>
                                    {t(!discord.status?.enabled
                                        ? 'options.discordPresenceDisabled'
                                        : discord.status.connected ? 'options.discordPresenceConnected' : 'options.discordPresenceDisconnected')}
                                </Status>
                            )}
                            <Toggle checked={discord.enabled} onChange={enabled => void discord.onToggle(enabled)} />
                        </Row>
                        <Reveal when={Boolean(discord.status?.error)}>
                            <Row sub label={<Status tone="error">{discord.status?.error}</Status>} />
                        </Reveal>
                    </>
                )}
                <Row
                    option={O.scrobble}
                    hint={t(canScrobble ? 'options.neteaseScrobbleDesc' : 'options.neteaseScrobbleSignInHint')}
                    disabled={!canScrobble}
                >
                    <Toggle checked={scrobbleEnabled} onChange={setScrobbleEnabled} />
                </Row>
            </Group>

            <Group def={STREAMING}>
                {/* <Row option={O.transparentBackground} hint={t('options.transparentPlayerBackgroundDesc')}>
                    <Toggle checked={transparentPlayerBackground} onChange={onToggleTransparentPlayerBackground} />
                </Row> */}
                {isElectron && obs && (
                    <>
                        <Row option={O.obs} hint={t('options.obsBrowserSourceDesc')}>
                            <Toggle checked={obs.enabled} onChange={enabled => void stage.onToggleObsBrowserSource?.(enabled)} />
                        </Row>
                        <Reveal when={obs.enabled}>
                            <Row sub label={t('options.obsBrowserSourceAddress')}>
                                {obs.url ? <CopyValue value={obs.url} /> : <Value>http://127.0.0.1</Value>}
                                <Button onClick={() => void stage.onRegenerateObsBrowserSourceToken?.()}>
                                    {t('options.regenerateObsBrowserSourceToken')}
                                </Button>
                            </Row>
                            <Row sub label={t('options.obsBrowserSourceClients')}>
                                <Status tone={obs.clientCount > 0 ? 'ok' : undefined}>{obs.clientCount}</Status>
                            </Row>
                            <Row sub option={O.obsKeepAnimation} hint={t('options.obsKeepMainWindowAnimationDesc')}>
                                <Toggle checked={obsKeepAnimation} onChange={setObsKeepAnimation} />
                            </Row>
                            <Row
                                sub
                                label={t('options.obsBrowserSourceGuideTitle')}
                                note={(
                                    <ol className="list-decimal space-y-0.5 pl-[18px]">
                                        {OBS_GUIDE_STEPS.map(step => <li key={step}>{t(`options.obsBrowserSourceGuideStep${step}`)}</li>)}
                                    </ol>
                                )}
                            />
                        </Reveal>
                    </>
                )}
                {isElectron && lyricApiStatus && (
                    <>
                        <Row option={O.lyricApi} hint={t('options.lyricApiDesc')}>
                            {lyricApiStatus.enabled && (
                                <Status tone={lyricApiStatus.running ? 'ok' : 'error'}>
                                    {t(lyricApiStatus.running ? 'options.lyricApiRunning' : 'options.lyricApiUnavailable')}
                                </Status>
                            )}
                            <Toggle checked={lyricApiStatus.enabled} onChange={enabled => void lyricApi.onToggle?.(enabled)} />
                        </Row>
                        <Reveal when={lyricApiStatus.enabled}>
                            <Row sub label={t('options.lyricApiAddress')}>
                                {lyricApiStatus.url
                                    ? <CopyValue value={lyricApiStatus.url} />
                                    : <Value>{`http://127.0.0.1:${lyricApiStatus.port}/v1/lyric`}</Value>}
                            </Row>
                        </Reveal>
                        <Reveal when={lyricApiStatus.enabled && Boolean(lyricApiStatus.error)}>
                            <Row sub label={<Status tone="error">{lyricApiStatus.error}</Status>} />
                        </Reveal>
                    </>
                )}
                {isElectron ? <DesktopStageRows /> : <WebStageRows />}
            </Group>
        </>
    );
};

export default IntegrationPage;
