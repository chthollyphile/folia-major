import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
    LibraryDirectoryBatchActionId,
    LibraryDirectoryBatchCapabilities,
    LibraryDirectoryBatchConfig,
    LibraryDirectoryBatchContext,
    LibraryDirectoryBatchSnapshot,
} from './directory.contract';
import type { LibraryMutationResult } from '../collection/mutations/mutations.contract';
import { resolveDirectoryBatchCapabilities, runDirectoryBatchAction } from './directoryBatch';

// src/library/core/directory/useLibraryDirectoryActions.ts
// 目录批量动作的绑定：订阅控制器的快照（哪个动作在进行），给出能力（支持哪些动作、此刻能不能对选中的歌动手）
// 与一个 run 入口。面板按钮与命令面板都用这里的 capabilities 与 run，同源、不各自判断。

const IDLE: LibraryDirectoryBatchSnapshot = { pending: null };
const noSubscription = () => () => {};

export const useLibraryDirectoryActions = (
    config: LibraryDirectoryBatchConfig | undefined,
    context: LibraryDirectoryBatchContext,
): {
    capabilities: LibraryDirectoryBatchCapabilities | null;
    run: (action: LibraryDirectoryBatchActionId, arg?: string) => Promise<LibraryMutationResult>;
} => {
    const controller = config?.controller;
    const snapshot = useSyncExternalStore(
        controller ? controller.subscribe : noSubscription,
        controller ? controller.getSnapshot : () => IDLE,
    );
    const capabilities = useMemo(
        () => (config ? resolveDirectoryBatchCapabilities(config, context, snapshot.pending) : null),
        [config, context, snapshot.pending],
    );
    const run = useCallback((action: LibraryDirectoryBatchActionId, arg?: string) => (
        config
            ? runDirectoryBatchAction(config, action, context, arg)
            : Promise.resolve<LibraryMutationResult>({ ok: false, reason: 'unsupported' })
    ), [config, context]);

    return { capabilities, run };
};
