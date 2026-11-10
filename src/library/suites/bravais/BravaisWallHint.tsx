import React, { type Ref } from 'react';
import type { BravaisWallHint as BravaisWallHintModel } from './bravaisSeamModels';

// src/library/suites/bravais/BravaisWallHint.tsx
// 空墙上的说明（层描述的 wall.hint，文案见 bravaisEmptyWallHint）：在墙面上画一段淡色的大字，当作墙的背景——在两半墙之上、
// 缝之下，不接指针（拖动、点空白处照常落到墙上）。横向区间每帧由 useBravaisFrame 写（缝两侧较宽的那一边，wallHintSpan），
// 这里只管文字与显隐：一直挂着，没有说明时淡出（文字留到淡完），换了一条说明时新文字淡入。

const BravaisWallHint: React.FC<{
    ref?: Ref<HTMLDivElement>;
    /** 此刻要画的说明；淡出途中是上一条。 */
    hint: BravaisWallHintModel | null;
    shown: boolean;
}> = ({ ref, hint, shown }) => (
    <div ref={ref} className="bravais-wall-hint" data-bravais-wall-hint={shown ? 'shown' : 'hidden'} aria-hidden={!shown || undefined}>
        {hint && (
            <div key={`${hint.title}\u0000${hint.body ?? ''}`} className="bravais-wall-hint-text">
                <p className="bravais-wall-hint-title">{hint.title}</p>
                {hint.body && <p className="bravais-wall-hint-body">{hint.body}</p>}
            </div>
        )}
    </div>
);

export default BravaisWallHint;
