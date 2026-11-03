import React from 'react';
import { useTranslation } from 'react-i18next';
import { ModManager } from '../../../../mods/manager/ModManager';
import type { ModManagerClasses } from '../../../../mods/manager/modManagerClasses';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import { Group, Row, Status, Toggle, option, useSettingsKitTheme, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { SettingsAnchor } from '../navigation/SettingsAnchorContext';

// src/components/modal/settings/pages/ModsPage.tsx
// The 模组 page (desktop app only): the mod system's master switch, and under it the mod manager.
// The manager is the one component the command palette's mods surface also shows
// (src/mods/manager); here it wears the settings window's colours.

const SYSTEM: SettingsGroupDef = { id: 'modSystem', titleKey: 'options.enableModSystem', electronOnly: true };
const MANAGER: SettingsGroupDef = { id: 'modList', titleKey: 'mods.title', electronOnly: true };

const O = {
    enabled: option(SYSTEM, 'enableModSystem', 'options.enableModSystem'),
    // Drawn by the manager, not as a row: a search hit lands on the group.
    market: option(MANAGER, 'modMarket', 'mods.market'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

/** What the mod manager dresses itself in inside the settings window: the kit's surfaces, lines and tones. */
const MANAGER_CLASSES: ModManagerClasses = {
    card: 'border-transparent bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]',
    divider: 'border-[color:var(--st-line)]',
    toggleOff: 'bg-[var(--st-track)]',
    ghostButton: 'border-transparent bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]',
    activeButton: 'border-transparent bg-[var(--st-track)]',
    rowHover: 'hover:bg-[var(--st-fill)]',
    expandedRow: 'bg-[var(--st-fill)]',
    chip: 'bg-[var(--st-fill)]',
    muted: 'text-[color:var(--st-t3)]',
    warning: 'border-[color:var(--st-warn)]/25 bg-[var(--st-warn)]/10 text-[color:var(--st-t1)]',
    danger: 'border-[color:var(--st-err)]/25 bg-[var(--st-err)]/10 text-[color:var(--st-t1)]',
    preview: 'border-violet-400/25 bg-violet-500/10 text-[color:var(--st-t1)]',
    success: 'border-[color:var(--st-ok)]/25 bg-[var(--st-ok)]/10 text-[color:var(--st-t1)]',
    experimentalBadge: 'border-[color:var(--st-warn)]/25 bg-[var(--st-warn)]/10 text-[color:var(--st-t1)]',
};

const ModsPage: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight, theme } = useSettingsKitTheme();
    const enabled = useDesktopSettingsStore(state => state.modSystemEnabled);
    const setEnabled = useDesktopSettingsStore(state => state.handleToggleModSystem);
    const managerTitle = t(MANAGER.titleKey);

    return (
        <>
            <Group def={SYSTEM} bare>
                <Row option={O.enabled} hint={t('options.enableModSystemDesc')} note={t('options.enableModSystemDescSub')}>
                    <Status tone="warn">{t('mods.experimental')}</Status>
                    <Toggle checked={enabled} onChange={setEnabled} />
                </Row>
            </Group>

            {/* The manager draws cards of its own, so this group is a heading over them, not a kit card. */}
            <SettingsAnchor anchorId={MANAGER.id} label={managerTitle} className="mt-7">
                <h3 className="mb-2 flex min-h-6 items-center px-1 text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">{managerTitle}</h3>
                <ModManager classes={MANAGER_CLASSES} isDaylight={isDaylight} theme={theme ?? null} />
            </SettingsAnchor>
        </>
    );
};

export default ModsPage;
