import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { LyricLineRule } from '../../../utils/lyrics/lyricLineRules';
import type { LyricStaffDecision, LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { LyricFilterPreviewRow } from './buildLyricFilterPreviewModel';
import type { LibraryScan } from './useLyricLibraryScan';

// src/components/modal/lyric-filter/LyricFilterPreviewList.tsx
// The sample lyric of the lyric filter window: every line with its time. A removed line stays in
// place, dimmed and struck through, with a tag that names the rule that removed it; removed in the
// middle of the song, the tag and a bar at its left are amber. A click on a line asks for rules
// built from it. The opening credits block has a rail at its left and a head line with the verdict
// for this song.

interface LyricFilterPreviewListProps {
    isLoading: boolean;
    rows: LyricFilterPreviewRow[];
    staff: LyricStaffDecision;
    staffPolicy: LyricStaffPolicy;
    /** The rule's name for a tag. */
    ruleLabel: (rule: LyricLineRule) => string;
    /** The line whose rules are being suggested. */
    pickedIndex: number | null;
    onPickLine: (row: LyricFilterPreviewRow, element: HTMLButtonElement) => void;
}

/** The rail at the left of the credits block. */
const RAIL_CLASS = "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--st-line2)] before:content-['']";

const formatSeconds = (seconds: number): string => (Math.round(seconds * 10) / 10).toFixed(1);

/** A line's time as minutes, seconds and tenths: 01:05.3. */
const formatLineTime = (seconds: number): string => {
    const tenths = Math.max(0, Math.round(seconds * 10));
    return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

/**
 * A line's tag. Capped in width, the text cut short: a rule of many words would otherwise squeeze the
 * line to a column one character wide. The mid-song mark stands after it and is never cut.
 */
const LineTag: React.FC<React.HTMLAttributes<HTMLSpanElement> & { text: string; mid: boolean }> = ({ text, mid, className = '', ...rest }) => {
    const { t } = useTranslation();
    return (
        <span {...rest} className={`flex h-5 max-w-40 rounded-[5px] bg-[var(--st-fill)] px-1.5 text-[11px] leading-5 ${mid ? 'text-[color:var(--st-warn)]' : 'text-[color:var(--st-t2)]'} ${className}`}>
            <span className="truncate">{text}</span>
            {mid && <span className="ml-1 shrink-0 whitespace-nowrap">{t('lyricFilter.tagMid')}</span>}
        </span>
    );
};

type PreviewLineProps = {
    row: LyricFilterPreviewRow;
    railed: boolean;
    picked: boolean;
    ruleLabel: (rule: LyricLineRule) => string;
    onPick: (row: LyricFilterPreviewRow, element: HTMLButtonElement) => void;
};

const PreviewLine: React.FC<PreviewLineProps> = ({ row, railed, picked, ruleLabel, onPick }) => {
    const { t } = useTranslation();
    const { line, removedByFilter, removedByStaff, startTime, timeMoved } = row;
    const removed = removedByFilter || removedByStaff;
    const midRemoved = removedByFilter && row.midSong;
    const tag = removedByFilter
        ? (row.rule ? ruleLabel(row.rule) : '')
        : removedByStaff ? t('lyricFilter.tagStaff') : null;
    const textTone = removed ? 'line-through text-[color:var(--st-t3)]' : '';

    return (
        // The time and the tag stand beside the first line of a text that wraps or has a translation.
        <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={picked}
            onClick={event => onPick(row, event.currentTarget)}
            className={`st-t-fast group relative grid min-h-[34px] w-full grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-x-2 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-[var(--st-fill)] ${picked ? 'bg-[var(--st-fill)] shadow-[0_0_0_1px_var(--st-line2)]' : ''} ${railed ? RAIL_CLASS : ''}`}
        >
            {midRemoved && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[var(--st-warn)]" />}
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
            <LineTag
                aria-hidden={!tag}
                text={tag ?? t('lyricFilter.hoverAction')}
                mid={midRemoved}
                title={tag ?? undefined}
                className={`st-t-move mt-px transition-[opacity,transform] ${tag ? '' : 'translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'}`}
            />
        </button>
    );
};

const LyricFilterPreviewList: React.FC<LyricFilterPreviewListProps> = ({ isLoading, rows, staff, staffPolicy, ruleLabel, pickedIndex, onPickLine }) => {
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

    const blockStartIndex = rows.find(row => row.inStaffBlock)?.index ?? null;
    // 逐行过滤删掉的行不算在署名块里；夹在块中间的那几行照样画竖线，竖线才不会断开。
    const blockEndIndex = rows.reduce<number | null>((last, row) => (row.inStaffBlock ? row.index : last), null);
    const isRailed = (row: LyricFilterPreviewRow): boolean => (
        blockStartIndex !== null && blockEndIndex !== null && row.index >= blockStartIndex && row.index <= blockEndIndex
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
                                <span className="basis-full">
                                    {staff.absorbedLineCount > 0
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
                    <PreviewLine row={row} railed={isRailed(row)} picked={row.index === pickedIndex} ruleLabel={ruleLabel} onPick={onPickLine} />
                </React.Fragment>
            ))}
        </div>
    );
};


/** The 听过的歌 tab: the lines the rules that are on remove across the songs heard, by song. */
export const LibraryHitList: React.FC<{ scan: LibraryScan | null; songCount: number | null; ruleName: (id: string) => string }> = ({ scan, songCount, ruleName }) => {
    const { t } = useTranslation();

    if (songCount === null || !scan) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="animate-spin text-[color:var(--st-t3)]" size={24} />
            </div>
        );
    }
    if (songCount === 0 || scan.songs.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-[13px] text-[color:var(--st-t3)]">
                {t(songCount === 0 ? 'lyricFilter.libraryNone' : 'lyricFilter.libraryEmpty')}
            </div>
        );
    }

    // The scan keeps only the lines drawn here (LIBRARY_ROWS) and counts the rest.
    const hidden = scan.removedLines - scan.songs.reduce((count, song) => count + song.lines.length, 0);

    return (
        <div className="pb-5">
            {scan.songs.map(song => (
                <div key={song.key} className="pt-3">
                    <div className="px-3 pb-1 text-xs text-[color:var(--st-t2)]">{song.title ?? t('lyricFilter.untitled')}</div>
                    {song.lines.map((line, index) => (
                        <div key={`${index}-${line.text}`} className="relative flex items-start justify-between gap-3 px-3 py-1">
                            {line.mid && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[var(--st-warn)]" />}
                            <s className="min-w-0 text-sm leading-[22px] text-[color:var(--st-t3)]">{line.text}</s>
                            <LineTag text={ruleName(line.ruleId)} mid={line.mid} title={ruleName(line.ruleId)} className="mt-px shrink-0" />
                        </div>
                    ))}
                </div>
            ))}
            {hidden > 0 && <div className="px-3 pt-3 text-xs text-[color:var(--st-t3)]">{t('lyricFilter.warnMore', { count: hidden })}</div>}
        </div>
    );
};

export default LyricFilterPreviewList;
