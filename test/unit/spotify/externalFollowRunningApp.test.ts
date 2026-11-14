import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/spotify/externalFollowRunningApp.test.ts
// Whether the follow's port search looks for the app at all is read off `spotifyIsRunning`. This
// branch answers true or false, while the restart-consent branch answers 'running', 'stopped' or
// 'unknown': only a certain yes may be searched for, since 'unknown' means the question could not be
// answered and a search would spend the run's own allowance for nothing.
//
// The predicate takes the answer as an argument rather than closing over the function, so it is read
// here as the production code reads it, and it keeps its point across the merge of the two branches:
// the merge changes what `spotifyIsRunning` answers, not this reading of its answer.

const require = createRequire(import.meta.url);
const { spotifyRuns } = require('../../../electron/spotify/officialClient.cjs') as {
    spotifyRuns: (answer: boolean | string | null | undefined) => boolean;
};

describe('whether the answer of spotifyIsRunning is a yes', () => {
    it('reads the boolean this branch answers', () => {
        expect(spotifyRuns(true)).toBe(true);
        expect(spotifyRuns(false)).toBe(false);
    });

    it('reads the three answers the restart-consent branch gives', () => {
        expect(spotifyRuns('running')).toBe(true);
        expect(spotifyRuns('stopped')).toBe(false);
        // The tasklist could not be read: the app may well be running, and nothing is looked for.
        expect(spotifyRuns('unknown')).toBe(false);
    });

    it('searches for nothing where the answer is neither', () => {
        expect(spotifyRuns(undefined)).toBe(false);
        expect(spotifyRuns(null)).toBe(false);
        expect(spotifyRuns('')).toBe(false);
    });
});
