import React from 'react';
import type { LibrarySuiteStageProps } from '../core/suite/suite.contract';
import type { ResolvedLibraryStage } from '../registry';
import { useLibraryPlayerOcclusionReporter } from './useLibraryPlayerOcclusionReporter';

// src/library/app/LibrarySuiteStageSlot.tsx
// 集合宿主里 stage 的挂载位（B1）：只挂生效 suite 的 stage（registry.resolveLibraryStage 的结果），没有就什么都不渲染，
// 也就不会触发任何 lazy chunk。Suspense 按 suite 加 key：换成另一套带 stage 的 suite 时重挂，同一套 suite 下
// 打开 / 关闭集合（navigation 变化）只是换 props，不重挂。
// B6b：reportPlayerOcclusion 由挂载位提供（见 useLibraryPlayerOcclusionReporter），挂载位卸载、换 suite 时自动复位；
// reportPlayerBackdrop（透出画面的歌词 / 模糊）同一个持有者、同样复位。

type LibrarySuiteStageSlotProps = Omit<LibrarySuiteStageProps, 'reportPlayerOcclusion' | 'reportPlayerBackdrop'> & {
    stage: ResolvedLibraryStage | null;
};

const LibrarySuiteStageSlot: React.FC<LibrarySuiteStageSlotProps> = ({ stage, ...stageProps }) => {
    const { reportPlayerOcclusion, reportPlayerBackdrop } = useLibraryPlayerOcclusionReporter(stage?.suiteId ?? null);
    if (!stage) return null;
    const Stage = stage.component;
    return (
        <React.Suspense key={stage.suiteId} fallback={null}>
            <Stage {...stageProps} reportPlayerOcclusion={reportPlayerOcclusion} reportPlayerBackdrop={reportPlayerBackdrop} />
        </React.Suspense>
    );
};

// 宿主随首页数据频繁重渲染；props 不变时不必让整面墙跟着重渲染。
export default React.memo(LibrarySuiteStageSlot);
