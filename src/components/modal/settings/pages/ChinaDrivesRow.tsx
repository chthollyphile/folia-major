import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Reveal, Row } from '../kit';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/ChinaDrivesRow.tsx
// The two network drives, put up front when GitHub could not be read for the update: the check had
// to go through a public proxy, or failed, or the download from GitHub did. On the 通用 page it is a
// caution with two buttons; on the Help page, under the version, a quiet line that only shows with a
// found update. Where the drives hold no installer for this build (the test channels, Linux), the
// 通用 page says the found version cannot be downloaded for now instead.

type ChinaDrivesRowProps = {
    /** Under the row above it: indented. */
    sub?: boolean;
    /** A line in small grey words with text buttons, no caution dot; not shown for a failed check alone. */
    quiet?: boolean;
};

/** The drives hold the stable channel's Windows and macOS installers only. */
export const offersChinaDrives = (updateStatus: ElectronUpdateStatus | null, channel: string): boolean => (
    channel === 'realeco' && updateStatus?.platform !== 'linux'
);

export const ChinaDrivesRow: React.FC<ChinaDrivesRowProps> = ({ sub, quiet }) => {
    const { t } = useTranslation();
    const update = useSettingsPage().viewProps.desktop.model;
    const { electronSettings, updateStatus } = update;
    const version = updateStatus?.availableVersion ?? null;
    const offersDrives = offersChinaDrives(updateStatus, electronSettings.UPDATE_CHANNEL);
    const shown = Boolean(
        updateStatus?.githubFailed &&
        (offersDrives
            ? version || (!quiet && updateStatus.status === 'error')
            : version && !quiet)
    );

    if (!offersDrives) {
        return (
            <Reveal when={shown}>
                <Row sub={sub} notice={t('options.githubUnreachableRetry', { version: version ?? '' })} />
            </Reveal>
        );
    }

    if (quiet) {
        return (
            <Reveal when={shown}>
                <Row sub={sub} label={<span className="text-xs text-[color:var(--st-t2)]">{t('options.githubUnreachableDrivesQuiet')}</span>}>
                    <Button variant="quiet" onClick={() => void update.onOpenChinaDownload()}>
                        {t('options.quarkDrive')}
                        <ExternalLink size={12} />
                    </Button>
                    <Button variant="quiet" onClick={() => void update.onOpenBaiduDownload()}>
                        {t('options.baiduDrive')}
                        <ExternalLink size={12} />
                    </Button>
                </Row>
            </Reveal>
        );
    }

    return (
        <Reveal when={shown}>
            <Row
                sub={sub}
                notice={version
                    ? t('options.githubUnreachableDrives', { version })
                    : t('options.githubUnreachableCheckFailed')}
            >
                <Button onClick={() => void update.onOpenChinaDownload()}>
                    {t('options.quarkDrive')}
                    <ExternalLink size={12} />
                </Button>
                <Button onClick={() => void update.onOpenBaiduDownload()}>
                    {t('options.baiduDrive')}
                    <ExternalLink size={12} />
                </Button>
            </Row>
        </Reveal>
    );
};

export default ChinaDrivesRow;
