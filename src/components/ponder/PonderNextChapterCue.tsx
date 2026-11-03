import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/ponder/PonderNextChapterCue.tsx
// 一章播完后，文字那一块右边出现的「下一章」按钮：写着下一章的名字，点它就过去。
//
// 它出现在刚读完的那句话旁边，不盖住画面，也不用被关掉 —— 教程的连贯感是它最值钱的东西，
// 每看完一章被一张卡片打断一次就没了。不想看可以直接无视。
//
// 按钮底边有一条读条：不点它，条走完也会进下一章。指针一碰到这颗按钮就取消 ——
// 把指针移过来的人要么正要点它，要么是想停下来把字幕读完，两种意图都不该被推走。
// 读条表示的是时间，所以关了微动效它也照走。
//
// 最后一章没有下一章可去，同一个位置只留一行「看完了」。

type PonderNextChapterCueProps = {
    /** 下一章的标题；已经是最后一章时为 null。 */
    nextSceneTitle: string | null;
    onNextScene: () => void;
    /** 读条时长；null 表示这次不自动续播（暂停了，或者已经被取消）。 */
    autoAdvanceMs: number | null;
    onCancelAutoAdvance: () => void;
};

const PonderNextChapterCue: React.FC<PonderNextChapterCueProps> = ({
    nextSceneTitle,
    onNextScene,
    autoAdvanceMs,
    onCancelAutoAdvance,
}) => {
    const { t } = useTranslation();

    if (!nextSceneTitle) {
        return (
            <span data-testid="ponder-chapters-done" className="pd-fade-in text-[13px] leading-9 text-[color:var(--st-t2)]">
                {t('ponder.allChaptersDone')}
            </span>
        );
    }

    return (
        <button
            type="button"
            data-testid="ponder-next-chapter"
            onClick={onNextScene}
            onPointerEnter={onCancelAutoAdvance}
            onFocus={onCancelAutoAdvance}
            className="pd-cue-in pd-t-quick relative inline-flex h-9 max-w-full items-center gap-2 overflow-hidden rounded-[10px] bg-[var(--st-fill)] pl-3 pr-2 text-[13px] text-[color:var(--st-t1)] transition-colors hover:bg-[var(--st-fill2)]"
        >
            <span className="flex-none text-xs text-[color:var(--st-t2)]">
                {autoAdvanceMs !== null ? t('ponder.nextChapterAuto') : t('ponder.nextChapter')}
            </span>
            <b className="min-w-0 truncate font-medium">{nextSceneTitle}</b>
            <ChevronRight size={14} className="flex-none text-[color:var(--st-t2)]" />
            {autoAdvanceMs !== null && (
                <span
                    data-testid="ponder-next-chapter-countdown"
                    aria-hidden="true"
                    className="ponder-next-cue-countdown absolute inset-x-0 bottom-0 h-0.5 bg-[var(--st-accent)]"
                    style={{ animationDuration: `${autoAdvanceMs}ms` }}
                />
            )}
        </button>
    );
};

export default PonderNextChapterCue;
