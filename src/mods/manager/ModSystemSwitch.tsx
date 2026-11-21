import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '@/types';
import SettingsRow, { SettingsToggle } from '../../components/modal/settings/SettingsRow';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import type { ModManagerClasses } from './modManagerClasses';

// src/mods/manager/ModSystemSwitch.tsx
// The mod system's master switch and, under it, the community mods switch (Folium 2.0), as one card. Rendered on
// the palette surface, so the list below it always sits under the switches that govern it. Both values are the
// main process's: turning community mods on asks there, in a native dialog.

type ModSystemSwitchProps = {
    classes: ModManagerClasses;
    theme: Theme | null;
};

export const ModSystemSwitch: React.FC<ModSystemSwitchProps> = ({ classes, theme }) => {
    const { t } = useTranslation();
    const { modSystemEnabled, onToggleModSystem, communityEnabled, onToggleCommunity } = useDesktopSettingsStore(useShallow(state => ({
        modSystemEnabled: state.modSystemEnabled,
        onToggleModSystem: state.handleToggleModSystem,
        communityEnabled: state.modCommunityEnabled,
        onToggleCommunity: state.handleToggleCommunityMods,
    })));

    return (
        <div className={`rounded-xl border overflow-hidden ${classes.card}`}>
            <SettingsRow
                title={t('options.enableModSystem')}
                description={t('options.enableModSystemDesc')}
                note={t('options.enableModSystemDescSub')}
                control={(
                    <SettingsToggle
                        checked={modSystemEnabled}
                        onChange={() => onToggleModSystem(!modSystemEnabled)}
                        offClass={classes.toggleOff}
                        onColor={theme?.secondaryColor}
                        ariaLabel={t('options.enableModSystem')}
                    />
                )}
                dividerClass={classes.divider}
            />
            <SettingsRow
                title={t('options.enableCommunityMods')}
                description={t('options.enableCommunityModsDesc')}
                control={(
                    <SettingsToggle
                        checked={communityEnabled}
                        disabled={!modSystemEnabled}
                        onChange={() => { void onToggleCommunity(!communityEnabled); }}
                        offClass={classes.toggleOff}
                        onColor={theme?.secondaryColor}
                        ariaLabel={t('options.enableCommunityMods')}
                    />
                )}
                dividerClass={classes.divider}
                isLast
            />
        </div>
    );
};

export default ModSystemSwitch;
