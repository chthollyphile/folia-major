import React from 'react';
import { useCursorAutoHide } from '../../src/hooks/useCursorAutoHide';
import type { ProbeDefinition } from './definition';
// dev/probes/cursorAutoHide.probe.tsx

const HIDE_DELAY_MS = 200;

/**
 * 指针按住不放时不应隐藏：只有真实 pointerdown/up 时序才能复现，单测盖不住。
 * delay 压到 200ms，避免组件测试空等产品默认的 1200ms。
 */
const CursorAutoHideProbe: React.FC = () => {
    const hidden = useCursorAutoHide(true, { delay: HIDE_DELAY_MS });

    return (
        <div
            className={`flex min-h-screen items-center justify-center${hidden ? ' cursor-auto-hidden' : ''}`}
            data-probe-cursor-hidden={hidden ? 'yes' : 'no'}
            data-probe-cursor-delay={HIDE_DELAY_MS}
        >
            hold
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'cursorAutoHide',
    title: '播放页指针自动隐藏',
    description: '空闲后隐藏指针；按住不放时保持可见。',
    Component: CursorAutoHideProbe,
};

export default definition;
