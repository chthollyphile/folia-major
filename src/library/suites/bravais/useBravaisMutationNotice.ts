import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import { describeMutationResult, type MutationNoticeLabels } from './bravaisCollectionStatus';
import type { BravaisSeamNotice } from './bravaisSeamModels';

// src/library/suites/bravais/useBravaisMutationNotice.ts
// 动作结果的提示（设计稿 §10.6）：判别式在 bravais 里翻译，显示在缝底的状态行里几秒，不走 toast（不挡住墙）；busy 不提示。
// 也负责把变更调用包一层：控制器抛错当作 failed，组件卸载以后回来的结果不再提示。

/** 提示在缝底停留的时长。 */
export const BRAVAIS_NOTICE_MS = 4200;

type RunOptions = { isDailyRemoval?: boolean };

export const useBravaisMutationNotice = () => {
    const { t } = useTranslation();
    const [notice, setNotice] = useState<BravaisSeamNotice | null>(null);
    const seqRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const labels = useMemo<MutationNoticeLabels>(() => ({
        limitReached: t('home.noMoreDailyRecommendations'),
        dislikeFailed: t('home.dislikeRecommendationFailed'),
        failed: t('libraryBravaisCollection.actionFailed'),
        stale: t('libraryBravaisCollection.actionStale'),
        unsupported: t('libraryBravaisCollection.actionUnsupported'),
    }), [t]);
    const labelsRef = useRef(labels);
    labelsRef.current = labels;

    const show = useCallback((text: string, tone: BravaisSeamNotice['tone']) => {
        seqRef.current += 1;
        const seq = seqRef.current;
        setNotice({ seq, text, tone });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setNotice(current => (current?.seq === seq ? null : current));
        }, BRAVAIS_NOTICE_MS);
    }, []);

    /** 跑一个变更动作：结果判别式 → 提示；返回结果（卸载后返回 null）。 */
    const run = useCallback(async (action: () => Promise<LibraryMutationResult>, options: RunOptions = {}) => {
        let result: LibraryMutationResult;
        try {
            result = await action();
        } catch (error) {
            console.error('[bravais] collection action failed', error);
            result = { ok: false, reason: 'failed' };
        }
        if (!isMountedRef.current) return null;
        const described = describeMutationResult(result, labelsRef.current, options);
        if (described) show(described.text, described.tone);
        return result;
    }, [show]);

    /** 表单里显示的失败原因（与提示同一句）。 */
    const describe = useCallback((result: LibraryMutationResult, options: RunOptions = {}) => (
        describeMutationResult(result, labelsRef.current, options)?.text
    ), []);

    // B8：show 也给歌手页「加入热门歌曲」的条数提示用（不走 toast，显示在缝底）。
    return { notice, run, describe, show };
};
