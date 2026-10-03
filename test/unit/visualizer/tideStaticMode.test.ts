import React from 'react';
import { motionValue } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@/services/baseThemes';
import type { AudioBands } from '@/types';
import type { VisualizerBackgroundRenderProps } from '@/components/visualizer/backgrounds/definition';
import tideEntry from '@/components/visualizer/backgrounds/tide/entry';

// test/unit/visualizer/tideStaticMode.test.ts
// 静态模式（关闭首页动态背景 / 全局静帧）必须一路传到 tide 运行时：入口不吃 staticMode，
// 流体就会在静态页面上继续逐帧步进。这里锁住「入口 → TideBackground」这条接线；
// 循环本身的停/启在 useTideRuntime（无法在 node 环境跑 WebGL）里由同一标志驱动。

const createAudioBands = (): AudioBands => ({
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
});

const renderTideChild = (staticMode: boolean): React.ReactElement<{ staticMode?: boolean }> => {
    const props = {
        config: { mode: 'tide' },
        theme: DEFAULT_THEME,
        isDaylight: false,
        audioPower: motionValue(0),
        audioBands: createAudioBands(),
        staticMode,
        paused: false,
    } as unknown as VisualizerBackgroundRenderProps;

    const element = tideEntry.render(props) as React.ReactElement<{
        children: React.ReactElement<{ staticMode?: boolean }>;
    }>;

    return element.props.children;
};

describe('tide static mode', () => {
    it('forwards the shell staticMode flag to TideBackground', () => {
        expect(renderTideChild(true).props.staticMode).toBe(true);
        expect(renderTideChild(false).props.staticMode).toBe(false);
    });
});
