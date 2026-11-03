// src/components/visualizer/pixi/pixiDisplayResources.ts
// Releases renderer-owned data without discarding display trees that must remain seekable.
export interface PixiDisplayNode {
    children?: PixiDisplayNode[];
    visible?: boolean;
    /** Graphics 的 GraphicsContext：大号（不走合批）的 context 各自持有 batcher 与顶点 / 索引缓冲。 */
    context?: { unload?: () => void };
    unload?: () => void;
    destroy?: () => void;
}

export const unloadPixiDisplayTree = (root: PixiDisplayNode) => {
    const stack = [...(root.children ?? [])];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.children?.length) stack.push(...node.children);
        // Graphics.unload() 只放视图自己的批数据，缓冲挂在 context 上，要单独 unload；再画到它时 Pixi 自动重建、重传。
        // 共享的 context 也只是被迫重传一次，不会画错。
        node.context?.unload?.();
        node.unload?.();
    }
};

/** Unloads descendants exactly once when a retained Pixi tree leaves the visible set. */
export const setPixiDisplayTreeVisibility = (root: PixiDisplayNode, visible: boolean) => {
    const wasVisible = root.visible !== false;
    root.visible = visible;
    if (wasVisible && !visible) unloadPixiDisplayTree(root);
};

/**
 * 销毁整棵显示树，Graphics 自建的 GraphicsContext 一并销毁，构造时传进来的共享 context 不动。
 * 不能用 destroy({ children: true })：Container 会把这份选项原样传给子节点，而 Pixi 8 的 Graphics.destroy
 * 只要收到选项对象、却没写 context: true，就不销毁自建的 context，它的 GPU 批数据要等 Pixi 的 GC 空闲 60 秒才收；
 * 写 context: true 又会把共享的 context 一起销毁。所以逐个节点不带参数 destroy()——Graphics 只在这时按归属销毁
 * 自建的 context；其余节点不带参数与 { children: true } 一样，都不动纹理。
 */
export const destroyPixiDisplayTree = (root: PixiDisplayNode) => {
    // 先序收集再倒着销毁：子节点总在父节点之前，父节点 destroy() 时已经没有子节点要处理。
    const order: PixiDisplayNode[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        order.push(node);
        if (node.children?.length) stack.push(...node.children);
    }
    for (let index = order.length - 1; index >= 0; index -= 1) order[index]!.destroy?.();
};

// removeChildren() only detaches nodes; explicitly unload and destroy detached subtrees.
export const destroyPixiContainerChildren = (container: PixiDisplayNode & {
    removeChildren: () => PixiDisplayNode[];
}) => {
    container.removeChildren().forEach(destroyPixiDisplayTree);
};
