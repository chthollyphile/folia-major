import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdStatusMessage, runStatusMessageTime, setStatusMessage, useStatusMessageStore } from '@/stores/useStatusMessageStore';

// test/unit/stores/statusMessageStore.test.ts
// Guards the two properties the toast channel's callers depend on: the updater form still sees
// the previous message, and the module-level emitter keeps one stable identity so it can be used
// outside React without entering dependency arrays. And a shown message's display time, which
// stands still while the pointer rests on the toast.

describe('status message store', () => {
    beforeEach(() => {
        useStatusMessageStore.setState({ message: null, held: false });
    });

    it('stores a message set directly', () => {
        setStatusMessage({ type: 'info', text: 'hello' });
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'info', text: 'hello' });
    });

    it('passes the previous message to the updater form', () => {
        setStatusMessage({ type: 'error', text: 'first', persistent: true });
        setStatusMessage(prev => (prev?.persistent ? null : prev));
        expect(useStatusMessageStore.getState().message).toBeNull();

        setStatusMessage({ type: 'info', text: 'second' });
        setStatusMessage(prev => (prev?.persistent ? null : prev));
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'info', text: 'second' });
    });

    it('clears back to null', () => {
        setStatusMessage({ type: 'success', text: 'done' });
        setStatusMessage(null);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('keeps a stable emitter identity across calls', () => {
        const first = setStatusMessage;
        setStatusMessage({ type: 'info', text: 'x' });
        expect(setStatusMessage).toBe(first);
    });
});

describe("a shown message's display time", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis);
        useStatusMessageStore.setState({ message: null, held: false });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('runs out after its time', () => {
        const ended = vi.fn();
        runStatusMessageTime(6000, ended);
        vi.advanceTimersByTime(5999);
        expect(ended).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(ended).toHaveBeenCalledOnce();
    });

    it('stands still while held and runs on for what was left', () => {
        const ended = vi.fn();
        runStatusMessageTime(6000, ended);
        vi.advanceTimersByTime(2000);
        holdStatusMessage(true);
        vi.advanceTimersByTime(60_000);
        expect(ended).not.toHaveBeenCalled();
        holdStatusMessage(false);
        vi.advanceTimersByTime(3999);
        expect(ended).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(ended).toHaveBeenCalledOnce();
    });

    it('does not run out once stopped', () => {
        const ended = vi.fn();
        const stop = runStatusMessageTime(3000, ended);
        stop();
        holdStatusMessage(true);
        holdStatusMessage(false);
        vi.advanceTimersByTime(10_000);
        expect(ended).not.toHaveBeenCalled();
    });

    it('starts unheld with every new message, so a toast gone from under the pointer holds nothing', () => {
        setStatusMessage({ type: 'info', text: 'first' });
        holdStatusMessage(true);
        setStatusMessage(prev => prev);
        expect(useStatusMessageStore.getState().held).toBe(true);
        setStatusMessage({ type: 'info', text: 'second' });
        expect(useStatusMessageStore.getState().held).toBe(false);
    });
});
