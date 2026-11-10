import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PonderStageNodes } from './ponderStageNodes';

// src/components/ponder/PonderChapterTimeline.tsx
// The lesson's one timeline: a bar cut into its chapters. The chapter on screen is the wide
// segment; it fills as the chapter plays and carries a dot for each keyframe. A click on a segment
// goes to that chapter, a click on a dot to that keyframe, and a segment under the pointer or the
// keyboard shows its chapter's name. The fill and the dots are written by the lesson timeline
// (usePonderTimeline) through the node table; how the bar looks and moves is in ponder.css.

type PonderChapterTimelineProps = {
    /** The chapters' names, in order. */
    chapters: string[];
    /** The chapter on screen. */
    current: number;
    /** Where each keyframe of that chapter sits, 0..1. */
    ticks: number[];
    nodes: PonderStageNodes;
    onSelectChapter: (index: number) => void;
    onSeekToTick: (index: number) => void;
};

const PonderChapterTimeline: React.FC<PonderChapterTimelineProps> = ({
    chapters,
    current,
    ticks,
    nodes,
    onSelectChapter,
    onSeekToTick,
}) => {
    const { t } = useTranslation();

    return (
        <div className="pd-timeline">
            {chapters.map((name, index) => {
                const isCurrent = index === current;
                const label = `${index + 1} · ${name}`;
                return (
                    <div
                        key={index}
                        className="pd-seg"
                        data-current={isCurrent || undefined}
                        data-past={index < current || undefined}
                    >
                        <button
                            type="button"
                            className="pd-seg-hit"
                            aria-label={label}
                            aria-current={isCurrent ? 'step' : undefined}
                            onClick={() => onSelectChapter(index)}
                        />
                        <span className="pd-seg-track">
                            <i
                                ref={isCurrent ? (node => { nodes.progressFill = node; }) : undefined}
                                data-testid={isCurrent ? 'ponder-progress-fill' : undefined}
                                className="pd-seg-fill"
                            />
                        </span>
                        <span aria-hidden="true" className="pd-seg-tip">{label}</span>
                        {isCurrent && ticks.map((fraction, tick) => (
                            <button
                                key={tick}
                                type="button"
                                ref={node => { nodes.ticks[tick] = node; }}
                                data-testid="ponder-keyframe-tick"
                                className="pd-tick"
                                style={{ left: `max(4px, ${fraction * 100}%)` }}
                                aria-label={t('ponder.seekKeyframe', { index: tick + 1 })}
                                onClick={() => onSeekToTick(tick)}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

export default PonderChapterTimeline;
