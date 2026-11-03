import { COMMAND_PALETTE_COMMANDS, matchCommandsExactly } from '../../../command-palette/commandRegistry';
import { normalizeSearchText } from '../../../command-palette/search/normalize';
import { isDrawnHere, type SettingsOptionDef } from '../kit/options';
import type { SettingsNavGroup, SettingsSectionId } from './settingsNavModel';

// src/components/modal/settings/navigation/settingsNavSearch.ts
// The settings search: what it can find and how a query is matched. An entry is a category, a group
// on its page, or a single option; a hit names where to land. Besides the entries' own text it asks
// the command palette's index about every command that opens a place in the settings: those carry
// the hand-written synonyms and generated pinyin that let "fps" or "tuxing" find the graphics page,
// which no label spells out.

/** Commands that land somewhere in the settings. A module constant so the search index caches. */
const SETTINGS_TARGET_COMMANDS = COMMAND_PALETTE_COMMANDS.filter(command => command.settingsTarget);

const MAX_HITS = 40;

export type SettingsSearchEntry = {
    sectionId: SettingsSectionId;
    /** The group or row the hit lands on; null opens the category at its top. */
    targetId: string | null;
    /** The group a row is in, where the hit lands while the row itself is not shown. */
    groupId?: string;
    label: string;
    /** Where the entry is: the category, then the group. Empty for a category. */
    path: string;
};

type Translate = (key: string) => string;

/**
 * Lists everything the search can find, in side-list order: each category, then what is on its
 * page: the options the page declares and their groups, those it draws on this machine. A place
 * other code names (settingsAnchorModel) is found as the group or the row that carries its id.
 */
export const buildSettingsSearchEntries = (
    groups: SettingsNavGroup[],
    pageOptions: Partial<Record<SettingsSectionId, readonly SettingsOptionDef[]>>,
    t: Translate,
    availability: { isElectron: boolean },
): SettingsSearchEntry[] => groups.flatMap(navGroup => navGroup.items.flatMap((section) => {
    // A category is also found by the name of the side-list group it is in.
    const entries: SettingsSearchEntry[] = [{ sectionId: section.id, targetId: null, label: section.label, path: navGroup.label }];
    const listedGroups = new Set<string>();

    for (const option of pageOptions[section.id] ?? []) {
        if (!isDrawnHere(option.group, availability) || !isDrawnHere(option, availability)) {
            continue;
        }
        const groupTitle = t(option.group.titleKey);
        if (!listedGroups.has(option.group.id)) {
            listedGroups.add(option.group.id);
            entries.push({ sectionId: section.id, targetId: option.group.id, label: groupTitle, path: section.label });
        }
        entries.push({
            sectionId: section.id,
            targetId: option.id,
            groupId: option.group.id,
            label: t(option.labelKey),
            path: `${section.label} › ${groupTitle}`,
        });
    }

    return entries;
}));

/** The entries a query names: those whose own label matches first, then the rest, each in list order. */
export const searchSettings = (
    entries: SettingsSearchEntry[],
    query: string,
    locale: string,
): SettingsSearchEntry[] => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
        return [];
    }

    const contains = (text: string) => normalizeSearchText(text).includes(normalizedQuery);
    const sectionHits = new Set<string>();
    const targetHits = new Set<string>();
    matchCommandsExactly(query, SETTINGS_TARGET_COMMANDS, locale).forEach(command => {
        const target = command.settingsTarget!;
        if (target.anchorId) {
            targetHits.add(target.anchorId);
        } else {
            sectionHits.add(target.subview);
        }
    });

    const byLabel: SettingsSearchEntry[] = [];
    const byOther: SettingsSearchEntry[] = [];
    for (const entry of entries) {
        if (contains(entry.label)) {
            byLabel.push(entry);
        } else if (contains(entry.path) || (entry.targetId ? targetHits.has(entry.targetId) : sectionHits.has(entry.sectionId))) {
            byOther.push(entry);
        }
    }

    return [...byLabel, ...byOther].slice(0, MAX_HITS);
};
