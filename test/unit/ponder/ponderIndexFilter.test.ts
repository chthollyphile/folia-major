import { describe, expect, it } from 'vitest';
import { filterPonderIndex } from '@/utils/ponder/ponderIndexFilter';

// test/unit/ponder/ponderIndexFilter.test.ts
// Which lessons the index lists for a filter and a search text. A lesson that drops out of the list
// by mistake raises no error anywhere: it is just not there to be picked.

type Lesson = { id: string; text: string };

const groups: { category: 'basics' | 'playback'; targets: Lesson[] }[] = [
    { category: 'basics', targets: [{ id: 'help-page', text: 'Getting to know Folia' }, { id: 'settings-page', text: 'Options page How settings are grouped' }] },
    { category: 'playback', targets: [{ id: 'player-bar', text: 'Bottom control bar What is on the capsule' }, { id: 'queue-shuffle', text: 'Where is shuffle The queue instead' }] },
];
const seen = new Set(['help-page', 'player-bar']);
const ids = (filter: Parameters<typeof filterPonderIndex>[1]['filter'], query = '') => (
    filterPonderIndex(groups, { filter, query, seen, textOf: lesson => lesson.text })
        .map(group => `${group.category}: ${group.targets.map(lesson => lesson.id).join(' ')}`)
);

describe('filterPonderIndex', () => {
    it('lists every group in order for "all", and one group for a category', () => {
        expect(ids('all')).toEqual(['basics: help-page settings-page', 'playback: player-bar queue-shuffle']);
        expect(ids('playback')).toEqual(['playback: player-bar queue-shuffle']);
    });

    it('lists only what has not been watched for "unseen"', () => {
        expect(ids('unseen')).toEqual(['basics: settings-page', 'playback: queue-shuffle']);
    });

    it('finds the search text in the title or the line, whatever its case, and drops an empty group', () => {
        expect(ids('all', '  QUEUE ')).toEqual(['playback: queue-shuffle']);
        expect(ids('all', 'settings')).toEqual(['basics: settings-page']);
        expect(ids('basics', 'capsule')).toEqual([]);
    });
});
