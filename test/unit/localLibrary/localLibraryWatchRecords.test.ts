import { describe, expect, it } from 'vitest';
import {
    isObserverErrorRecord,
    isRelevantLocalLibraryChange,
    summarizeLocalLibraryChanges,
} from '../../../src/utils/localLibraryWatchRecords';

// FileSystemObserver reports every write under a watched root. These cases pin which of them are
// worth an incremental rescan - the filter is what keeps one added song from rescanning twice.

const record = (type: string, ...relativePathComponents: string[]) => ({ type, relativePathComponents });

describe('isRelevantLocalLibraryChange', () => {
    it('keeps audio, lyric and cover files', () => {
        expect(isRelevantLocalLibraryChange(record('appeared', 'Album', 'track.mp3'))).toBe(true);
        expect(isRelevantLocalLibraryChange(record('appeared', 'Album', 'track.dsf'))).toBe(true);
        expect(isRelevantLocalLibraryChange(record('appeared', 'Album', 'track.dff'))).toBe(true);
        expect(isRelevantLocalLibraryChange(record('modified', 'Album', 'track.lrc'))).toBe(true);
        expect(isRelevantLocalLibraryChange(record('disappeared', 'Album', 'cover.jpg'))).toBe(true);
    });

    it('keeps extension-less entries, which are usually directories', () => {
        expect(isRelevantLocalLibraryChange(record('appeared', 'New Album'))).toBe(true);
        expect(isRelevantLocalLibraryChange(record('moved', 'Album', 'Disc 2'))).toBe(true);
    });

    it('keeps records the observer could not describe', () => {
        // `unknown` means the observer lost track; dropping it would lose a real change.
        expect(isRelevantLocalLibraryChange({ type: 'unknown' })).toBe(true);
        expect(isRelevantLocalLibraryChange({ type: 'appeared' })).toBe(true);
        expect(isRelevantLocalLibraryChange(record('appeared'))).toBe(true);
    });

    it('drops dotfiles, editor leftovers and unrelated file types', () => {
        expect(isRelevantLocalLibraryChange(record('appeared', '.DS_Store'))).toBe(false);
        expect(isRelevantLocalLibraryChange(record('appeared', 'Album', '~$notes.doc'))).toBe(false);
        expect(isRelevantLocalLibraryChange(record('modified', 'Album', 'track.mp3.part'))).toBe(false);
        expect(isRelevantLocalLibraryChange(record('appeared', 'readme.txt'))).toBe(false);
    });

    it('treats an errored record as a watch failure rather than a change', () => {
        expect(isObserverErrorRecord({ type: 'errored' })).toBe(true);
        expect(isRelevantLocalLibraryChange({ type: 'errored' })).toBe(false);
    });
});

describe('summarizeLocalLibraryChanges', () => {
    it('counts only the records that ask for a rescan', () => {
        expect(summarizeLocalLibraryChanges([
            record('appeared', 'Album', 'a.mp3'),
            record('appeared', 'Album', 'a.mp3.crdownload'),
            record('modified', 'Album', 'a.lrc'),
            record('appeared', '.hidden'),
        ])).toEqual({ relevantCount: 2, errored: false });
    });

    it('reports the observation stopping even alongside real changes', () => {
        expect(summarizeLocalLibraryChanges([
            record('appeared', 'Album', 'a.mp3'),
            { type: 'errored' },
        ])).toEqual({ relevantCount: 1, errored: true });
    });

    it('summarises an empty batch as nothing to do', () => {
        expect(summarizeLocalLibraryChanges([])).toEqual({ relevantCount: 0, errored: false });
    });
});
