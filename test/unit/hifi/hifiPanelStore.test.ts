import { afterEach, describe, expect, it } from 'vitest';
import { closeHifiSignalPath, openHifiSignalPath, useHifiPanelStore } from '../../../src/components/hifi/hifiPanelStore';

// test/unit/hifi/hifiPanelStore.test.ts
// 信号链路面板的开关：模块级的 open / close 和 store 自己的方法改的是同一份状态。

afterEach(() => {
    closeHifiSignalPath();
});

describe('hifiPanelStore', () => {
    it('starts closed', () => {
        expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(false);
    });

    it('opens and closes through the module-level helpers and the store methods alike', () => {
        openHifiSignalPath();
        expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(true);
        useHifiPanelStore.getState().closeSignalPath();
        expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(false);
        useHifiPanelStore.getState().openSignalPath();
        closeHifiSignalPath();
        expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(false);
    });
});
