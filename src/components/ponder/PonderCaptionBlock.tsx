import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PonderTimelinePlan } from '../../types/ponder';
import { ponderSwapMotion } from './ponderMotion';
import { ponderModifierLabel } from './PonderKeyCap';
import type { PonderStageNodes } from './ponderStageNodes';

// src/components/ponder/PonderCaptionBlock.tsx
// The words of the stage, in one fixed place under the transport: the chapter line ("1 / 5" and
// the chapter's name) and under it the caption. Every caption of the chapter is drawn here once,
// hidden, one over the other; the lesson timeline shows the one that is being said. What belongs
// to the chapter and not to a caption sits at the right: the way straight to the setting the
// chapter is about, and under it the offer of the next chapter.

type PonderCaptionBlockProps = {
    sceneIndex: number;
    sceneCount: number;
    sceneTitle: string;
    plan: PonderTimelinePlan;
    nodes: PonderStageNodes;
    calm: boolean;
    /** The chapter's "go there" entry; null when it has none. */
    actionLabel: string | null;
    onRunAction: () => void;
    /** What the end of the chapter offers: the next chapter, or the line after the last one. */
    cue?: React.ReactNode;
};

const PonderCaptionBlock: React.FC<PonderCaptionBlockProps> = ({
    sceneIndex,
    sceneCount,
    sceneTitle,
    plan,
    nodes,
    calm,
    actionLabel,
    onRunAction,
    cue,
}) => {
    const { t } = useTranslation();

    return (
        <div className="mt-2.5 flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="min-w-0 flex-[1_1_320px]">
                {/* The old chapter's line leaves upward before the new one rises in. */}
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={sceneIndex}
                        {...ponderSwapMotion(calm)}
                        className="h-6 truncate text-xs leading-6 text-[color:var(--st-t2)]"
                    >
                        <b className="mr-2.5 font-medium tabular-nums text-[color:var(--st-t1)]">
                            {t('ponder.sceneCounter', { current: sceneIndex + 1, total: sceneCount })}
                        </b>
                        {sceneTitle}
                    </motion.div>
                </AnimatePresence>
                <div aria-hidden="true" className="mt-0.5 grid text-[17px] leading-[26px] text-[color:var(--st-t1)]">
                    {plan.entries.map(({ step }) => (step.kind === 'caption' ? (
                        <div
                            key={step.id}
                            ref={node => {
                                if (node) nodes.captions.set(step.id, node);
                                else nodes.captions.delete(step.id);
                            }}
                            data-ponder-caption
                            className="[grid-area:1/1]"
                            style={{ opacity: 0 }}
                        >
                            {t(step.textKey, { mod: ponderModifierLabel })}
                        </div>
                    ) : null))}
                </div>
            </div>
            {/* Always there, so a caption has the same width with and without something beside it. */}
            <div className="flex w-[280px] max-w-full flex-none flex-col items-end gap-2.5">
                {actionLabel && (
                    // These settings are known for being hard to find; that is why the chapter exists.
                    <button
                        type="button"
                        key={sceneIndex}
                        data-testid="ponder-scene-action"
                        onClick={onRunAction}
                        className="pd-fade-in pd-t-quick -mr-1.5 inline-flex h-6 max-w-full items-center gap-1.5 rounded-md pl-2 pr-1.5 text-xs text-[color:var(--st-t1)] transition-colors hover:bg-[var(--st-fill)]"
                    >
                        <SlidersHorizontal size={14} className="flex-none text-[color:var(--st-t2)]" />
                        <span className="truncate">{actionLabel}</span>
                        <ChevronRight size={12} className="flex-none text-[color:var(--st-t2)]" />
                    </button>
                )}
                {cue}
            </div>
        </div>
    );
};

export default PonderCaptionBlock;
