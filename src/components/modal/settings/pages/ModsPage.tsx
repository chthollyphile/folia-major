import React from 'react';
import { useTranslation } from 'react-i18next';
import { useModMarketStore } from '../../../../mods/market/useModMarketStore';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { Group, Row, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/ModsPage.tsx
// The 模组 page (desktop app only): the mod system's master switch, the community mods switch (Folium 2.0, the
// main process's: turning it on asks in a native dialog), and a row that opens the mods window: installed mods
// and the mod market in one, after VS Code's extensions view (src/mods/market/ModsWindow.tsx). The window has
// the room the page does not; the command palette's mods surface shows the same view.

const SYSTEM: SettingsGroupDef = { id: 'modSystem', titleKey: 'options.enableModSystem', electronOnly: true };
const MANAGER: SettingsGroupDef = { id: 'modList', titleKey: 'mods.title', electronOnly: true };

const O = {
    enabled: option(SYSTEM, 'enableModSystem', 'options.enableModSystem'),
    community: option(SYSTEM, 'enableCommunityMods', 'options.enableCommunityMods'),
    market: option(MANAGER, 'modMarket', 'mods.market'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const ModsPage: React.FC = () => {
    const { t } = useTranslation();
    const { onOpenModsWindow } = useSettingsPage();
    const enabled = useDesktopSettingsStore(state => state.modSystemEnabled);
    const setEnabled = useDesktopSettingsStore(state => state.handleToggleModSystem);
    const communityEnabled = useDesktopSettingsStore(state => state.modCommunityEnabled);
    const setCommunityEnabled = useDesktopSettingsStore(state => state.handleToggleCommunityMods);
    // From the background update check (mainWindowStart); 0 until it has read the market.
    const updateCount = useModMarketStore(state => state.updateCount);

    return (
        <>
            <Group def={SYSTEM} bare>
                <Row option={O.enabled} hint={t('options.enableModSystemDesc')} note={t('options.enableModSystemDescSub')}>
                    <Toggle checked={enabled} onChange={setEnabled} />
                </Row>
                <Row option={O.community} hint={t('options.enableCommunityModsDesc')}>
                    <Toggle checked={communityEnabled} disabled={!enabled} onChange={(next) => { void setCommunityEnabled(next); }} />
                </Row>
            </Group>

            <Group def={MANAGER}>
                <Row
                    option={O.market}
                    hint={t('mods.marketRowDesc')}
                    note={t('mods.warning')}
                    tag={updateCount > 0 ? t('mods.updatesTag', { count: updateCount }) : undefined}
                    disabled={!enabled}
                    onClick={onOpenModsWindow}
                />
            </Group>
        </>
    );
};

export default ModsPage;
