import React, { useEffect, useRef } from 'react';
import libraryBehavior from './libraryBehavior.probe';
import homeBehavior from './homeBehavior.probe';
import { usePagePonderShortcut } from '../../src/components/ponder/hold/usePagePonderShortcut';
import { openCurrentPagePonder, readCurrentPagePonderTarget } from '../../src/services/ponder/pagePonderTarget';
import { usePonderStore } from '../../src/stores/usePonderStore';
import { useLibrarySuiteStore } from '../../src/library/core/suite/useLibrarySuiteStore';
import type { ProbeDefinition } from './definition';

// dev/probes/pagePonder.probe.tsx：首页/集合/歌手真实 suite 页面上的教程解析与长按入口探针。

declare global {
    interface Window {
        __pagePonderProbe?: {
            target: typeof readCurrentPagePonderTarget;
            open: typeof openCurrentPagePonder;
            session: () => string | null;
            close: () => void;
            fallback: () => void;
        };
    }
}

const PagePonderProbe: React.FC<{ home?: boolean }> = ({ home = false }) => {
    const wipeRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const holdLabelRef = useRef<HTMLSpanElement>(null);
    const { isHolding, targetId } = usePagePonderShortcut({ wipeRef, labelRef, holdLabelRef });
    const Page = home ? homeBehavior.Component : libraryBehavior.Component;

    useEffect(() => {
        usePonderStore.getState().closePonder();
        window.__pagePonderProbe = {
            target: readCurrentPagePonderTarget,
            open: openCurrentPagePonder,
            session: () => usePonderStore.getState().session?.targetId ?? null,
            close: () => usePonderStore.getState().closePonder(),
            // 失效的 suite 选择同样由真实 registry 回退，教程应跟实际画出来的 grid 走。
            fallback: () => useLibrarySuiteStore.getState().setSuite('probe-missing-suite'),
        };
        return () => { delete window.__pagePonderProbe; };
    }, []);

    return <>
        <Page />
        <output data-testid="page-ponder-hold" data-holding={isHolding} data-target={targetId ?? 'none'} />
    </>;
};

export default {
    id: 'pagePonder',
    title: '实际 library suite 页面上的 Ponder',
    description: '复用真实首页与集合探针，覆盖无目标、教程入口与切回网格。',
    Component: PagePonderProbe,
} satisfies ProbeDefinition;
