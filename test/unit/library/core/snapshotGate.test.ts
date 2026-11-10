import { describe, expect, it } from 'vitest';
import { createSnapshotGate, type GateApplyMode } from '@/library/core/shared/snapshotGate';
import { resolveReloadCapability, resolveScopeCapability } from '@/library/core/collection/collectionCapabilities';

// test/unit/library/core/snapshotGate.test.ts
// 快照门：紧急更新立即提交，后台更新走 transition；拖拽中暂存最新的一份，放手再提交。
// 展示保持：按住期间一切更新（紧急的也算）只留最新的一份，最后一个 token 放开时提交。
// 能力判定：重新拉取只给能分页的在线集合；空范围要说明是在加载还是确实没有。

type Snap = { id: number; hint: 'urgent' | 'background' };

const gateWith = (holding: { value: boolean }) => {
    const applied: Array<[number, GateApplyMode]> = [];
    const gate = createSnapshotGate<Snap>({
        hold: () => holding.value,
        apply: (snapshot, mode) => applied.push([snapshot.id, mode]),
    });
    return { gate, applied };
};

describe('snapshot gate', () => {
    it('applies urgent updates synchronously and background ones as transitions', () => {
        const { gate, applied } = gateWith({ value: false });
        gate.offer({ id: 1, hint: 'urgent' });
        gate.offer({ id: 2, hint: 'background' });
        expect(applied).toEqual([[1, 'sync'], [2, 'transition']]);
    });

    it('holds only the latest background update while holding, and releases it on flush', () => {
        const holding = { value: true };
        const { gate, applied } = gateWith(holding);
        gate.offer({ id: 1, hint: 'background' });
        gate.offer({ id: 2, hint: 'background' });
        expect(applied).toEqual([]);
        expect(gate.hasHeld()).toBe(true);

        holding.value = false;
        gate.flush();
        gate.flush();
        expect(applied).toEqual([[2, 'transition']]);
    });

    it('lets an urgent update through while holding and drops the held page', () => {
        const { gate, applied } = gateWith({ value: true });
        gate.offer({ id: 1, hint: 'background' });
        gate.offer({ id: 2, hint: 'urgent' });
        gate.flush();
        expect(applied).toEqual([[2, 'sync']]);
    });
});

describe('snapshot gate: presentation hold', () => {
    it('holds every update, urgent included, and commits only the latest when released', () => {
        const { gate, applied } = gateWith({ value: false });
        gate.holdPresentation('remove:a');
        gate.offer({ id: 1, hint: 'urgent' });
        gate.offer({ id: 2, hint: 'background' });
        gate.offer({ id: 3, hint: 'background' });
        expect(applied).toEqual([]);
        expect(gate.isPresentationHeld()).toBe(true);

        gate.releasePresentation('remove:a');
        // 最新的那份赢；期间到过紧急更新，所以同步提交。
        expect(applied).toEqual([[3, 'sync']]);
        expect(gate.isPresentationHeld()).toBe(false);
        expect(gate.hasHeld()).toBe(false);
    });

    it('releases background-only updates as a transition, and nothing when nothing arrived', () => {
        const { gate, applied } = gateWith({ value: false });
        gate.holdPresentation('t');
        gate.releasePresentation('t');
        expect(applied).toEqual([]);

        gate.holdPresentation('t');
        gate.offer({ id: 1, hint: 'background' });
        gate.releasePresentation('t');
        expect(applied).toEqual([[1, 'transition']]);
    });

    it('keeps holding until the last token is released; repeated and unknown tokens are harmless', () => {
        const { gate, applied } = gateWith({ value: false });
        gate.holdPresentation('a');
        gate.holdPresentation('a');
        gate.holdPresentation('b');
        gate.offer({ id: 1, hint: 'urgent' });
        gate.releasePresentation('a');
        gate.releasePresentation('unknown');
        expect(applied).toEqual([]);
        expect(gate.isPresentationHeld()).toBe(true);

        gate.offer({ id: 2, hint: 'urgent' });
        gate.releasePresentation('b');
        gate.releasePresentation('b');
        expect(applied).toEqual([[2, 'sync']]);
    });

    it('a drag flush does not break a presentation hold', () => {
        const holding = { value: true };
        const { gate, applied } = gateWith(holding);
        gate.holdPresentation('t');
        gate.offer({ id: 1, hint: 'background' });
        holding.value = false;
        gate.flush();
        expect(applied).toEqual([]);
        gate.releasePresentation('t');
        expect(applied).toEqual([[1, 'transition']]);
    });

    it('hands background pages back to the drag hold when released mid-drag, but lets urgent ones through', () => {
        const holding = { value: true };
        const { gate, applied } = gateWith(holding);
        gate.holdPresentation('t');
        gate.offer({ id: 1, hint: 'background' });
        gate.releasePresentation('t');
        // 还在拖：后台页继续暂存，松手 flush 时再提交。
        expect(applied).toEqual([]);
        expect(gate.hasHeld()).toBe(true);
        holding.value = false;
        gate.flush();
        expect(applied).toEqual([[1, 'transition']]);

        holding.value = true;
        gate.holdPresentation('t');
        gate.offer({ id: 2, hint: 'urgent' });
        gate.offer({ id: 3, hint: 'background' });
        gate.releasePresentation('t');
        expect(applied).toEqual([[1, 'transition'], [3, 'sync']]);
    });

    it('a page held by the drag before the presentation hold is superseded by later updates', () => {
        const holding = { value: true };
        const { gate, applied } = gateWith(holding);
        gate.offer({ id: 1, hint: 'background' });
        gate.holdPresentation('t');
        gate.offer({ id: 2, hint: 'urgent' });
        holding.value = false;
        gate.releasePresentation('t');
        gate.flush();
        expect(applied).toEqual([[2, 'sync']]);
    });
});

describe('collection capabilities', () => {
    it('offers reload only for pageable online collections, disabled while loading', () => {
        expect(resolveReloadCapability({ kind: 'online', status: 'ready', collectionType: 'playlist' }))
            .toEqual({ supported: true, enabled: true, pending: false });
        expect(resolveReloadCapability({ kind: 'online', status: 'loading', collectionType: 'playlist' }))
            .toEqual({ supported: true, enabled: false, pending: true, reason: 'loading' });
        for (const input of [
            { kind: 'online' as const, collectionType: 'daily_recommendations' },
            { kind: 'online' as const, collectionType: 'radio' },
            { kind: 'navidrome' as const, collectionType: 'album' },
            { kind: 'static' as const, collectionType: 'folder' },
        ]) {
            expect(resolveReloadCapability({ ...input, status: 'ready' }).supported).toBe(false);
        }
    });

    it('tells an empty scope apart from one that is still loading', () => {
        expect(resolveScopeCapability({ scopeCount: 3, status: 'loading' }).enabled).toBe(true);
        expect(resolveScopeCapability({ scopeCount: 0, status: 'idle' })).toMatchObject({ enabled: false, reason: 'loading' });
        expect(resolveScopeCapability({ scopeCount: 0, status: 'ready' })).toMatchObject({ enabled: false, reason: 'empty' });
    });
});
