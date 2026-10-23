import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { LyricStaffDecision, LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { LyricFilterPreviewRow } from './buildLyricFilterPreviewModel';

// src/components/modal/lyric-filter/LyricFilterPreviewList.tsx
// The sample lyric of the lyric filter window: every line with its time. A removed line stays in
// place, dimmed and struck through, with a tag that names the rule that removed it. Every credit
// block has its own rail at the left, and the head line carries the verdict for this song.

interface LyricFilterPreviewListProps {
    isLoading: boolean;
    rows: LyricFilterPreviewRow[];
    staff: LyricStaffDecision;
    staffPolicy: LyricStaffPolicy;
    /** 每个署名块的 [起, 止] 行下标；多块之间隔着正文，竖线必须按块各画各的。 */
    staffBlockRanges?: Array<[number, number]>;
}

/** The rail at the left of a credits block. */
const RAIL_CLASS = "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--st-line2)] before:content-['']";

const formatSeconds = (seconds: number): string => (Math.round(seconds * 10) / 10).toFixed(1);

/** A line's time as minutes, seconds and tenths: 01:05.3. */
const formatLineTime = (seconds: number): string => {
    const tenths = Math.max(0, Math.round(seconds * 10));
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

const PreviewLine: React.FC<{ row: LyricFilterPreviewRow; railed: boolean }> = ({ row, railed }) => {
    const { t } = useTranslation();
    const { line, removedByFilter, removedByStaff, startTime, timeMoved } = row;
    const removed = removedByFilter || removedByStaff;
    const tag = removedByFilter ? t('lyricFilter.tagLine') : removedByStaff ? t('lyricFilter.tagStaff') : null;
    // The tag keeps its last text while it fades out.
    const shownTag = useRef(tag);
    if (tag) {
        shownTag.current = tag;
    }
    const textTone = removed ? 'line-through text-[color:var(--st-t3)]' : '';

    return (
        // The time and the tag stand beside the first line of a text that wraps or has a translation.
        <div className={`relative grid min-h-[34px] grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 ${railed ? RAIL_CLASS : ''}`}>
            <time className={`st-t-move font-mono text-[11px] leading-[22px] tabular-nums transition-colors ${timeMoved && !removed ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)]'}`}>
                {formatLineTime(startTime)}
            </time>
            <div className="min-w-0">
                <div className={`st-t-move text-sm leading-[22px] transition-colors ${textTone || 'text-[color:var(--st-t1)]'}`}>
                    {line.fullText}
                </div>
                {line.translation && (
                    <div className={`st-t-move text-xs leading-[18px] transition-colors ${textTone || 'text-[color:var(--st-t2)]'}`}>
                        {line.translation}
                    </div>
                )}
            </div>
            <span
                aria-hidden={!tag}
                className={`st-t-move mt-px h-5 whitespace-nowrap rounded-[5px] bg-[var(--st-fill)] px-1.5 text-[11px] leading-5 text-[color:var(--st-t2)] transition-[opacity,transform] ${tag ? '' : 'translate-x-1 opacity-0'}`}
            >
                {tag ?? shownTag.current}
            </span>
        </div>
    );
};

const LyricFilterPreviewList: React.FC<LyricFilterPreviewListProps> = ({
    isLoading,
    rows,
    staff,
    staffPolicy,
    staffBlockRanges = [],
}) => {
    const { t } = useTranslation();

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="animate-spin text-[color:var(--st-t3)]" size={24} />
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-[13px] text-[color:var(--st-t3)]">
                {t('lyricFilter.emptyContent')}
            </div>
        );
    }

    // 头部标在第一个块的起点上；竖线按块分别画（中间隔着正文的多个块不能连成一根）。
    const blockStartIndex = staffBlockRanges.length > 0 ? staffBlockRanges[0][0] : null;
    const isRailed = (row: LyricFilterPreviewRow): boolean => (
        staffBlockRanges.some(([start, end]) => row.index >= start && row.index <= end)
    );
    // 署名块只在第一条上打一次标，逐行重复会把预览变成噪音。没识别到块时标在第一行上面，不带竖线；
    // 「始终显示」不做判定，也就没有这一行。
    const headIndex = staffPolicy === 'keep' ? null : blockStartIndex ?? rows[0].index;
    const verdictLabel = t(`lyricStaff.verdict${staff.verdict.charAt(0).toUpperCase()}${staff.verdict.slice(1)}`);

    return (
        <div className="pb-5">
            {rows.map(row => (
                <React.Fragment key={`${row.index}-${row.line.startTime}-${row.line.fullText}`}>
                    {row.index === headIndex && (
                        <div className={`relative mt-1.5 flex flex-wrap items-center justify-between gap-x-3 px-3 py-1.5 text-[11px] leading-4 text-[color:var(--st-t3)] ${blockStartIndex === null ? '' : RAIL_CLASS}`}>
                            <span>{t('lyricStaff.title')}</span>
                            <span className="text-right text-[color:var(--st-t1)]">
                                {t('lyricStaff.verdict', { verdict: verdictLabel })}
                            </span>
                            {staff.verdict !== 'none' && staffPolicy === 'smart' && (
                                // 吸收行数是额外信息：大多数歌词吸不到东西，常驻一行 0 反而是噪音。
                                // 末尾块的窗口/需求只是报告值，不能拿它下结论，单独换一种说法。
                                <span className="basis-full">
                                    {staff.windowKind === 'tail'
                                        ? t(staff.absorbedLineCount > 0
                                            ? 'lyricStaff.verdictSummaryTailAbsorbed'
                                            : 'lyricStaff.verdictSummaryTail', {
                                            lines: staff.blockLineCount,
                                            absorbed: staff.absorbedLineCount,
                                        })
                                        : staff.windowKind === 'whole-song'
                                            ? t('lyricStaff.verdictSummaryWholeSong', { lines: staff.blockLineCount })
                                            : staff.absorbedLineCount > 0
                                            ? t('lyricStaff.verdictSummaryAbsorbed', {
                                                lines: staff.blockLineCount,
                                                absorbed: staff.absorbedLineCount,
                                                window: formatSeconds(staff.windowSeconds),
                                                required: formatSeconds(staff.requiredSeconds),
                                            })
                                            : t('lyricStaff.verdictSummary', {
                                                lines: staff.blockLineCount,
                                                window: formatSeconds(staff.windowSeconds),
                                                required: formatSeconds(staff.requiredSeconds),
                                            })}
                                </span>
                            )}
                        </div>
                    )}
                    <PreviewLine row={row} railed={isRailed(row)} />
                </React.Fragment>
            ))}
        </div>
    );
};

export default LyricFilterPreviewList;
