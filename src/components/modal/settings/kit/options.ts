// src/components/modal/settings/kit/options.ts
// What a page declares about its groups and rows. The same object gives a group its heading and a
// row its label, and is what the settings search lists and a landing looks for, so a name is
// written once. Plain data on purpose: the search reads it without mounting the page. Where a
// group or a row is drawn only on some machines, it says so here, and the search leaves it out
// on the others.

export type SettingsGroupDef = {
    /** The group's place on its page: its tab in the page header and any landing name it by this. */
    id: string;
    /** Translation key of the heading. */
    titleKey: string;
    /** A group only the desktop app has; the search leaves it and its options out on web. */
    electronOnly?: boolean;
    /** Asked by the search: false where the page does not draw the group on this machine (a browser that cannot watch a folder). */
    available?: () => boolean;
};

export type SettingsOptionDef = {
    /** The row's place on its page, unique among the page's groups and rows. */
    id: string;
    /** Translation key of the label. */
    labelKey: string;
    group: SettingsGroupDef;
    /** A row only the desktop app draws, in a group the web has too; the search leaves it out on web. */
    electronOnly?: boolean;
    /** Asked by the search: false where the page does not draw the row on this machine (a row for one system). */
    available?: () => boolean;
};

/** Whether the page draws a group or a row here: what the search asks before it lists one. */
export const isDrawnHere = (
    def: Pick<SettingsGroupDef, 'electronOnly' | 'available'>,
    machine: { isElectron: boolean },
): boolean => (machine.isElectron || !def.electronOnly) && def.available?.() !== false;

export const option = (group: SettingsGroupDef, id: string, labelKey: string, marks?: Pick<SettingsOptionDef, 'electronOnly' | 'available'>): SettingsOptionDef => ({
    id,
    labelKey,
    group,
    ...marks,
});
