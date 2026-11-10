import { describe, expect, it } from 'vitest';
import fs from 'fs';
import shared from '../../../electron/modSystem/foliumShared.json';
import { CONTRACT_PATH, parseContract } from '../../../dev/folium/api-docs.mjs';
import { FOLIUM_EVENT_TYPES } from '@/mods/folium/eventTypes';

// test/unit/mod-system/foliumEventTypes.test.ts
// The event-types table (eventTypes.ts) against the contract. The compiler
// holds the table to FoliumEventMap's names; what it cannot see is which of
// the contract's two lists a name is in, so each row's `dispatch` is checked
// here against the list it comes from, and each opt-in against the
// experimental names the host knows.

interface ParsedItem { name: string; members?: { name: string }[] }
const items = (parseContract(fs.readFileSync(CONTRACT_PATH, 'utf8')) as unknown as { items: ParsedItem[] }[])
    .flatMap((section) => section.items);
const memberNames = (name: string) => (items.find((item) => item.name === name)?.members ?? []).map((member) => member.name).sort();
const tableNames = (dispatch: 'notification' | 'hook') => Object.entries(FOLIUM_EVENT_TYPES)
    .filter(([, row]) => row.dispatch === dispatch)
    .map(([name]) => name)
    .sort();

describe('the event-types table', () => {
    it('lists the same names as FoliumEventMap, each under the dispatch of its list in the contract', () => {
        expect(memberNames('FoliumNotificationEvents').length).toBeGreaterThan(0);
        expect(tableNames('notification')).toEqual(memberNames('FoliumNotificationEvents'));
        expect(tableNames('hook')).toEqual(memberNames('FoliumHookEvents'));
    });

    it('names only experimental opt-ins the host knows', () => {
        const known = Object.values(shared.experimental);
        Object.values(FOLIUM_EVENT_TYPES).forEach((row) => {
            if (row.experimental !== null) expect(known).toContain(row.experimental);
        });
    });
});
