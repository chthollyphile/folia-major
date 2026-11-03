import { describe, expect, it, vi } from 'vitest';
import {
    destroySonnetContainerChildren,
    unloadSonnetDisplayTree,
} from '@/components/visualizer/sonnet/sonnetPixiResources';
import { setPixiDisplayTreeVisibility } from '@/components/visualizer/pixi/pixiDisplayResources';

describe('Sonnet Pixi resource lifecycle', () => {
    it('unloads every renderable in a retained shot tree', () => {
        const leafUnload = vi.fn();
        const branchUnload = vi.fn();
        const root = {
            children: [{ unload: branchUnload, children: [{ unload: leafUnload }] }],
        };

        unloadSonnetDisplayTree(root);

        expect(branchUnload).toHaveBeenCalledOnce();
        expect(leafUnload).toHaveBeenCalledOnce();
    });

    it('destroys detached overlay children instead of merely removing them', () => {
        const leafDestroy = vi.fn();
        const destroy = vi.fn();
        const removeChildren = vi.fn(() => [{ destroy, children: [{ destroy: leafDestroy }] }]);

        destroySonnetContainerChildren({ removeChildren });

        // 逐节点、不带参数销毁（Graphics 只有这样才按归属放掉自建的 context），子节点先于父节点。
        expect(leafDestroy).toHaveBeenCalledWith();
        expect(destroy).toHaveBeenCalledWith();
        expect(leafDestroy.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]!);
    });

    it('unloads retained descendants only when their tree becomes hidden', () => {
        const unload = vi.fn();
        const root = { visible: true, children: [{ unload }] };

        setPixiDisplayTreeVisibility(root, true);
        expect(unload).not.toHaveBeenCalled();

        setPixiDisplayTreeVisibility(root, false);
        expect(unload).toHaveBeenCalledOnce();

        setPixiDisplayTreeVisibility(root, false);
        expect(unload).toHaveBeenCalledOnce();

        setPixiDisplayTreeVisibility(root, true);
        expect(root.visible).toBe(true);
        expect(unload).toHaveBeenCalledOnce();
    });
});
