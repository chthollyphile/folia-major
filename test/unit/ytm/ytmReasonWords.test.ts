import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ytmLoginFailure } from '@/services/onlineMusic/ytm/ytmLoginFailure';

// test/unit/ytm/ytmReasonWords.test.ts
// YouTube Music's sign-in fails with a reason: a word the desktop side makes (electron/ytm/) and
// the window's side reads (ytmLoginFailure.ts). Each side is tested with the word written out, so a
// word renamed on one side only would end as an unknown failure with every test passing. This test
// reads the desktop side's source for the words it gives as a reason and asks the window's side
// what each of them is.

// The reason is the fourth thing given to ytmError, written out as a word.
const REASON = /ytmError\((?:[^()]|\([^()]*\))*,\s*'([a-z][a-z-]*)'\s*\)/g;
const reasonsIn = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(REASON)].map(match => match[1]);

it('every reason the desktop side gives for a failed YouTube Music sign-in is a case the window knows', () => {
    const reasons = [...new Set(['electron/ytm/webSignIn.cjs', 'electron/ytm/ytmApiBridge.cjs'].flatMap(reasonsIn))];
    // The four that are written out where they are thrown; the browser's own ways to fail come through a variable.
    expect(reasons).toEqual(expect.arrayContaining(['no-browser', 'folder-in-use', 'not-taken', 'account-missing']));
    for (const reason of reasons) expect(ytmLoginFailure('unavailable', reason)?.case, reason).toBeDefined();
    // A word the window does not know has no case.
    expect(ytmLoginFailure('unavailable', 'renamed-on-one-side')?.case).toBeUndefined();
});
