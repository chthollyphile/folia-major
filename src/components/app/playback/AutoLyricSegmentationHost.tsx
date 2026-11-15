import { memo } from 'react';
import { useAutoLyricSegmentation, type UseAutoLyricSegmentationParams } from '../../../hooks/useAutoLyricSegmentation';

// src/components/app/playback/AutoLyricSegmentationHost.tsx
// Runs 自动 AI 分词 (useAutoLyricSegmentation) in a component of its own that draws nothing. The hook
// follows the saved segmentation record, which is cleared and loaded again on every song change;
// called from App, each of those changes re-rendered the whole app for a value App never reads.

/** Mounted once by App; renders nothing. */
export const AutoLyricSegmentationHost = memo(function AutoLyricSegmentationHost(props: UseAutoLyricSegmentationParams) {
    useAutoLyricSegmentation(props);
    return null;
});
