// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Chips } from '../../../src/components/modal/settings/kit/Chips';
import { copyText } from '../../../src/utils/system/clipboard';
import { CopyButton } from '../../../src/components/modal/settings/kit/CopyButton';
import { KeyCapture } from '../../../src/components/modal/settings/kit/KeyCapture';
import { KIT_MOTION } from '../../../src/components/modal/settings/kit/motion';
import { OrderList } from '../../../src/components/modal/settings/kit/OrderList';
import { PictureChoice } from '../../../src/components/modal/settings/kit/PictureChoice';
import { Unfold } from '../../../src/components/modal/settings/kit/Reveal';
import { Segmented } from '../../../src/components/modal/settings/kit/Segmented';
import { TextField } from '../../../src/components/modal/settings/kit/TextField';
import { CustomSelect } from '../../../src/components/shared/CustomSelect';
import { isKeyCaptureTarget, isTextEntryTarget } from '../../../src/utils/keyboardTargets';

// test/unit/settings/settingsKitFaults.test.ts
// Faults of the settings kit and its pick list that were fixed and that nobody would see come back
// by looking: they need the keyboard at one exact moment, or a screen reader. Each case is the
// scenario the fault was found with.

let root: Root | null = null;
let host: HTMLElement | null = null;

const render = async (element: React.ReactElement) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(element);
    });
};

const press = (target: Element, key: string) => act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
});

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout, so it leaves this out.
    Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
});

