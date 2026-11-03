import React from 'react';
import type { Theme } from '@/types';
import type { FoliumSetting, FoliumSettingAccess, FoliumSettingsSectionDef } from '../contract';
import { isFoliumSecretParam, resolveFoliumLabel, sanitizeFoliumParams } from '../../params/params';
import { createFoliumParamAccess } from '../../params/paramStore';
import { createFoliumRegistry, useFoliumRegistryEntries } from '../../runtime/registry';
import { FoliumSettingsCard } from '../../params/FoliumSettingsCard';
import { foliumMountName } from '../kinds';

// src/mods/folium/registries/settingsSections.tsx
// `folium.registries.settingsSections`: a mod's own settings, shown in the
// mods panel when that mod's row is expanded (next to its commands). The
// schema is the store: values persist under `settings:<id>`, ride along in
// visual config import/export, and the mod reads them through the handle's
// `settings`. Folium 1.7 `secret` fields are allowed here and nowhere else:
// they are drawn in the form, but their values live in the main process
// (folium/secrets.ts), never in the section's values.

export interface StoredFoliumSettingsSection {
    def: FoliumSettingsSectionDef;
    settings: FoliumSetting[];
    access: FoliumSettingAccess;
    /** The keys of the section's `secret` fields, in declaration order. */
    secretKeys: string[];
}

const SETTINGS_SECTION = foliumMountName('settingsSections', 'settings');

export const settingsSectionsRegistry = createFoliumRegistry<FoliumSettingsSectionDef, StoredFoliumSettingsSection>('settingsSections', {
    validate: (def, { id, modId }) => {
        const settings = sanitizeFoliumParams(def.settings, modId, { allowSecret: true });
        if (settings.length === 0) {
            throw new Error('settingsSections.register: settings must declare at least one valid field');
        }
        if (def.settingsPanel !== undefined && typeof def.settingsPanel !== 'function') {
            throw new Error('settingsSections.register: settingsPanel must be a mount function');
        }
        return {
            def,
            settings,
            access: createFoliumParamAccess(`settings:${id}`, settings),
            secretKeys: settings.filter(isFoliumSecretParam).map((param) => param.key),
        };
    },
});

/** The settings sections of one mod (or of all mods), in id order, as themed cards. */
export const FoliumSettingsSections: React.FC<{
    modId?: string;
    theme: Theme;
    isDaylight: boolean;
    language: string;
    controlCardBg?: string;
    rangeInputClass?: string;
}> = ({ modId, theme, isDaylight, language, controlCardBg, rangeInputClass }) => {
    const entries = useFoliumRegistryEntries(settingsSectionsRegistry);
    const sorted = entries
        .filter((entry) => !modId || entry.modId === modId)
        .sort((left, right) => left.id.localeCompare(right.id));
    if (sorted.length === 0) return null;
    return (
        <>
            {sorted.map((entry) => (
                <FoliumSettingsCard
                    key={entry.id}
                    modId={entry.modId}
                    where={`settings section ${entry.id}`}
                    entryKind={SETTINGS_SECTION}
                    entryId={entry.id}
                    title={entry.def.def.label}
                    fallbackTitle={entry.id}
                    access={entry.def.access}
                    customPanel={entry.def.def.settingsPanel}
                    theme={theme}
                    isDaylight={isDaylight}
                    controlCardBg={controlCardBg}
                    rangeInputClass={rangeInputClass}
                    description={entry.def.def.description
                        ? resolveFoliumLabel(entry.def.def.description, language, '')
                        : undefined}
                />
            ))}
        </>
    );
};
