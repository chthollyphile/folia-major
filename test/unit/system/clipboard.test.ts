// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../../../src/utils/system/clipboard';

// test/unit/system/clipboard.test.ts
// The branching of the one way to copy a text that nobody sees by using the app: the clipboard API
// where the page may use it, a hidden field and the copy command where it may not, and a rejection
// when the text was not taken (a place says "copied" only after the promise resolved).
// That focus goes back to what had it is held by test/unit/settings/settingsKitFaults.test.ts.

const page = document as unknown as { execCommand?: (command: string) => boolean };

/** The page as the function sees it: served securely or not, with or without the clipboard API. */
const setPage = (secure: boolean, writeText?: (text: string) => Promise<void>): void => {
    Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
};

afterEach(() => {
    delete page.execCommand;
    setPage(false);
});

describe('copyText', () => {
    it('writes through the clipboard API on a page that may use it, and makes no field', async () => {
        const writeText = vi.fn(async () => undefined);
        const command = vi.fn(() => true);
        page.execCommand = command;
        setPage(true, writeText);
        await copyText('a line');
        expect(writeText).toHaveBeenCalledWith('a line');
        expect(command).not.toHaveBeenCalled();
    });

    it('rejects when the clipboard API refused, without trying the copy command', async () => {
        const command = vi.fn(() => true);
        page.execCommand = command;
        setPage(true, () => Promise.reject(new Error('not allowed')));
        await expect(copyText('a line')).rejects.toThrow('not allowed');
        expect(command).not.toHaveBeenCalled();
    });

    it('copies through a hidden field where the page may not use the API, and leaves no field behind', async () => {
        const writeText = vi.fn(async () => undefined);
        let selected = '';
        page.execCommand = (command) => {
            selected = command === 'copy' ? document.querySelector('textarea')?.value ?? '' : '';
            return true;
        };
        // An API that is there on a page not served securely is not used.
        setPage(false, writeText);
        await copyText('a line');
        expect(selected).toBe('a line');
        expect(writeText).not.toHaveBeenCalled();
        expect(document.querySelector('textarea')).toBeNull();

        setPage(true);
        selected = '';
        await copyText('another');
        expect(selected).toBe('another');
    });

    it('rejects when the copy command was refused, and leaves no field behind', async () => {
        page.execCommand = () => false;
        setPage(false);
        await expect(copyText('a line')).rejects.toThrow();
        expect(document.querySelector('textarea')).toBeNull();
    });
});
