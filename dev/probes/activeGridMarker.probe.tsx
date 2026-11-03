import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ActiveGridMarker from '../../src/library/suites/grid/shared/ActiveGridMarker';
import type { ProbeDefinition } from './definition';
// dev/probes/activeGridMarker.probe.tsx

/**
 * 「哪一层网格是当前那层」这个标记本身。移形换影的测量靠它把范围关在活动网格里 ——
 * 出栈的旧网格在退出动画期间还留在 DOM 里、卡片属性一模一样，不限范围就会量到旧网格的
 * 卡片，飞行目标就飞到上一页去了。
 *
 * 这里挂的是真实机制：AnimatePresence + useIsPresent + 标记元素，只不过网格是假的两块
 * 方块。要看的是「两层同时在 DOM 里时，标记只在一层里，而且是新的那层」。
 */

const FakeGrid: React.FC<{ label: string; color: string }> = ({ label, color }) => {
    return (
        <motion.div
            data-probe-grid={label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.8, ease: 'linear' } }}
            style={{
                position: 'fixed',
                left: 0,
                top: 120,
                width: 400,
                height: 300,
                background: color,
                color: '#fff',
                fontSize: 20,
                padding: 16,
            }}
        >
            <ActiveGridMarker />
            {label}
        </motion.div>
    );
};

const ActiveGridMarkerProbe: React.FC = () => {
    const [level, setLevel] = React.useState(0);
    const colors = ['#1971c2', '#2f9e44', '#e8590c'];

    return (
        <div className="min-h-screen bg-zinc-900 p-8 text-zinc-200">
            <button
                type="button"
                data-probe-action="push"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold"
                onClick={() => setLevel(value => value + 1)}
            >
                推入下一层网格
            </button>
            <p className="mt-3 text-xs text-zinc-400">
                当前层：<span data-probe-level={level}>{level}</span>
                {' · '}断言写在 spec 里，直接从 DOM 查标记与网格数量（渲染期读 DOM 只会读到上一帧）。
            </p>

            <AnimatePresence initial={false}>
                <FakeGrid key={level} label={`grid-${level}`} color={colors[level % colors.length]} />
            </AnimatePresence>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'activeGridMarker',
    title: '活动网格标记（移形换影的测量范围）',
    description: '两层网格同时在 DOM 里时，data-folia-active-grid 只落在正在进入的那一层上。',
    Component: ActiveGridMarkerProbe,
};

export default definition;
