import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, FileArchive } from 'lucide-react';
import { providerDisplayName } from '../../../../i18n/providerName';
import { omni } from '../../../../services/onlineMusic/omni';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { settingsAnchorSubview } from '../../../../utils/settingsAnchorModel';
import { formatByteSize } from '../../../../utils/formatByteSize';
import { PlatformMark } from '../../../login/PlatformMark';
import { Button, Group, Row, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { manifestSourceName, shownSourceUsage, type SourceNotice, type SourceRowModel } from './sources/sourcesModel';
import { SourceStateDots } from './sources/SourceStateDots';
import { useSourcesSettings } from './sources/useSourcesSettings';
import { useSettingsPage } from './settingsPageContext';
import type { ModSourceUsageResult } from '../../../../mods/types';

// src/components/modal/settings/pages/SourcesPage.tsx
// The 音源 page (desktop app only, Folium 2.0 plan §5.3): every online source with its state — enabled, used only
// for matching, or disabled — and, for a source mod, "clear data"; then what the loader says about takeovers and
// overrides (plan §5.1), and the way to install a source mod. The platforms the host still registers itself (not
// moved to source mods yet) say what switching them cannot do. Nothing here needs the mod system's master switch.

const LIST: SettingsGroupDef = { id: 'sourceList', titleKey: 'sourcesSettings.groupList', electronOnly: true };
const NOTICES: SettingsGroupDef = { id: 'sourceNotices', titleKey: 'sourcesSettings.groupNotices', electronOnly: true };
const INSTALL: SettingsGroupDef = { id: 'sourceInstall', titleKey: 'sourcesSettings.groupInstall', electronOnly: true };
// Navidrome: the listener's own server, not a source mod (the maintainer, 2026-11-21: not moved to Folium yet). Said
// here so it is not looked for in the list; it is connected under Settings → Connections.
const OTHER: SettingsGroupDef = { id: 'sourceOther', titleKey: 'sourcesSettings.groupOther', electronOnly: true };

const O = {
    // The rows of the list are the sources themselves: a search hit lands on the group.
    states: option(LIST, 'sourceStates', 'sourcesSettings.searchStates'),
    clearData: option(LIST, 'sourceClearData', 'sourcesSettings.clearData'),
    installZip: option(INSTALL, 'sourceInstallZip', 'sourcesSettings.installZipLabel'),
    install: option(INSTALL, 'sourceInstallMod', 'sourcesSettings.installLabel'),
    navidrome: option(OTHER, 'sourceNavidrome', 'sourcesSettings.navidromeLabel'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const TIER_KEYS: Readonly<Record<SourceRowModel['tier'], string>> = {
    host: 'sourcesSettings.tierHost',
    builtin: 'sourcesSettings.tierBuiltin',
    override: 'sourcesSettings.tierOverride',
    user: 'sourcesSettings.tierUser',
    repo: 'sourcesSettings.tierUser',
    resources: 'sourcesSettings.tierUser',
};

/*
 * What the row says about how it runs, only where the switch beside it does not say it already: running as its state
 * says, or switched off and not loaded, says nothing. A platform the host registers says what its state changes.
 */
const runText = (t: (key: string, options?: Record<string, unknown>) => string, row: SourceRowModel): string | null => {
    if (row.run === 'host') {
        return t(row.state === 'enabled' ? 'sourcesSettings.runHost' : 'sourcesSettings.runHostHidden');
    }
    if (row.run === 'failed') return t('sourcesSettings.runFailed', { error: row.error ?? '' });
    if (row.run === 'running' || row.run === 'off') return null;
    return t(`sourcesSettings.run_${row.run}`);
};

// What it keeps on disk, once it was measured and keeps anything (shownSourceUsage).
const usageText = (t: (key: string, options?: Record<string, unknown>) => string, usage: ModSourceUsageResult | undefined): string | null => {
    const shown = shownSourceUsage(usage);
    return shown ? t('sourcesSettings.usage', { data: formatByteSize(shown.data), cache: formatByteSize(shown.cache) }) : null;
};

const SourcesPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { ready, rows, notices, usage, pending, switchTo, clearData, runNoticeAction, installZip } = useSourcesSettings();
    // The 「打开模组」 button opens the mods window straight away, over this page (closing it comes back here).
    const { onOpenModsWindow } = useSettingsPage();

    // A source mod by its manifest's name whether it is switched on or off (one name in every state, as the start
    // prompt and the command palette give it); a source the host registers by the name the switcher uses.
    const nameOf = (row: SourceRowModel): string => {
        if (row.manifestName) return manifestSourceName(row.manifestName, i18n.language, row.sourceId);
        const naming = omni.getProviderNaming(row.sourceId);
        return naming ? providerDisplayName(t, naming, row.sourceId) : row.sourceId;
    };
    const sourceName = (sourceId: string | null): string => {
        if (!sourceId) return '';
        const row = rows.find(candidate => candidate.sourceId === sourceId);
        if (row) return nameOf(row);
        const naming = omni.getProviderNaming(sourceId);
        return naming ? providerDisplayName(t, naming, sourceId) : sourceId;
    };

    const noticeText = (notice: SourceNotice): string => t(`sourcesSettings.notice_${notice.kind}`, {
        mod: notice.modName,
        source: sourceName(notice.sourceId),
        other: notice.otherModName ?? '',
        version: notice.version ?? '',
    });

    return (
        <>
            <Group def={LIST} foot={t('sourcesSettings.listFoot')}>
                {ready && rows.length === 0 && <Row label={t('sourcesSettings.empty')} />}
                {rows.map((row) => {
                    const name = nameOf(row);
                    const busy = pending.has(row.sourceId);
                    // Only what sets this row apart: a tier other than the built-in one, a run state the switch does
                    // not show, data on disk. What the three states and clearing mean is said once, under the list.
                    const hint = [
                        row.takeover ? t('sourcesSettings.tierTakeover') : row.tier === 'builtin' ? null : t(TIER_KEYS[row.tier]),
                        runText(t, row),
                        row.modId ? usageText(t, usage[row.sourceId]) : null,
                    ].filter(Boolean).join(' · ');
                    const notes = [
                        row.tier === 'host' ? t('sourcesSettings.hostNote') : null,
                        // The manifest's own words on switching it on (a source that runs code the listener brings).
                        row.tier !== 'host' && row.enableNotice ? manifestSourceName(row.enableNotice, i18n.language, '') : null,
                        // A built-in copy never shows the enable confirmation that says this; the row says it instead.
                        row.selfSignedUserServers ? t('sourcesSettings.selfSignedNote') : null,
                    ].filter(Boolean).join(' ');
                    return (
                        <Row
                            key={row.sourceId}
                            label={(
                                <span className="inline-flex min-w-0 items-center gap-2" data-source-row={row.sourceId}>
                                    <PlatformMark providerId={row.sourceId} label={name} size={18} />
                                    <span className="truncate">{name}</span>
                                </span>
                            )}
                            hint={hint || undefined}
                            note={notes || undefined}
                        >
                            {row.clearable && (
                                <Button
                                    variant="quiet"
                                    icon={Eraser}
                                    tip={t('sourcesSettings.clearDataTip', { name })}
                                    disabled={busy}
                                    onClick={() => void clearData(row.sourceId, name, row.modId)}
                                />
                            )}
                            <SourceStateDots
                                value={row.state}
                                canMatchOnly={row.threeStates}
                                matchOnlyKnown={row.matchOnlyKnown}
                                disabled={busy}
                                onChange={state => void switchTo(row.sourceId, name, state)}
                            />
                        </Row>
                    );
                })}
            </Group>

            {notices.length > 0 && (
                <Group def={NOTICES}>
                    {notices.map((notice, index) => {
                        const action = notice.action;
                        return (
                            <Row key={`${notice.kind}:${notice.modId}:${notice.sourceId ?? index}`} notice={noticeText(notice)}>
                                {action && (
                                    <Button
                                        disabled={pending.has(`notice:${action.modId}`)}
                                        onClick={() => void runNoticeAction(action, notice.modName)}
                                    >
                                        {t(action.kind === 'assign-claim' ? 'sourcesSettings.actionAssignClaim' : 'sourcesSettings.actionConfirmOverride')}
                                    </Button>
                                )}
                            </Row>
                        );
                    })}
                </Group>
            )}

            {/* Drawn once the list is in: a landing on these groups (the login window's 「安装音源模组」) waits for them to
                register, so they must not register above a list that is still empty and about to push them down. */}
            {ready && (<>
                <Group def={INSTALL}>
                    <Row option={O.installZip} hint={t('sourcesSettings.installZipHint')}>
                        <Button icon={FileArchive} disabled={pending.has('install-zip')} onClick={() => void installZip()}>
                            {t('sourcesSettings.installZipButton')}
                        </Button>
                    </Row>
                    <Row option={O.install} hint={t('sourcesSettings.installHint')}>
                        <Button onClick={onOpenModsWindow}>
                            {t('sourcesSettings.installButton')}
                        </Button>
                    </Row>
                </Group>

                <Group def={OTHER}>
                    <Row option={O.navidrome} hint={t('sourcesSettings.navidromeHint')}>
                        <Button onClick={() => openSettings('options', settingsAnchorSubview('navidrome'), null, 'navidrome')}>
                            {t('sourcesSettings.navidromeButton')}
                        </Button>
                    </Row>
                </Group>
            </>)}
        </>
    );
};

export default SourcesPage;
