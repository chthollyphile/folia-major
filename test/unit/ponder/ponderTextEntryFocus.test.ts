// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTextEntryFocus } from '@/components/ponder/hold/useTextEntryFocus';

// test/unit/ponder/ponderTextEntryFocus.test.ts
// The hint capsule shows only while holding G would open the lesson, and G held with the focus in
// a text field types a letter instead. This is what the capsule asks: is the focus in a text field
// now. Where it goes wrong the capsule promises a key that does nothing (the lyric match window
// opens with its search field focused), or stays away after the field is gone.

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let typing: boolean;

const Probe: React.FC = () => {
    typing = useTextEntryFocus();
    return null;
};

const draw = async () => {
    root ??= createRoot(document.createElement('div'));
    await act(async () => root!.render(React.createElement(Probe)));
};

const add = <K extends 'input' | 'button'>(tag: K) => document.body.appendChild(document.createElement(tag));

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
});

describe('whether the focus is in a text field', () => {
    it('follows the focus into a field, out of it, and on to a button', async () => {
        const field = add('input');
        const button = add('button');
        await draw();
        expect(typing).toBe(false);

        await act(async () => field.focus());
        expect(typing).toBe(true);

        await act(async () => button.focus());
        expect(typing).toBe(false);

        await act(async () => field.focus());
        expect(typing).toBe(true);

        await act(async () => field.blur());
        expect(typing).toBe(false);
    });

    it('is right from the first render when a field already has the focus', async () => {
        add('input').focus();
        await draw();
        expect(typing).toBe(true);
    });

    it('follows the focused control when it starts and stops taking keys without a focus event', async () => {
        // The key-capture button of the settings marks itself while it records; the focus does not move.
        const button = add('button');
        await draw();
        await act(async () => button.focus());
        expect(typing).toBe(false);

        await act(async () => button.setAttribute('data-folia-key-capture', 'true'));
        expect(typing).toBe(true);

        await act(async () => button.removeAttribute('data-folia-key-capture'));
        expect(typing).toBe(false);
    });

    it('is read again on the next render after a focused field was removed', async () => {
        const field = add('input');
        await draw();
        await act(async () => field.focus());
        expect(typing).toBe(true);

        // A window closing with its field focused: browsers send no focusout for a removed element.
        field.remove();
        await draw();
        expect(typing).toBe(false);
    });
});
