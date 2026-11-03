import React, { useId, useRef, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Menu, Progress, Reveal, Row } from '../kit';
import { openOutsideLink } from '../../../../utils/system/outsideLink';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/FoundUpdateRow.tsx
// The row a found update gets, on the 通用 page and on the Help page: the new version, the list of
// places to download it from (pages outside the app, with notes under the list), and what the app
// itself can do with it: download it, show how far the download has come, restart to install. It
// unfolds once the update check has found a version.

const AUR_PACKAGE_URL = 'https://aur.archlinux.org/packages/folia-major-bin';

type FoundUpdateRowProps = {
    /** Under the row above it: indented. */
    sub?: boolean;
};

export const FoundUpdateRow: React.FC<FoundUpdateRowProps> = ({ sub }) => {
    const { t } = useTranslation();
    const sourcesRef = useRef<HTMLButtonElement>(null);
    const sourcesId = useId();
    // The version the list of sources was opened for: an open list goes with its update.
    const [openFor, setOpenFor] = useState<string | null>(null);
    const update = useSettingsPage().viewProps.desktop.model;
    const { electronSettings, updateStatus } = update;
    const version = updateStatus?.availableVersion;
    // The update went away or became another one: the list does not come back open with it.
    if (openFor !== null && openFor !== version) {
        setOpenFor(null);
    }
    const sourcesOpen = Boolean(version) && openFor === version;
    const autoUpdateSupported = Boolean(updateStatus?.autoUpdateSupported);
    const isDownloading = updateStatus?.status === 'downloading';
    const isDownloaded = updateStatus?.status === 'downloaded';
    const isLinuxBuild = updateStatus?.platform === 'linux';
    const isStableChannel = electronSettings.UPDATE_CHANNEL === 'realeco';
    // The two drives are offered for the stable channel, and not on Linux.
    const offersDrives = isStableChannel && !isLinuxBuild;
    // What a found version needs from the listener where the app cannot update itself.
    const manualNotice = updateStatus?.platform === 'darwin'
        ? t('options.macManualUpdateNotice')
        : isLinuxBuild
            ? t('options.linuxManualUpdateNotice')
            : autoUpdateSupported ? null : t('options.manualUpdateNotice');

    const sources = [
        ...(offersDrives ? [
            { id: 'quark', label: t('options.quarkDrive'), onSelect: () => void update.onOpenChinaDownload() },
            { id: 'baidu', label: t('options.baiduDrive'), onSelect: () => void update.onOpenBaiduDownload() },
        ] : []),
        {
            id: 'github',
            label: t(autoUpdateSupported ? 'options.githubRelease' : 'options.fullInstallerGithub'),
            onSelect: () => void window.electron?.openUpdateReleasePage(version),
        },
        ...(isLinuxBuild && isStableChannel ? [
            { id: 'aur', label: t('options.aurPackage'), onSelect: () => openOutsideLink(AUR_PACKAGE_URL) },
        ] : []),
    ].map(source => ({ ...source, end: <ExternalLink size={14} /> }));
    const notes = [
        ...(manualNotice ? [manualNotice] : []),
        ...(offersDrives ? [t('options.chinaDownloadHint')] : []),
    ];
    // The updater gives no usable percent while it does not know the size.
    const reported = updateStatus?.downloadProgress?.percent;
    const percent = typeof reported === 'number' && Number.isFinite(reported) ? reported : 0;

    return (
        <Reveal when={Boolean(version)}>
            <Row sub={sub} notice={t('options.newVersionFound', { version: version ?? '' })}>
                <button
                    ref={sourcesRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={sourcesOpen}
                    aria-controls={sourcesOpen ? sourcesId : undefined}
                    onClick={() => setOpenFor(sourcesOpen ? null : version ?? null)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' && !sourcesOpen) {
                            event.preventDefault();
                            setOpenFor(version ?? null);
                        }
                    }}
                    className={`st-t-fast inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg pl-3 pr-2 text-[13px] text-[color:var(--st-t1)] transition-colors ${sourcesOpen ? 'bg-[var(--st-fill2)]' : 'bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]'}`}
                >
                    {t('options.downloadSources')}
                    <ChevronDown size={14} className={`st-t-move text-[color:var(--st-t2)] transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} />
                </button>
                <Menu
                    anchorRef={sourcesRef}
                    open={sourcesOpen}
                    onClose={() => setOpenFor(null)}
                    id={sourcesId}
                    label={t('options.downloadSources')}
                    align="end"
                    items={sources}
                    notes={notes}
                />
                {autoUpdateSupported && isDownloading && (
                    <Progress value={percent / 100}>
                        {t('options.downloadingProgress', { percent: Math.round(percent) })}
                    </Progress>
                )}
                {autoUpdateSupported && !electronSettings.ENABLE_AUTO_UPDATE && !isDownloading && !isDownloaded && (
                    <Button variant="primary" onClick={() => void update.onDownloadUpdate()} disabled={!update.canDownloadUpdate}>
                        {t('options.downloadUpdate')}
                    </Button>
                )}
                {autoUpdateSupported && isDownloaded && (
                    <Button variant="primary" onClick={() => void update.onInstallUpdate()}>{t('options.restartToInstallUpdate')}</Button>
                )}
            </Row>
        </Reveal>
    );
};

export default FoundUpdateRow;
