// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SETTINGS_ANCHOR_DEFINITIONS } from '../../../src/components/modal/settings/navigation/settingsAnchorModel';
import type { SettingsSectionId } from '../../../src/components/modal/settings/navigation/settingsNavModel';
import { SETTINGS_PAGE_OPTIONS } from '../../../src/components/modal/settings/pages';

// test/unit/settings/settingsAnchorCoverage.test.ts
// A command or a link that names an anchor also names, through settingsAnchorModel, the page to
// open it on. Both halves are invisible when wrong: the command still runs, it just lands nowhere.
// This holds the table against the options the pages declare.

const declared = Object.entries(SETTINGS_ANCHOR_DEFINITIONS) as [string, { section: string }][];

describe('settings anchors', () => {
    // The page carries the id itself: it is the id of a group or of an option among the options
    // the page declares, which is what a landing looks for. A string that merely appears in the
    // page's source is no proof.
    it('are each carried by the page of their category, as a group or an option it declares', () => {
        const nowhere = declared
            .filter(([id, definition]) => !SETTINGS_PAGE_OPTIONS[definition.section as SettingsSectionId]
                .some(declaredOption => declaredOption.id === id || declaredOption.group.id === id))
            .map(([id, definition]) => `${id} is not on the ${definition.section} page`);

        expect(nowhere).toEqual([]);
    });

    // A landing looks for the id on the page the table names. The same id on a second page is a
    // second place the command could have meant, and nothing says which.
    it('are each declared on one page only', () => {
        const pages = Object.entries(SETTINGS_PAGE_OPTIONS) as [string, readonly { id: string; group: { id: string } }[]][];
        const elsewhere = declared.flatMap(([id, definition]) => pages
            .filter(([section, options]) => section !== definition.section && options.some(row => row.id === id || row.group.id === id))
            .map(([section]) => `${id} is also on the ${section} page`));

        expect(elsewhere).toEqual([]);
    });
});
