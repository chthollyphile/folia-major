import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { COMMAND_PALETTE_COMMANDS } from '../../../command-palette/commandRegistry';
import { getCommandTitle } from '../../../command-palette/commandText';
import {
    GLOBAL_SHORTCUT_COMMAND_IDS,
    PORTAL_GLOBAL_SHORTCUTS,
    formatGlobalShortcutPart,
    globalShortcutKeyLabels,
    parseGlobalShortcutChord,
    readGlobalShortcutChord,
    refuseGlobalShortcutChord,
    toGlobalShortcutAccelerator,
    type GlobalShortcutKeyRefusal,
} from '../../../command-palette/globalShortcuts/globalShortcutRules';
import { useGlobalShortcutStatusStore } from '../../../command-palette/globalShortcuts/globalShortcutStatusStore';
import { useFoliumGlobalShortcutCommands } from '../../../../mods/folium/registries/globalShortcutCommands';
import { useInteractionSettingsStore } from '../../../../stores/useInteractionSettingsStore';
import { Button, Group, KeyCapture, Keys, Row, Select, Status, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/GlobalShortcutsGroup.tsx
// The 全局快捷键 group of the 快捷操作 page: five system-wide shortcuts of the desktop app, each a
// combination of modifiers and one key, run against one playback command. The listener records the
// combination by pressing it, so the modifiers are theirs to choose. Which combinations are allowed
// is globalShortcutRules' answer; whether the system took a combination is the main process's, read
// from the status store. On native Wayland the combinations picked here would do nothing, so the rows
// give way to one button that hands every playback command to the desktop's shortcut portal, and
// the note lists which suggested key is which command, for the desktop's own list.
//
// After the playback commands, each command list offers the mod commands marked `globalShortcut`
// (Folium 1.7), labelled with the command first and its mod's name after it: CustomSelect has no
// option groups, so the mod name in the label is the grouping. A slot bound to a mod command that is not registered now
// keeps it, shows it as its value, and says why its key does nothing. Not on the portal.

export const GLOBAL_SHORTCUTS: SettingsGroupDef = { id: 'globalShortcuts', titleKey: 'options.settingsHeadingGlobalShortcuts', electronOnly: true };

const O = {
    slots: option(GLOBAL_SHORTCUTS, 'globalShortcutSlots', 'options.globalShortcuts'),
};

export const GLOBAL_SHORTCUTS_OPTIONS = Object.values(O);

const REFUSAL_KEYS: Record<GlobalShortcutKeyRefusal, string> = {
    'needs-modifier': 'options.globalShortcutNeedsModifier',
    'unsupported-key': 'options.globalShortcutUnsupportedKey',
    reserved: 'options.globalShortcutReserved',
    duplicate: 'options.globalShortcutDuplicate',
};

export const GlobalShortcutsGroup: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { bindings, setBinding, portalEnabled, setPortalEnabled } = useInteractionSettingsStore(useShallow(state => ({
        bindings: state.globalShortcutBindings,
        setBinding: state.setGlobalShortcutBinding,
        portalEnabled: state.globalShortcutPortalEnabled,
        setPortalEnabled: state.setGlobalShortcutPortalEnabled,
    })));
    const { backend, refused } = useGlobalShortcutStatusStore(useShallow(state => ({
        backend: state.backend,
        refused: state.refused,
    })));
    const onPortal = backend === 'portal';
    const { commands: modCommands, describeMissing } = useFoliumGlobalShortcutCommands(i18n.language || 'en');

    const commandTitle = useCallback((id: string) => {
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id);
        return command ? getCommandTitle(command, t) : id;
    }, [t]);
    const commandOptions = useMemo(() => [
        { value: '', label: t('options.globalShortcutNoCommand') },
        ...GLOBAL_SHORTCUT_COMMAND_IDS.map(id => ({ value: id, label: commandTitle(id) })),
        ...modCommands.map(command => ({
            value: command.id,
            label: t('options.globalShortcutModCommand', { mod: command.modName, command: command.title }),
        })),
    ], [commandTitle, modCommands, t]);

    // One validator per slot, so a combination is refused against the other four.
    const validators = useMemo(() => bindings.map((_, slot) => (chord: string): string | null => {
        const { key, modifiers } = parseGlobalShortcutChord(chord);
        const refusal = refuseGlobalShortcutChord(key, modifiers, slot, bindings);
        return refusal ? t(REFUSAL_KEYS[refusal]) : null;
    }), [bindings, t]);
    const readKey = useCallback((event: KeyboardEvent) => readGlobalShortcutChord(event), []);

    if (onPortal) {
        return (
            <Group def={GLOBAL_SHORTCUTS}>
                <Row
                    option={O.slots}
                    hint={t(portalEnabled ? 'options.globalShortcutPortalRegistered' : 'options.globalShortcutsPortalDesc')}
                    note={(
                        <>
                            <p>{t('options.globalShortcutsPortalNote')}</p>
                            <ul className="mt-2 space-y-1">
                                {PORTAL_GLOBAL_SHORTCUTS.map(shortcut => (
                                    <li key={shortcut.accelerator} className="flex items-center gap-2">
                                        <Keys keys={globalShortcutKeyLabels(shortcut.accelerator)} />
                                        <span>{commandTitle(shortcut.commandId)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                >
                    <Button variant={portalEnabled ? 'quiet' : 'primary'} onClick={() => setPortalEnabled(!portalEnabled)}>
                        {t(portalEnabled ? 'options.globalShortcutPortalUnregister' : 'options.globalShortcutPortalRegister')}
                    </Button>
                </Row>
            </Group>
        );
    }

    return (
        <Group def={GLOBAL_SHORTCUTS}>
            <Row option={O.slots} hint={t('options.globalShortcutsDesc')} note={t('options.globalShortcutsNote')} />
            {bindings.map((binding, slot) => {
                const missing = binding.commandId ? describeMissing(binding.commandId) : null;
                const accelerator = binding.key ? toGlobalShortcutAccelerator(binding.key, binding.modifiers) : '';
                const isRefused = !missing && Boolean(accelerator && binding.commandId)
                    && refused.includes(accelerator);
                const below = missing
                    ? <Status tone="warn">{t(missing.reason === 'mod-inactive' ? 'options.globalShortcutModInactive' : 'options.globalShortcutModCommandMissing')}</Status>
                    : isRefused ? <Status tone="error">{t('options.globalShortcutTakenBySystem')}</Status> : undefined;
                // The bound command stays the shown value while its mod is away; its label is not known then.
                const options = missing && binding.commandId
                    ? [...commandOptions, {
                        value: binding.commandId,
                        label: t('options.globalShortcutModCommand', { mod: missing.modName, command: missing.name }),
                    }]
                    : commandOptions;
                return (
                    <Row
                        key={slot}
                        sub
                        label={t('options.globalShortcutSlot', { index: slot + 1 })}
                        below={below}
                    >
                        <KeyCapture
                            value={binding.key ? [...binding.modifiers, binding.key].join('+') : null}
                            onChange={(next) => {
                                if (!next) {
                                    setBinding(slot, { key: null });
                                    return;
                                }
                                const { key, modifiers } = parseGlobalShortcutChord(next);
                                setBinding(slot, { key, modifiers });
                            }}
                            validate={validators[slot]}
                            readKey={readKey}
                            formatKey={formatGlobalShortcutPart}
                        />
                        {/* Every slot's list is as wide as the narrowest compact Select, so a long mod
                            command label is cut short in the trigger instead of pushing the row onto
                            two lines; the open menu still grows to its longest option. */}
                        <div className="w-[136px] shrink-0">
                            <Select
                                name={t('options.globalShortcutCommand', { index: slot + 1 })}
                                value={binding.commandId ?? ''}
                                options={options}
                                onChange={value => setBinding(slot, { commandId: value || null })}
                            />
                        </div>
                    </Row>
                );
            })}
        </Group>
    );
};

export default GlobalShortcutsGroup;