describe('the pick list', () => {
    const select = (options: Array<{ value: string; label: string }>, value: string, picked: string[] = []) => (
        React.createElement(CustomSelect, { value, options, onChange: (next: string) => picked.push(next) })
    );
    const trigger = () => document.querySelector<HTMLElement>('[role="combobox"]')!;
    const activeLabel = () => {
        const id = trigger().getAttribute('aria-activedescendant');
        return id ? document.getElementById(id)?.textContent ?? null : null;
    };

    it('keeps the highlight on the same option when the options load under the open list', async () => {
        const picked: string[] = [];
        const saved = { value: 'saved', label: 'Saved device' };
        await render(select([{ value: '', label: 'Default' }, saved], 'saved', picked));
        await act(async () => {
            trigger().click();
        });
        expect(activeLabel()).toBe('Saved device');

        // The output device list: its options arrive after it opened.
        await render(select([{ value: '', label: 'Default' }, { value: 'devA', label: 'Device A' }, { value: 'devB', label: 'Device B' }, saved], 'saved', picked));
        expect(activeLabel()).toBe('Saved device');

        // Enter on the option already chosen only closes the list, as a native select does: no
        // option that arrived above it was picked instead.
        await press(trigger(), 'Enter');
        expect(picked).toEqual([]);
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('stops the keys that open it, so Space does not also reach the player', async () => {
        const seen: string[] = [];
        const listen = (event: KeyboardEvent) => seen.push(event.key);
        window.addEventListener('keydown', listen);
        await render(select([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a'));

        for (const key of [' ', 'Enter', 'ArrowDown', 'ArrowUp']) {
            await press(trigger(), key);
            expect(trigger().getAttribute('aria-expanded')).toBe('true');
            await press(trigger(), 'Escape');
            expect(trigger().getAttribute('aria-expanded')).toBe('false');
        }
        window.removeEventListener('keydown', listen);
        expect(seen).toEqual([]);
    });

    it('steps through the options of one letter typed again, takes a space in the middle as text, and searches anew each time it opens', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(0);
        const labels = ['Apple', 'Avocado', 'Banana', 'Apricot', 'New York'];
        await render(select(labels.map(label => ({ value: label, label })), 'Apple'));
        await press(trigger(), 'ArrowDown');
        expect(activeLabel()).toBe('Apple');

        for (const [at, expected] of [[100, 'Avocado'], [200, 'Apricot'], [300, 'Apple']] as const) {
            now.mockReturnValue(at);
            await press(trigger(), 'a');
            expect(activeLabel()).toBe(expected);
        }

        // Long after the last letter, a new search.
        for (const [index, letter] of [...'new y'].entries()) {
            now.mockReturnValue(5000 + index * 100);
            await press(trigger(), letter);
        }
        expect(activeLabel()).toBe('New York');
        expect(trigger().getAttribute('aria-expanded')).toBe('true');

        // Closed and opened again right after the last letter: what was typed before is forgotten.
        now.mockReturnValue(5450);
        await press(trigger(), 'Escape');
        await press(trigger(), 'ArrowDown');
        await press(trigger(), 'b');
        expect(activeLabel()).toBe('Banana');
    });

    it('closes when it is disabled while it is open', async () => {
        const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
        await render(select(options, 'a'));
        await press(trigger(), 'ArrowDown');
        expect(trigger().getAttribute('aria-expanded')).toBe('true');

        // A row that disables its list while it applies the choice.
        await render(React.createElement(CustomSelect, { value: 'a', options, onChange: () => {}, disabled: true }));
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('moves a page of options on PageDown and PageUp, and keeps those keys and an input method\'s from the page behind', async () => {
        const seen: string[] = [];
        const listen = (event: KeyboardEvent) => seen.push(event.key);
        window.addEventListener('keydown', listen);
        const options = Array.from({ length: 20 }, (_, index) => ({ value: `o${index}`, label: `Option ${index}` }));
        const activeNumber = () => Number(activeLabel()?.replace('Option ', ''));
        await render(select(options, 'o0'));
        await press(trigger(), 'ArrowDown');

        await press(trigger(), 'PageDown');
        const page = activeNumber();
        expect(page).toBeGreaterThan(1);
        await press(trigger(), 'PageDown');
        expect(activeNumber()).toBe(page * 2);
        await press(trigger(), 'PageUp');
        expect(activeNumber()).toBe(page);

        // An input method that is composing sends every key as 'Process'.
        await press(trigger(), 'Process');
        window.removeEventListener('keydown', listen);
        expect(seen).toEqual([]);
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('counts, while it is open, as a control that is reading the keyboard, so a bare-letter shortcut leaves the letter to it', async () => {
        await render(select([{ value: 'a', label: 'A' }, { value: 'g', label: 'G' }], 'a'));
        expect(isTextEntryTarget(trigger())).toBe(false);
        await press(trigger(), 'ArrowDown');
        expect(isTextEntryTarget(trigger())).toBe(true);
    });

    it('opens a long list scrolled to the chosen option', async () => {
        // The long lists are virtualised; jsdom has no scrollTo for the list to call.
        const tops: number[] = [];
        const original = Element.prototype.scrollTo;
        Element.prototype.scrollTo = ((options?: ScrollToOptions) => {
            tops.push(options?.top ?? 0);
        }) as typeof Element.prototype.scrollTo;
        const commands = Array.from({ length: 125 }, (_, index) => ({ value: `c${index}`, label: `Command ${index}` }));
        await render(select(commands, 'c100'));
        await act(async () => {
            trigger().click();
        });
        Element.prototype.scrollTo = original;

        expect(tops.length).toBeGreaterThan(0);
        expect(Math.max(...tops)).toBeGreaterThan(1000);
    });

    it('has no active option in an empty list, whatever key is pressed', async () => {
        await render(select([], 'gone'));
        await press(trigger(), 'ArrowDown');
        for (const key of ['Home', 'End', 'ArrowDown', 'ArrowUp', 'x']) {
            await press(trigger(), key);
            expect(trigger().hasAttribute('aria-activedescendant')).toBe(false);
        }
    });
});

describe('a kept, closed unfold', () => {
    it('is inert, so nothing open inside it can be reached', async () => {
        const unfold = (open: boolean) => React.createElement(
            Unfold,
            { keep: true, open, children: React.createElement(Unfold, { open: true, children: React.createElement('button', null, 'inside') }) },
        );
        await render(unfold(false));
        const outer = document.querySelector('.st-unfold')!;
        expect(outer.hasAttribute('inert')).toBe(true);
        expect(outer.querySelector('button')).not.toBeNull();

        await render(unfold(true));
        expect(outer.hasAttribute('inert')).toBe(false);
    });
});

describe('a text field that commits', () => {
    let commits = 0;
    const field = (value: string) => React.createElement(TextField, { value, onChange: () => {}, onCommit: () => { commits += 1; } });
    /** Types into the field as a person does; the page then gives the field the new text. */
    const type = async (input: HTMLInputElement, text: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await render(field(text));
    };

    it('commits a typed text once, and nothing for a field that was only passed through', async () => {
        commits = 0;
        await render(field(''));
        const input = document.querySelector('input')!;

        // The value arrives from outside after the field was drawn; then the keyboard passes through.
        await render(field('loaded later'));
        await act(async () => input.focus());
        await act(async () => input.blur());
        expect(commits).toBe(0);

        // Typed while focused: Enter and the blur after it are one commit.
        await act(async () => input.focus());
        await type(input, 'typed');
        await press(input, 'Enter');
        await act(async () => input.blur());
        expect(commits).toBe(1);
    });

    it('commits nothing for a text that changed from outside while the field had focus', async () => {
        commits = 0;
        await render(field('before'));
        const input = document.querySelector('input')!;
        await act(async () => input.focus());
        await render(field('stored by something else'));
        await act(async () => input.blur());
        expect(commits).toBe(0);
    });

    it('leaves Enter to an input method that is choosing a candidate', async () => {
        commits = 0;
        await render(field(''));
        const input = document.querySelector('input')!;
        await act(async () => input.focus());
        await type(input, '你好');
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
        });
        expect(commits).toBe(0);
        await press(input, 'Enter');
        expect(commits).toBe(1);
    });
});

describe('a choice that is disabled', () => {
    it('is said to be unavailable, not hidden from a screen reader', async () => {
        const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
        const choices = [
            React.createElement(Segmented, { value: 'a', options, onChange: () => {}, disabled: true }),
            React.createElement(PictureChoice, { value: 'a', options: options.map(option => ({ ...option, picture: null })), onChange: () => {}, disabled: true }),
            React.createElement(Chips, { items: [{ id: 'x', label: 'X', checked: true, onChange: () => {} }], disabled: true }),
        ];
        for (const choice of choices) {
            await render(choice);
            const group = document.querySelector('[role="group"]')!;
            expect(group.getAttribute('aria-disabled')).toBe('true');
            expect(group.hasAttribute('inert')).toBe(false);
            expect([...group.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
        }
    });
});

describe('the copy button', () => {
    it('starts no timer when it is gone before its text arrives', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let deliver: (text: string) => void = () => {};
        const text = () => new Promise<string>((resolve) => {
            deliver = resolve;
        });
        await render(React.createElement(CopyButton, { text }, 'Copy'));
        await act(async () => document.querySelector('button')!.click());
        await act(async () => root!.unmount());
        root = null;

        const started = vi.spyOn(window, 'setTimeout');
        deliver('late');
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
        // The timer that puts the copy icon back.
        expect(started.mock.calls.map(call => call[1])).not.toContain(KIT_MOTION.confirm * 1000);
        vi.useRealTimers();
    });

    it('gives focus back to what had it, where the text is copied through a hidden field', async () => {
        // Chromium's select() moves focus to the field, which is what lets the copy command read
        // it; jsdom's leaves focus alone, and has no copy command.
        vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(function select(this: HTMLTextAreaElement) {
            this.focus();
        });
        const page = document as unknown as { execCommand?: () => boolean };
        page.execCommand = () => true;
        const button = document.createElement('button');
        document.body.appendChild(button);
        button.focus();

        await copyText('text');
        delete page.execCommand;
        expect(document.activeElement).toBe(button);
        button.remove();
    });
});

describe('the field that records a key', () => {
    it('counts as reading the keyboard while it records, so the shortcuts that listen before it leave the key to it', async () => {
        await render(React.createElement(KeyCapture, { value: null, onChange: () => {} }));
        const field = document.querySelector('button')!;
        expect(isKeyCaptureTarget(field)).toBe(false);

        await act(async () => field.click());
        expect(isKeyCaptureTarget(field)).toBe(true);
        expect(isTextEntryTarget(field)).toBe(true);
    });
});

describe('the list whose order is the setting', () => {
    const Page: React.FC<{ accepts: boolean }> = ({ accepts }) => {
        const [order, setOrder] = React.useState(['a', 'b', 'c']);
        return React.createElement(OrderList<string>, {
            items: order.map(id => ({ id, label: id })),
            onChange: (next) => {
                if (accepts) setOrder(next);
            },
        });
    };
    const shown = () => [...document.querySelectorAll('[data-order-item]')].map(chip => chip.getAttribute('data-order-item'));

    it('shows the order the page keeps: the new one it took, the old one when it refused', async () => {
        await render(React.createElement(Page, { accepts: true }));
        await press(document.querySelector('[data-order-item="a"]')!, 'ArrowRight');
        expect(shown()).toEqual(['b', 'a', 'c']);

        await act(async () => root!.unmount());
        root = null;
        await render(React.createElement(Page, { accepts: false }));
        await press(document.querySelector('[data-order-item="a"]')!, 'ArrowRight');
        expect(shown()).toEqual(['a', 'b', 'c']);
    });
});
