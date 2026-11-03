import React, { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ConfirmDialog from '../../../../shared/ConfirmDialog';
import { hifiEngine, useHifiEngineStore } from '../../../../../services/hifi/hifiEngine';
import { useHifiSettingsStore } from '../../../../../stores/useHifiSettingsStore';
import type { HifiErrorCode, HifiInstallProgress } from '../../../../../types/hifi';
import { openOutsideLink } from '../../../../../utils/system/outsideLink';
import { Button, CopyValue, Group, Progress, Reveal, Row, Segmented, Status, Toggle, Value, useSettingsKitTheme } from '../../kit';
import { ENGINE, HIFI_PLATFORM, O } from './options';
import { canOfferRuntimeDownload, isRuntimeInstalling, runtimeLine } from './runtimeState';

// src/components/modal/settings/pages/hifi/HifiEngineGroup.tsx
// The playback engine group at the top of the 播放控制 page: Web Audio or mpv for local and
// Navidrome songs (the first switch to mpv asks to accept that the output is at full volume), and
// what mpv turns off. With mpv chosen: which mpv is in use, the download of the recommended mpv with
// its progress, the cloud-drive copies for when GitHub and its mirror are slow, an mpv file of one's
// own, on Linux the package-manager lines in place of a download, and whether Navidrome songs use
// mpv too. The settings are pushed to the main process by the playback bridge, not from here.

const IS_LINUX = HIFI_PLATFORM === 'linux';

/** No mpv is downloaded on Linux; the distributions package one. Commands are not translated. */
const LINUX_INSTALL_COMMANDS = [
    { distro: 'Arch Linux', command: 'sudo pacman -S mpv' },
    { distro: 'Debian / Ubuntu', command: 'sudo apt install mpv' },
    { distro: 'Fedora', command: 'sudo dnf install mpv' },
] as const;

/**
 * Shares of their own, apart from the installers' (SettingsModal.tsx): the official mpv zips the
 * manifest lists, unchanged, in the folder 原生音频组件. Downloaded by hand, then picked as an mpv
 * file of one's own. The Baidu link carries its extraction code.
 */
const MPV_DRIVE_LINKS = [
    { id: 'quark', labelKey: 'options.quarkDrive', url: 'https://pan.quark.cn/s/c6c57fff6d32' },
    { id: 'baidu', labelKey: 'options.baiduDrive', url: 'https://pan.baidu.com/s/1VyUD0pgXam3fgd0Xqug9yg?pwd=9zcw' },
] as const;

const MIB = 1024 * 1024;

/** How far the download has come, as the bar's fill and the words beside it. */
const installReading = (progress: HifiInstallProgress | null, t: TFunction): { value: number; text: string } => {
    if (progress?.phase === 'verifying') {
        return { value: 1, text: t('hifi.settings.installVerifying') };
    }
    if (progress?.phase === 'extracting') {
        return { value: 1, text: t('hifi.settings.installExtracting') };
    }
    if (progress?.phase === 'downloading' && progress.totalBytes > 0) {
        return {
            value: progress.receivedBytes / progress.totalBytes,
            text: t('hifi.settings.installBytes', {
                received: (progress.receivedBytes / MIB).toFixed(1),
                total: (progress.totalBytes / MIB).toFixed(1),
            }),
        };
    }
    return { value: 0, text: t('hifi.settings.installStarting') };
};

export const HifiEngineGroup: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const settings = useHifiSettingsStore(useShallow(state => ({
        enabled: state.enabled,
        setEnabled: state.setEnabled,
        navidrome: state.navidrome,
        setNavidrome: state.setNavidrome,
        mpvPath: state.mpvPath,
        setMpvPath: state.setMpvPath,
        volumeConfirmed: state.volumeConfirmed,
        setVolumeConfirmed: state.setVolumeConfirmed,
    })));
    const engine = useHifiEngineStore(useShallow(state => ({
        supported: state.supported,
        runtime: state.runtime,
        installProgress: state.installProgress,
    })));
    const [asking, setAsking] = useState(false);
    const [detecting, setDetecting] = useState(false);
    const [installPending, setInstallPending] = useState(false);
    const [installError, setInstallError] = useState<HifiErrorCode | null>(null);

    // The download's progress comes through the engine's subscriptions; attach is idempotent, and
    // the playback bridge has normally made it already.
    useEffect(() => {
        hifiEngine.attach();
        void hifiEngine.refreshRuntime();
    }, []);

    const { runtime, installProgress } = engine;
    const download = runtime?.download ?? null;
    // The palette's download and detect commands ask the same two questions (runtimeState.ts).
    const installing = installPending || isRuntimeInstalling(runtime, installProgress);
    const offerDownload = !installPending && canOfferRuntimeDownload(runtime, installProgress, HIFI_PLATFORM);
    const line = runtimeLine(runtime, (key, values) => t(key, values));
    const reading = installReading(installProgress, t);
    // A download started from the palette fails where this page did not start it: its last progress says why.
    const shownInstallError = installing
        ? null
        : installError ?? (installProgress?.phase === 'error' ? installProgress.errorCode ?? 'INSTALL_FAILED' : null);

    const runtimeHint = !runtime || runtime.available
        ? undefined
        : IS_LINUX
                ? t('hifi.settings.linuxInstallHint')
                : download?.supported
                    ? t('hifi.settings.runtimeMissingDownloadHint')
                    : t('hifi.settings.runtimeMissingHint');
    // Offered while the download is wanted: no mpv yet, one is downloading, or it just failed.
    const offerDrive = !IS_LINUX && Boolean(download?.supported)
        && (runtime?.available === false || installing || shownInstallError !== null);

    const redetect = async () => {
        setDetecting(true);
        await hifiEngine.detect();
        setDetecting(false);
    };

    // Only the setting changes here: the playback bridge pushes it to the main process, and the
    // engine asks for the runtime again once the main process has the new path.
    const pickPath = async () => {
        const picked = await hifiEngine.pickRuntimePath();
        if (picked) {
            settings.setMpvPath(picked);
        }
    };

    const install = async () => {
        setInstallError(null);
        setInstallPending(true);
        const result = await hifiEngine.install();
        setInstallPending(false);
        const code = result ? (result.ok ? null : result.errorCode ?? 'INSTALL_FAILED') : 'INSTALL_FAILED';
        // A cancel is the listener's own doing; it needs no message.
        if (code && code !== 'INSTALL_CANCELLED') {
            setInstallError(code);
        }
    };

    const chooseEngine = (engineChoice: 'web' | 'mpv') => {
        const next = engineChoice === 'mpv';
        if (next && !settings.volumeConfirmed) {
            setAsking(true);
            return;
        }
        settings.setEnabled(next);
    };

    return (
        <>
            <Group def={ENGINE}>
                <Row option={O.engine} hint={t(engine.supported ? 'hifi.settings.engineDesc' : 'hifi.settings.unsupported')} disabled={!engine.supported}>
                    <Segmented
                        value={settings.enabled ? 'mpv' : 'web'}
                        options={[
                            { value: 'web', label: t('hifi.settings.engineWeb') },
                            { value: 'mpv', label: t('hifi.settings.engineMpv') },
                        ]}
                        onChange={chooseEngine}
                    />
                </Row>
                {engine.supported && (
                    <Reveal when={settings.enabled}>
                        <Row sub notice={t('hifi.settings.engineMpvNotice')} />
                        <Row sub option={O.runtime} hint={runtimeHint}>
                            <Status tone={line.tone}>{line.text}</Status>
                            {installing ? (
                                <>
                                    <Progress value={reading.value}>{reading.text}</Progress>
                                    <Button variant="quiet" onClick={() => void hifiEngine.cancelInstall()}>
                                        {t('hifi.settings.cancelInstall')}
                                    </Button>
                                </>
                            ) : offerDownload && (
                                <Button variant={runtime?.available ? undefined : 'primary'} icon={Download} onClick={() => void install()}>
                                    {t(download?.installedVersion ? 'hifi.settings.update' : 'hifi.settings.download', { version: download?.version ?? '' })}
                                </Button>
                            )}
                            <Button icon={RefreshCw} tip={t('hifi.settings.redetect')} onClick={() => void redetect()} disabled={detecting || installing} />
                        </Row>
                        <Reveal when={Boolean(runtime?.manualPathRejected)}>
                            <Row sub label={<Status tone="warn">{t('hifi.settings.manualPathRejected')}</Status>} />
                        </Reveal>
                        <Reveal when={shownInstallError !== null}>
                            <Row sub label={<Status tone="error">{shownInstallError ? t(`hifi.errors.${shownInstallError}`) : ''}</Status>} />
                        </Reveal>
                        <Reveal when={offerDrive}>
                            <Row
                                sub
                                label={t('hifi.settings.driveDownload')}
                                hint={t(HIFI_PLATFORM === 'darwin' ? 'hifi.settings.driveDownloadHintMac' : 'hifi.settings.driveDownloadHint', { version: download?.version ?? '' })}
                            >
                                {MPV_DRIVE_LINKS.map(link => (
                                    <Button key={link.id} variant="quiet" onClick={() => void openOutsideLink(link.url)}>{t(link.labelKey)}</Button>
                                ))}
                            </Row>
                        </Reveal>
                        <Reveal when={IS_LINUX && runtime !== null && !runtime.available}>
                            {LINUX_INSTALL_COMMANDS.map(({ distro, command }) => (
                                <Row key={distro} sub label={distro}>
                                    <CopyValue value={command} />
                                </Row>
                            ))}
                        </Reveal>
                        <Row sub option={O.mpvPath}>
                            {settings.mpvPath ? <CopyValue value={settings.mpvPath} /> : <Value>{t('hifi.settings.mpvPathAuto')}</Value>}
                            {settings.mpvPath && (
                                <Button variant="quiet" onClick={() => settings.setMpvPath(null)}>{t('hifi.settings.clearPath')}</Button>
                            )}
                            <Button onClick={() => void pickPath()}>{t('hifi.settings.pickPath')}</Button>
                        </Row>
                        <Row sub option={O.navidrome} hint={t('hifi.settings.navidromeDesc')}>
                            <Toggle checked={settings.navidrome} onChange={settings.setNavidrome} />
                        </Row>
                    </Reveal>
                )}
            </Group>

            <ConfirmDialog
                isOpen={asking}
                isDaylight={isDaylight}
                title={t('hifi.settings.confirmTitle')}
                description={t('hifi.settings.confirmDesc')}
                confirmText={t('hifi.settings.confirmAction')}
                onConfirm={() => {
                    settings.setVolumeConfirmed(true);
                    settings.setEnabled(true);
                    setAsking(false);
                }}
                onClose={() => setAsking(false)}
            />
        </>
    );
};

export default HifiEngineGroup;
