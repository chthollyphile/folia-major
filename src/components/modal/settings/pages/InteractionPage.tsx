import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isGridLibraryActive, useIsGridLibraryActive } from '../../../../library/app/gridLibraryActive';
import { COMMAND_PALETTE_COMMANDS } from '../../../command-palette/commandRegistry';
import { getCommandTitle } from '../../../command-palette/commandText';
import { CUSTOM_SHORTCUT_LETTERS, isCustomShortcutLetterAvailable, isScopeIndependentCommand } from '../../../command-palette/customShortcut';
import { useInteractionSettingsStore } from '../../../../stores/useInteractionSettingsStore';
import { useSettingsModalStore } from '../../../../stores/useSettingsModalStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../../utils/platform';
import { Group, KeyCapture, Row, Segmented, Select, Toggle, Value, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { GLOBAL_SHORTCUTS_OPTIONS, GlobalShortcutsGroup } from './GlobalShortcutsGroup';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/InteractionPage.tsx
// The 快捷操作 page: how a person reaches a command quickly. First the command palette: the three
// commands pinned under it and the one shortcut a person defines themselves. Then, in the desktop
// app, the system-wide playback shortcuts (GlobalShortcutsGroup). Then the grids: where a slide on
// their action button leads (only the grid library UI has that button, so the row is drawn only
// while it is in effect), and whether a bare S there filters or opens the palette.

const PALETTE: SettingsGroupDef = { id: 'pinnedCommands', titleKey: 'options.settingsHeadingCommandPalette' };
const GRIDS: SettingsGroupDef = { id: 'gridActionButton', titleKey: 'options.settingsHeadingGrids' };

const O = {
    pinned: option(PALETTE, 'pinnedCommandSlots', 'options.pinnedCommands'),
    shortcut: option(PALETTE, 'customShortcut', 'options.customShortcut'),
    slideTarget: option(GRIDS, 'gridSlideTarget', 'options.gridSlideTarget', { available: isGridLibraryActive }),
    paletteHotkey: option(GRIDS, 'gridPaletteHotkey', 'options.gridPaletteHotkey'),
};

export const OPTIONS: SettingsOptionDef[] = [...Object.values(O), ...GLOBAL_SHORTCUTS_OPTIONS];

const InteractionPage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron } = useSettingsPage();
    const isGridActive = useIsGridLibraryActive();
    const { pinnedCommandIds, setPinnedCommandId } = useSettingsModalStore(useShallow(state => ({
        pinnedCommandIds: state.pinnedCommandIds,
        setPinnedCommandId: state.setPinnedCommandId,
    })));
    const interaction = useInteractionSettingsStore(useShallow(state => ({
        slideTarget: state.gridActionButtonSlideTarget,
        paletteHotkey: state.gridCommandPaletteHotkey,
        shortcutLetter: state.customShortcutLetter,
        shortcutCommandId: state.customShortcutCommandId,
        setSlideTarget: state.setGridActionButtonSlideTarget,
        setPaletteHotkey: state.handleToggleGridCommandPaletteHotkey,
        setShortcutLetter: state.setCustomShortcutLetter,
        setShortcutCommandId: state.setCustomShortcutCommandId,
    })));

    // The titles of the whole registry, resolved once per language: every pick list here reads them.
    const commands = useMemo(() => COMMAND_PALETTE_COMMANDS.map(command => ({
        value: command.id,
        label: getCommandTitle(command, t),
        // A shortcut fires from anywhere, so only the commands that work anywhere may be bound to one.
        worksAnywhere: !command.hidden && isScopeIndependentCommand(command),
    })), [t]);
    const shortcutCommandOptions = useMemo(() => [
        { value: '', label: t('options.customShortcutNoCommand') },
        ...commands.filter(command => command.worksAnywhere),
    ], [commands, t]);

    // The field records whatever is pressed, so a key is refused here, with the reason. It asks the
    // registry, so a hotkey added later refuses its own letter by itself.
    const validateShortcutKey = useCallback((letter: string): string | null => {
        if (!CUSTOM_SHORTCUT_LETTERS.includes(letter)) {
            return t('options.customShortcutLettersOnly');
        }
        return isCustomShortcutLetterAvailable(letter, COMMAND_PALETTE_COMMANDS) ? null : t('options.customShortcutTaken');
    }, [t]);

    return (
        <>
            <Group def={PALETTE}>
                <Row option={O.pinned} hint={t('options.pinnedCommandsDesc')}>
                    {pinnedCommandIds.map((commandId, slot) => (
                        <Select
                            key={slot}
                            name={t('options.pinnedCommandSlot', { index: slot + 1 })}
                            value={commandId ?? ''}
                            options={[
                                { value: '', label: t('options.pinnedCommandNone') },
                                // A command pinned in one slot is not offered in the others.
                                ...commands.filter(command => command.value === commandId || !pinnedCommandIds.includes(command.value)),
                            ]}
                            onChange={value => setPinnedCommandId(slot, value || null)}
                        />
                    ))}
                </Row>
                <Row option={O.shortcut} hint={t('options.customShortcutDesc')}>
                    <KeyCapture
                        value={interaction.shortcutLetter}
                        onChange={interaction.setShortcutLetter}
                        validate={validateShortcutKey}
                        prefix={['Alt']}
                    />
                    <Value>{t('options.customShortcutCommand')}</Value>
                    <Select
                        name={t('options.customShortcutCommand')}
                        value={interaction.shortcutCommandId ?? ''}
                        options={shortcutCommandOptions}
                        onChange={value => interaction.setShortcutCommandId(value || null)}
                    />
                </Row>
            </Group>

            {isElectron && <GlobalShortcutsGroup />}

            <Group def={GRIDS}>
                {isGridActive && (
                    <Row
                        option={O.slideTarget}
                        hint={interaction.slideTarget === 'filter'
                            ? t('options.gridSlideTargetFilterDesc')
                            : t('options.gridSlideTargetCommandPaletteDesc', { modifier: PRIMARY_MODIFIER_LABEL })}
                        note={t('options.gridSlideTargetDesc')}
                    >
                        <Segmented
                            value={interaction.slideTarget}
                            options={[
                                { value: 'filter', label: t('options.gridSlideTargetFilter') },
                                { value: 'command-palette', label: t('options.gridSlideTargetCommandPalette') },
                            ]}
                            onChange={interaction.setSlideTarget}
                        />
                    </Row>
                )}
                <Row option={O.paletteHotkey} hint={t('options.gridPaletteHotkeyDesc')}>
                    <Toggle checked={interaction.paletteHotkey} onChange={interaction.setPaletteHotkey} />
                </Row>
            </Group>
        </>
    );
};

export default InteractionPage;
