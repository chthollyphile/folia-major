import React from 'react';
import { useTranslation } from 'react-i18next';
import { captionWindows, focusFrameBox } from '../../utils/ponder/ponderFocus';
import type { PonderStageScreen } from '../../utils/ponder/ponderStageLayout';
import type { PonderAnchorSource, PonderRect, PonderTimelinePlan } from '../../types/ponder';
import type { PonderStageNodes } from './ponderStageNodes';

// src/components/ponder/PonderFocusFrame.tsx
// The one outline on the picture: it marks what the caption is about and carries that anchor's
// name as a tag. The frame is one node; the lesson timeline (usePonderTimeline) moves it from
// anchor to anchor and shows the tag of the anchor it is on. Here it is only drawn, hidden, with
// one tag for every anchor a caption of this chapter points to.

/** Room a tag needs above the frame, and the width kept for it at the frame's left end, px. */
const TAG_HEIGHT_PX = 22;
const TAG_MAX_WIDTH_PX = 168;

type PonderFocusFrameProps = {
    plan: PonderTimelinePlan;
    rects: Record<string, PonderRect>;
    anchors: Record<string, PonderAnchorSource>;
    nodes: PonderStageNodes;
    /** The screen the picture is drawn on: a tag is kept inside it. */
    screen: PonderStageScreen;
};

const PonderFocusFrame: React.FC<PonderFocusFrameProps> = ({ plan, rects, anchors, nodes, screen }) => {
    const { t } = useTranslation();
    const named = [...new Set(captionWindows(plan).map(window => window.anchor))]
        .filter((anchor): anchor is string => Boolean(anchor && rects[anchor] && anchors[anchor]?.labelKey));

    return (
        <div
            ref={node => { nodes.frame = node; }}
            data-ponder-focus-frame
            className="absolute left-0 top-0 shadow-[0_0_0_2px_var(--st-accent)]"
            style={{ width: 0, height: 0, borderRadius: 0, opacity: 0 }}
        >
            {named.map(anchor => {
                const box = focusFrameBox(rects[anchor]);
                // Above the frame at its left end. Where that would leave the screen: under the frame, and
                // inside its top edge when the frame is as tall as the screen; at its right end.
                const side = box.top - TAG_HEIGHT_PX >= screen.top ? 'bottom-[calc(100%+5px)]'
                    : box.top + box.height + TAG_HEIGHT_PX <= screen.top + screen.height ? 'top-[calc(100%+5px)]'
                    : 'top-2 mx-2.5';
                const atEnd = box.left + TAG_MAX_WIDTH_PX > screen.left + screen.width;
                return (
                    <b
                        key={anchor}
                        ref={node => {
                            if (node) nodes.frameTags.set(anchor, node);
                            else nodes.frameTags.delete(anchor);
                        }}
                        className={`absolute truncate rounded bg-[var(--st-accent)] px-1.5 text-[11px] font-medium leading-[17px] text-[color:var(--st-on-accent)] ${side} ${atEnd ? '-right-0.5' : '-left-0.5'}`}
                        style={{ maxWidth: TAG_MAX_WIDTH_PX, opacity: 0 }}
                    >
                        {t(anchors[anchor].labelKey as string)}
                    </b>
                );
            })}
        </div>
    );
};

export default PonderFocusFrame;
