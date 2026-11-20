import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser } from 'lucide-react';
import { providerDisplayName } from '../../../../i18n/providerName';
import { omni } from '../../../../services/onlineMusic/omni';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { formatByteSize } from '../../../../utils/formatByteSize';
import { PlatformMark } from '../../../login/PlatformMark';
import { Button, Group, Row, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { manifestSourceName, type SourceNotice, type SourceRowModel } from './sources/sourcesModel';
import { SourceStateDots } from './sources/SourceStateDots';
import { useSourcesSettings } from './sources/useSourcesSettings';
import type { ModStorageUsageResult } from '../../../../mods/types';

// src/components/modal/settings/pages/SourcesPage.tsx
// The 音源 page (desktop app only, Folium 2.0 plan §5.3): every online source with its state — enabled, used only
// for matching, or disabled — and, for a source mod, "clear data"; then what the loader says about takeovers and
// overrides (plan §5.1), and the way to install a source mod. The platforms the host still registers itself (not
// moved to source mods yet) say what switching them cannot do. Nothing here needs the mod system's master switch.

const LIST: SettingsGroupDef = { id: 'sourceList', titleKey: 'sourcesSettings.groupList', electronOnly: true };
const NOTICES: SettingsGroupDef = { id: 'sourceNotices', titleKey: 'sourcesSettings.groupNotices', electronOnly: true };
const INSTALL: SettingsGroupDef = { id: 'sourceInstall', titleKey: 'sourcesSettings.groupInstall', electronOnly: true };

const O = {
    // The rows of the list are the sources themselves: a search hit lands on the group.
    states: option(LIST, 'sourceStates', 'sourcesSettings.searchStates'),
    clearData: option(LIST, 'sourceClearData', 'sourcesSettings.clearData'),
    install: option(INSTALL, 'sourceInstallMod', 'sourcesSettings.installLabel'),
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

// What it keeps on disk, once it keeps anything.
const usageText = (t: (key: string, options?: Record<string, unknown>) => string, usage: ModStorageUsageResult | undefined): string | null => (
    usage?.ok && ((usage.data ?? 0) + (usage.cache ?? 0)) > 0
        ? t('sourcesSettings.usage', { data: formatByteSize(usage.data ?? 0), cache: formatByteSize(usage.cache ?? 0) })
        : null
);

const SourcesPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { ready, rows, notices, usage, pending, switchTo, clearData, runNoticeAction } = useSourcesSettings();

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
                        row.modId ? usageText(t, usage[row.modId]) : null,
                    ].filter(Boolean).join(' · ');
                    const notes = row.tier === 'host' ? t('sourcesSettings.hostNote') : '';
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

            <Group def={INSTALL}>
                <Row option={O.install} hint={t('sourcesSettings.installHint')}>
                    <Button onClick={() => openSettings('options', 'mods', null, 'modList')}>
                        {t('sourcesSettings.installButton')}
                    </Button>
                </Row>
            </Group>
        </>
    );
};

export default SourcesPage;
