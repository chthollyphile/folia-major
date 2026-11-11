import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_LOADING_DELAY_MS, dropWaitingStatusLoaders, withStatusLoadingResult, beginStatusLoading, cancelStatusLoading, completeStatusLoading, failStatusLoading, reviseStatusLoading, holdStatusMessage, runStatusMessageTime, setStatusMessage, useStatusMessageStore } from '@/stores/useStatusMessageStore';

// test/unit/stores/statusMessageStore.test.ts
// Guards the two properties the toast channel's callers depend on: the updater form still sees
// the previous message, and the module-level emitter keeps one stable identity so it can be used
// outside React without entering dependency arrays. And a shown message's display time, which
// stands still while the pointer rests on the toast.

describe('status message store', () => {
    beforeEach(() => {
        useStatusMessageStore.setState({ message: null, held: false });
        dropWaitingStatusLoaders();
    });

    describe('owned loaders', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });
        const shown = (text: string) => {
            const loading = beginStatusLoading(text);
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            return loading;
        };

        it('shows nothing for a load that ends before the delay', () => {
            const quick = beginStatusLoading('quick');
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS - 1);
            expect(useStatusMessageStore.getState().message).toBeNull();
            completeStatusLoading(quick, 'done');
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message).toBeNull();
            const dropped = beginStatusLoading('dropped');
            cancelStatusLoading(dropped);
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message).toBeNull();
        });

        it('ends silently on a failure that came before the delay', () => {
            const loading = beginStatusLoading('loading');
            failStatusLoading(loading, 'failed');
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message).toBeNull();
        });

        it('lets a new play drop an older loader still waiting', () => {
            const older = beginStatusLoading('older');
            dropWaitingStatusLoaders();
            const newer = beginStatusLoading('newer');
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message).toMatchObject({ activityId: newer.activityId });
            cancelStatusLoading(older);
            expect(useStatusMessageStore.getState().message).toMatchObject({ activityId: newer.activityId });
        });

        it('shows a waiting loader at once when it is revised', () => {
            const loading = beginStatusLoading('loading');
            reviseStatusLoading(loading, { text: 'retrying' });
            expect(useStatusMessageStore.getState().message).toMatchObject({ activity: 'loading', activityId: loading.activityId, text: 'retrying' });
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message?.text).toBe('retrying');
        });

        it('does not cover a toast set while it waited', () => {
            beginStatusLoading('loading');
            setStatusMessage({ type: 'info', text: 'preview' });
            vi.advanceTimersByTime(STATUS_LOADING_DELAY_MS);
            expect(useStatusMessageStore.getState().message?.text).toBe('preview');
        });

        it('keeps the loader identity for success and rejects an older completion', () => {
            const first = shown('first');
            const second = shown('second');
            completeStatusLoading(first, 'old result');
            expect(useStatusMessageStore.getState().message).toBe(second);
            completeStatusLoading(second, 'done');
            expect(useStatusMessageStore.getState().message).toMatchObject({ activity: 'success', activityId: second.activityId, text: 'done' });
            expect(useStatusMessageStore.getState().message?.persistent).not.toBe(true);
        });

        it('morphs a failure without losing its actions or countdown', () => {
            const loading = shown('loading');
            const onAction = vi.fn();
            const countdown = { text: 'skip', seconds: 5, totalMs: 5000 };
            setStatusMessage({ type: 'error', text: 'failed', persistent: true, countdown, onAction });
            expect(useStatusMessageStore.getState().message).toMatchObject({ activity: 'error', activityId: loading.activityId, text: 'failed', persistent: true, countdown, onAction });
            completeStatusLoading(loading, 'late success');
            expect(useStatusMessageStore.getState().message?.text).toBe('failed');
        });

        it('keeps the predecorated failure identity used by countdown updates', () => {
            shown('loading');
            const failure = withStatusLoadingResult({ type: 'error', text: 'failed', persistent: true });
            setStatusMessage(failure);
            expect(useStatusMessageStore.getState().message).toBe(failure);
            setStatusMessage(previous => previous === failure ? { ...failure, text: 'next second' } : previous);
            expect(useStatusMessageStore.getState().message?.text).toBe('next second');
        });

        it('does not cover an error or fail a newer loading operation', () => {
            setStatusMessage({ type: 'error', text: 'error' });
            const hidden = shown('loading');
            completeStatusLoading(hidden, 'done');
            expect(useStatusMessageStore.getState().message?.text).toBe('error');
            setStatusMessage(null);
            const first = shown('first');
            const second = shown('second');
            failStatusLoading(first, 'old error');
            expect(useStatusMessageStore.getState().message).toBe(second);
            failStatusLoading(second, 'failed');
            expect(useStatusMessageStore.getState().message).toMatchObject({ activity: 'error', text: 'failed', activityId: second.activityId });
        });
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
