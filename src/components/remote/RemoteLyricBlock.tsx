import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Line, SubtitleContentMode } from '../../types';
import type { RemoteLyricLayout } from '../../types/remoteControl';
import {
    buildRemoteLyricSegments,
    REMOTE_LYRIC_IDLE_MAX_HEIGHT,
    resolveRemoteLyricFit,
    resolveRemoteLyricRows,
    resolveRemoteUpcomingFit,
    resolveRemoteUpcomingHeight,
    type RemoteLyricRows,
    type RemoteLyricSegment,
} from './remoteLyricText';
import type { RemoteClock } from './useRemoteClock';

// src/components/remote/RemoteLyricBlock.tsx
// The remote window's lyric: the line being sung, large, and one quiet line under it (its
// translation, its romanization, or the next line), as the rows set on the remote window's settings
// page say. With two pairs set, the next line and its small row stand at the bottom right while the
// window is idle, across from the first pair. The word-by-word fill is written straight to the DOM
// from the running clock; React only renders when the line changes.

const LARGE_LINE_HEIGHT_PX = 26;
const WHITESPACE_ONLY = /^\s+$/;
/** How long a pair takes to leave. */
const EXIT_SEC = 0.18;
/** The exit starts on the next frame: the pair is swapped one frame after it has gone. */
const FRAME_MS = 20;

const getLineKey = (line: Line) => `${line.startTime}-${line.endTime}-${line.fullText}`;

type RemoteLyricLineProps = {
    line: Line;
    texts: RemoteLyricRows;
    /** Two pairs are set: the second line keeps to one line, and the next pair has room under it. */
    twoPairs: boolean;
    clock: RemoteClock;
    lyricOffsetSec: number;
    /** The switch "text shade" with the transparent background: the pieces mark themselves for the shade to cover. */
    shade: boolean;
};

const renderSegments = (
    segments: RemoteLyricSegment[],
    line: Line,
    setNode?: (index: number, node: HTMLSpanElement | null) => void,
) => {
    if (segments.length === 0) {
        // 只按行计时的歌词：整行都是唱到的颜色。
        return <span className="remote-lyric__whole">{line.fullText}</span>;
    }

    return segments.map((segment, index) => {
        if (!segment.timed && WHITESPACE_ONLY.test(segment.text)) {
            return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }
        return (
            <span
                key={index}
                ref={setNode ? node => setNode(index, node) : undefined}
                className={segment.timed ? 'remote-lyric__word' : 'remote-lyric__gap'}
            >
                {segment.text}
            </span>
        );
    });
};

/** One line with what goes under it. Owns its fill, so a line that is leaving keeps the fill it had. */
const RemoteLyricLine: React.FC<RemoteLyricLineProps> = ({ line, texts, twoPairs, clock, lyricOffsetSec, shade }) => {
    // A large row showing the translation or the romanization has nothing to fill: it is drawn whole.
    const heroText = texts.hero?.text ?? null;
    const segments = useMemo(() => (heroText === null ? buildRemoteLyricSegments(line) : []), [line, heroText]);
    const nodesRef = useRef<Array<HTMLSpanElement | null>>([]);
    const measureRef = useRef<HTMLDivElement | null>(null);
    const [mainLinesAtLarge, setMainLinesAtLarge] = useState(1);

    // The fit rule needs to know how many lines the lyric takes at the large size: measured once
    // per line, on a hidden copy with the same pieces and without the two-line cut.
    useLayoutEffect(() => {
        const height = measureRef.current?.offsetHeight ?? 0;
        const lines = Math.max(1, Math.round(height / LARGE_LINE_HEIGHT_PX));
        setMainLinesAtLarge(previous => (previous === lines ? previous : lines));
    }, [segments, line.fullText, heroText]);

    useEffect(() => {
        const painted: number[] = [];
        const paint = () => {
            const time = clock.getTime() - lyricOffsetSec;
            segments.forEach((segment, index) => {
                const node = nodesRef.current[index];
                if (!node) {
                    return;
                }

                const span = segment.endTime - segment.startTime;
                const fill = segment.timed && span > 0
                    ? Math.round(Math.max(0, Math.min(1, (time - segment.startTime) / span)) * 1000) / 10
                    : (time >= segment.startTime ? 100 : 0);
                if (painted[index] === fill) {
                    return;
                }
                painted[index] = fill;
                node.style.setProperty('--remote-fill', `${fill}%`);
            });
        };

        paint();
        return clock.subscribe(paint);
    }, [segments, clock, lyricOffsetSec]);

    const fit = resolveRemoteLyricFit({
        mainLinesAtLarge,
        hasRomanization: Boolean(texts.romanization),
        hasSecond: Boolean(texts.second),
        secondOnOneLine: twoPairs,
    });
    const upcomingRows = texts.upcoming ? resolveRemoteUpcomingFit(fit, Boolean(texts.upcoming.sub)) : null;

    // Without the shade the attribute is left out altogether.
    const shadeMark = shade ? '' : undefined;

    return (
        <>
            <div ref={measureRef} className="remote-lyric__hero remote-lyric__measure" aria-hidden>
                {heroText === null ? renderSegments(segments, line) : heroText}
            </div>
            <div className="remote-lyric__hero" data-size={fit.size} data-kind={texts.hero?.kind} data-remote-shade={shadeMark}>
                {heroText === null
                    ? renderSegments(segments, line, (index, node) => {
                        nodesRef.current[index] = node;
                    })
                    : <span className="remote-lyric__whole">{heroText}</span>}
            </div>
            {fit.showRomanization && texts.romanization && (
                <div className="remote-lyric__roma" data-remote-shade={shadeMark}>{texts.romanization}</div>
            )}
            {texts.second && fit.secondMaxLines > 0 && (
                <div
                    className="remote-lyric__sub"
                    data-kind={texts.second.kind}
                    data-lines={fit.secondMaxLines}
                    data-remote-shade={shadeMark}
                >
                    {texts.second.text}
                </div>
            )}
            {texts.upcoming && upcomingRows?.main && (
                // Bottom right of the idle block, across from the line being sung. Shown only idle (remote.css).
                <div
                    className="remote-lyric__upcoming"
                    style={{ top: REMOTE_LYRIC_IDLE_MAX_HEIGHT - resolveRemoteUpcomingHeight(upcomingRows) }}
                >
                    <div className="remote-lyric__upcoming-main" data-remote-shade={shadeMark}>{texts.upcoming.main}</div>
                    {upcomingRows.sub && texts.upcoming.sub && (
                        <div className="remote-lyric__upcoming-sub" data-remote-shade={shadeMark}>{texts.upcoming.sub}</div>
                    )}
                </div>
            )}
        </>
    );
};

