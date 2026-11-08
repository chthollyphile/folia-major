import { beforeEach, describe, expect, it } from 'vitest';
import { selectWallLocate, useBottomDockStore } from '../../../src/stores/useBottomDockStore';

// test/unit/stores/bottomDockStore.test.ts
// progress-bar v3 底部那一排的离散状态：挂件按登记者记、墙定位动作最后登记的生效、更新不改顺序。

const action = (title: string) => ({ run: () => undefined, isHere: false, isSeeking: false, title });

describe('useBottomDockStore', () => {
    beforeEach(() => {
        useBottomDockStore.setState({ companions: {}, openCompanions: {}, wallLocates: [], capsule: 'none' });
    });

    it('counts companions per owner and ignores repeated registration', () => {
        const store = useBottomDockStore.getState();
        store.setCompanion('panel-toggle', true);
        const first = useBottomDockStore.getState().companions;
        store.setCompanion('panel-toggle', true);
        expect(useBottomDockStore.getState().companions).toBe(first);
        store.setCompanion('wall-tools:bravais-tools', true);
        expect(Object.keys(useBottomDockStore.getState().companions)).toHaveLength(2);
        store.setCompanion('panel-toggle', false);
        expect(Object.keys(useBottomDockStore.getState().companions)).toEqual(['wall-tools:bravais-tools']);
    });

    it('uses the wall that registered its locate action last', () => {
        const store = useBottomDockStore.getState();
        store.setWallLocate('bravais', action('bravais'));
        store.setWallLocate('lattice', action('lattice'));
        expect(selectWallLocate(useBottomDockStore.getState())?.title).toBe('lattice');
        store.setWallLocate('lattice', null);
        expect(selectWallLocate(useBottomDockStore.getState())?.title).toBe('bravais');
    });

    it('updates a registered wall in place without moving it to the top', () => {
        const store = useBottomDockStore.getState();
        store.setWallLocate('bravais', action('bravais'));
        store.setWallLocate('lattice', action('lattice'));
        store.setWallLocate('bravais', { ...action('bravais'), isHere: true });
        expect(selectWallLocate(useBottomDockStore.getState())?.title).toBe('lattice');
    });

    it('ignores a withdrawal from a wall that never registered', () => {
        const before = useBottomDockStore.getState();
        before.setWallLocate('lattice', null);
        expect(useBottomDockStore.getState()).toBe(before);
    });
});
