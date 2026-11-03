import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// test/unit/playback/currentSongArchitecture.test.ts
// "Which song is current" changes in one file, src/components/app/playback/currentSong.ts. This reads every source
// file under src/ and fails when another file does that file's work by hand:
//   - assigns the key of the song asked for (`currentSongRef.current = ...`);
//   - calls the store's `setCurrentSong` with a song or with null. A call that is given a function
//     is a patch of the song already there (its lyrics state, replay gain, metadata) and is allowed;
//   - writes the playback store around its setters (`usePlaybackStore.setState`);
//   - takes the two steps `askForSong` / `showSong` apart, outside the files listed for it, or in
//     a listed file more often than the list says (one more `showSong` alone would change the
//     song that is shown and leave the key behind).
//
// It is a search for these spellings, not a proof: a setter handed on under another name and
// called with a song would pass, and a function given to `setCurrentSong` can still answer with
// another song. It does not read test/ or dev/, where specs and probes set a song directly.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = 'src/components/app/playback/currentSong.ts';
// The store itself: it defines the setter the module calls.
const STORE = 'src/stores/usePlaybackStore.ts';

const KEY_ASSIGNMENT = /\b(?:currentSong(?:Key)?Ref|askedSongKeyRef)\.current\s*=(?!=)/g;
const SETTER_CALL = /\bsetCurrentSong\(\s*([^\n]*)/g;
// The start of an argument that is a function: `previous =>`, `(previous) =>`, `() =>`.
const UPDATER = /^(?:\w+|\(\s*\w*\s*\))\s*=>/;
const STORE_SET_STATE = /\busePlaybackStore\.setState\(/g;
const STEP_CALL = /\b(?:askForSong|showSong)\(/g;
const ASK_CALL = /\baskForSong\(/g;
const SHOW_CALL = /\bshowSong\(/g;

// A ref of the same name that is not the key.
const OTHER_REF_OF_THAT_NAME: Record<string, string> = {
    'src/hooks/useNavidromeScrobbleReporter.ts': 'its own ref, holding the whole song for the scrobble report',
};

// Files that may take the two steps apart: how many pairs each has, and why. Every other file
// makes a song current with the one call, `makeSongCurrent`.
const TWO_STEPS: Record<string, { pairs: number; why: string }> = {
    'src/components/app/playback/start/usePlaybackQueueController.ts': { pairs: 1, why: 'playSong waits for the stored lyrics state between asking and showing' },
    'src/components/app/playback/start/useLibraryPlaybackController.ts': { pairs: 2, why: 'a local play and a Navidrome play each write the lyrics between asking and showing' },
    'src/components/app/playback/useStagePlaybackController.ts': { pairs: 1, why: 'a stage media session waits for its lyrics to be parsed between asking and showing' },
    'src/App.tsx': { pairs: 1, why: 'cancelling a blend shows the outgoing song first and moves the key back last' },
};

const collectSourceFiles = async (relativeDir: string): Promise<string[]> => {
    const entries = await readdir(path.join(repoRoot, relativeDir), { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) return collectSourceFiles(relativePath);
        return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : [];
    }));
    return files.flat();
};

const count = (source: string, pattern: RegExp): number => [...source.matchAll(pattern)].length;
/** `setCurrentSong(` calls that are given something other than a function. */
const directSetterCalls = (source: string): number => (
    [...source.matchAll(SETTER_CALL)].filter(match => !UPDATER.test(match[1])).length
);

describe('which song is current', () => {
    it('changes only in src/components/app/playback/currentSong.ts', async () => {
        const files = (await collectSourceFiles('src')).filter(file => file !== MODULE && file !== STORE);
        const sources = await Promise.all(files.map(file => readFile(path.join(repoRoot, file), 'utf8')));

        const violations: string[] = [];
        files.forEach((file, index) => {
            const source = sources[index];
            if (!OTHER_REF_OF_THAT_NAME[file] && count(source, KEY_ASSIGNMENT) > 0) violations.push(`${file} assigns the key of the song asked for`);
            if (directSetterCalls(source) > 0) violations.push(`${file} calls setCurrentSong with a song or with null`);
            if (count(source, STORE_SET_STATE) > 0) violations.push(`${file} writes the playback store around its setters`);
            const listed = TWO_STEPS[file];
            if (!listed && count(source, STEP_CALL) > 0) violations.push(`${file} takes askForSong / showSong apart`);
            if (listed && (count(source, ASK_CALL) !== listed.pairs || count(source, SHOW_CALL) !== listed.pairs)) {
                violations.push(`${file} has ${count(source, ASK_CALL)} askForSong and ${count(source, SHOW_CALL)} showSong, the list says ${listed.pairs} of each`);
            }
        });

        expect(violations).toEqual([]);
    }, 30_000);

    it('looks for spellings that still match what they are meant to', async () => {
        expect(count('currentSongRef.current = songKey;', KEY_ASSIGNMENT)).toBe(1);
        expect(count('currentSongKeyRef.current = null;', KEY_ASSIGNMENT)).toBe(1);
        expect(count('if (currentSongRef.current === songKey) return;', KEY_ASSIGNMENT)).toBe(0);
        expect(count('if (currentSongRef.current !== songKey) return;', KEY_ASSIGNMENT)).toBe(0);

        expect(directSetterCalls('setCurrentSong(song);')).toBe(1);
        expect(directSetterCalls('setCurrentSong(null);')).toBe(1);
        expect(directSetterCalls('usePlaybackStore.getState().setCurrentSong({ ...song, name });')).toBe(1);
        expect(directSetterCalls('setCurrentSong(prev => isSamePlaybackSong(prev, song) ? updated : prev);')).toBe(0);
        expect(directSetterCalls('setCurrentSong((previous) => previous);')).toBe(0);
        expect(directSetterCalls('setCurrentSong(existingSong => {')).toBe(0);
        expect(directSetterCalls('setCurrentSong: SetState<SongResult | null>;')).toBe(0);

        // The module is where the store's setter is called with a song, and the store defines it.
        const module = await readFile(path.join(repoRoot, MODULE), 'utf8');
        expect(directSetterCalls(module)).toBe(1);
        expect(count(module, STEP_CALL)).toBeGreaterThan(0);
    });
});
