import { describe, expect, it, vi } from 'vitest';
import {
    destroySonnetContainerChildren,
    unloadSonnetDisplayTree,
} from '@/components/visualizer/sonnet/sonnetPixiResources';

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
        const unload = vi.fn();
        const destroy = vi.fn();
        const removeChildren = vi.fn(() => [{ unload, destroy }]);

        destroySonnetContainerChildren({ removeChildren });

        expect(unload).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledWith({ children: true });
    });
});
