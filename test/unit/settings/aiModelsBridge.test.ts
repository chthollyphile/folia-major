// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useAiModels } from '../../../src/components/modal/settings/pages/ai/useAiModels';

// Model discovery follows the current form connection, including unsaved keys.
let root: Root | null = null;
let latest: ReturnType<typeof useAiModels>;
const Probe = ({ payload, saved = false }: { payload: AiConnectionTestPayload; saved?: boolean }) => {
    latest = useAiModels(payload, saved);
    return null;
};
const render = async (payload: AiConnectionTestPayload, saved = false) => {
    root ??= createRoot(document.createElement('div'));
    await act(async () => { root!.render(React.createElement(Probe, { payload, saved })); });
};
const setBridge = (listAiModels: unknown) => { (window as any).electron = { listAiModels }; };
const payload: AiConnectionTestPayload = { provider: 'openai', apiKey: 'draft-key', apiUrl: 'https://one.example/v1' };
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    delete (window as any).electron;
});
describe('model list form state', () => {
    it('passes unsaved settings through the service and allows saved keys without renderer copies', async () => {
        const listAiModels = vi.fn().mockResolvedValue({ ok: true, models: [{ id: 'one', name: 'One' }] });
        setBridge(listAiModels);
        await render({ ...payload, apiKey: '' }, true);
        expect(latest.canLoad).toBe(true);
        await act(async () => { await latest.load(); });
        expect(listAiModels).toHaveBeenCalledWith({ ...payload, apiKey: '' });
        expect(latest.models).toEqual([{ id: 'one', name: 'One' }]);
    });
    it('ignores late replies after the provider or key changes', async () => {
        let resolveOld: (value: AiModelListResult) => void = () => {};
        const listAiModels = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
            .mockResolvedValueOnce({ ok: true, models: [{ id: 'new', name: 'New' }] });
        setBridge(listAiModels);
        await render(payload);
        let old: Promise<void>;
        await act(async () => { old = latest.load(); });
        expect(latest.loading).toBe(true);
        await render({ ...payload, apiKey: 'new-key', apiUrl: 'https://two.example/v1' });
        expect(latest.models).toEqual([]);
        await act(async () => { await latest.load(); });
        await act(async () => {
            resolveOld({ ok: true, models: [{ id: 'old', name: 'Old' }] });
            await old!;
        });
        expect(latest.models).toEqual([{ id: 'new', name: 'New' }]);
        expect(latest.loading).toBe(false);
    });
    it('does not load without a key or compatible API address', async () => {
        const listAiModels = vi.fn();
        setBridge(listAiModels);
        await render({ ...payload, apiKey: '' });
        await act(async () => { await latest.load(); });
        expect(latest.canLoad).toBe(false);
        await render({ ...payload, apiUrl: '' });
        expect(latest.canLoad).toBe(false);
        expect(listAiModels).not.toHaveBeenCalled();
    });
    it('keeps the suggestions of a failed listing until the connection changes', async () => {
        setBridge(vi.fn().mockResolvedValueOnce({ ok: false, errorKind: 'empty', suggestedModels: ['glm-5.2', '', 7] })
            .mockResolvedValueOnce({ ok: true, models: [{ id: 'listed', name: 'Listed' }] }));
        await render(payload);
        await act(async () => { await latest.load(); });
        expect(latest.suggested).toEqual(['glm-5.2']);
        expect(latest.error).toBe('empty');
        await act(async () => { await latest.load(); });
        expect(latest.models).toEqual([{ id: 'listed', name: 'Listed' }]);
        expect(latest.suggested).toEqual([]);
        await render({ ...payload, apiKey: 'changed-key' });
        expect(latest.models).toEqual([]);
    });
    it('keeps a failed fetch retryable and clears errors when connection values change', async () => {
        setBridge(vi.fn().mockRejectedValue(new Error('secret')).mockResolvedValueOnce({ ok: false, errorKind: 'auth' }));
        await render(payload);
        await act(async () => { await latest.load(); });
        expect(latest.error).toBe('auth');
        await act(async () => { await latest.load(); });
        expect(latest.error).toBe('network');
        expect(latest.loading).toBe(false);
        await render({ ...payload, apiKey: 'changed-key' });
        expect(latest.error).toBe(null);
    });
});
