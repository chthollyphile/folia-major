import { useEffect, useRef, useState } from 'react';
import type { LyricData } from '../../types';
import { resolveRemoteLyricLine, type RemoteLyricLine } from './remoteLyricLine';
import type { RemoteClock } from './useRemoteClock';

// src/components/remote/useRemoteLyricLine.ts
// Which lyric line the remote window shows now. Read from the running clock every frame, but it
// only becomes React state when the line changes. The rule itself is in remoteLyricLine.ts.

export const useRemoteLyricLine = (
    lyrics: LyricData | null | undefined,
    clock: RemoteClock,
    /** The main window's lyric offset, in seconds: the lyric reads the clock this much earlier. */
    lyricOffsetSec: number,
): RemoteLyricLine => {
    const [shown, setShown] = useState<RemoteLyricLine>(() => resolveRemoteLyricLine(lyrics, clock.getTime() - lyricOffsetSec));
    const shownRef = useRef(shown);

    useEffect(() => {
        const update = () => {
            const next = resolveRemoteLyricLine(lyrics, clock.getTime() - lyricOffsetSec);
            const previous = shownRef.current;
            if (previous.line === next.line && previous.nextLine === next.nextLine && previous.isSinging === next.isSinging) {
                return;
            }
            shownRef.current = next;
            setShown(next);
        };

        update();
        return clock.subscribe(update);
    }, [lyrics, clock, lyricOffsetSec]);

    return shown;
};