type ShownPair = {
    line: Line;
    nextLine: Line | null;
    isSinging: boolean;
};

type RemoteLyricBlockProps = {
    line: Line | null;
    nextLine: Line | null;
    /** False in a gap inside the song: the last line stays, dimmed. */
    isSinging: boolean;
    subtitleContentMode: SubtitleContentMode;
    /** The rows set on the remote window's settings page. */
    layout: RemoteLyricLayout;
    clock: RemoteClock;
    lyricOffsetSec: number;
    reduceMotion: boolean;
    /** The switch "text shade" with the transparent background. */
    shade: boolean;
};

const RemoteLyricBlock: React.FC<RemoteLyricBlockProps> = ({
    line,
    nextLine,
    isSinging,
    subtitleContentMode,
    layout,
    clock,
    lyricOffsetSec,
    reduceMotion,
    shade,
}) => {
    // The pair on screen. While it leaves it keeps what it had; once it is gone the latest line
    // comes in, whichever lines came and went meanwhile. A line that comes back while its pair is
    // leaving turns the pair round.
    const [shown, setShown] = useState<ShownPair | null>(() => (line ? { line, nextLine, isSinging } : null));
    const isSameLine = Boolean(shown && line && getLineKey(shown.line) === getLineKey(line));
    const isLeaving = Boolean(shown) && !isSameLine;
    if (isSameLine && (shown!.line !== line || shown!.nextLine !== nextLine || shown!.isSinging !== isSinging)) {
        setShown({ line: line!, nextLine, isSinging });
    } else if (!shown && line) {
        // Nothing is leaving: the new pair comes in at once.
        setShown({ line, nextLine, isSinging });
    }

    const latestRef = useRef<ShownPair | null>(null);
    useEffect(() => {
        latestRef.current = line ? { line, nextLine, isSinging } : null;
    });
    // A timer, not the animation's end, swaps the pair: nothing can hold it.
    useEffect(() => {
        if (!isLeaving) {
            return;
        }
        const timer = window.setTimeout(() => setShown(latestRef.current), (reduceMotion ? 0 : EXIT_SEC * 1000) + FRAME_MS);
        return () => window.clearTimeout(timer);
    }, [isLeaving, reduceMotion]);

    const hasMountedRef = useRef(false);
    useEffect(() => {
        hasMountedRef.current = true;
    }, []);

    const texts = useMemo(
        () => resolveRemoteLyricRows(layout, subtitleContentMode, shown?.line, shown?.nextLine),
        [layout, subtitleContentMode, shown],
    );
    const rise = reduceMotion ? 0 : 6;

    return (
        <div className="remote-lyric" data-shown={Boolean(line)}>
            {/* 换行：旧的一对先淡出并上移 6px，走完之后新的一对再从下方 6px 进来。两句不叠在一起。 */}
            {shown && (
                <motion.div
                    key={getLineKey(shown.line)}
                    className="remote-lyric__pair"
                    data-dim={!shown.isSinging}
                    initial={hasMountedRef.current ? { opacity: 0, y: rise } : false}
                    animate={isLeaving
                        ? {
                            opacity: 0,
                            y: -rise,
                            transition: { duration: reduceMotion ? 0 : EXIT_SEC, ease: 'easeIn' },
                        }
                        : {
                            opacity: 1,
                            y: 0,
                            transition: { duration: reduceMotion ? 0 : 0.26, ease: [0.2, 0.8, 0.2, 1] },
                        }}
                >
                    <RemoteLyricLine line={shown.line} texts={texts} twoPairs={layout.pairs === 2} clock={clock} lyricOffsetSec={lyricOffsetSec} shade={shade} />
                </motion.div>
            )}
        </div>
    );
};

export default RemoteLyricBlock;
