type SonnetDisplayNode = {
    children?: SonnetDisplayNode[];
    unload?: () => void;
    destroy?: (options?: { children?: boolean }) => void;
};

// Release GPU-side data while keeping the display tree reusable for a later seek.
export const unloadSonnetDisplayTree = (root: SonnetDisplayNode) => {
    const stack = [...(root.children ?? [])];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.children?.length) stack.push(...node.children);
        node.unload?.();
    }
};

// removeChildren() only detaches nodes; explicitly destroy them when rebuilding overlays.
export const destroySonnetContainerChildren = (container: SonnetDisplayNode & {
    removeChildren: () => SonnetDisplayNode[];
}) => {
    const children = container.removeChildren();
    children.forEach(child => {
        unloadSonnetDisplayTree(child);
        child.unload?.();
        child.destroy?.({ children: true });
    });
};
