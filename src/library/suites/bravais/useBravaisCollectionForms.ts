import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { SongResult } from '../../../types';
import type { DailyStyleSelection } from '../../../types/onlineMusic';
import type { CollectionMutationController, LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import { reduceBravaisForm, type BravaisPlaylistScope } from './bravaisFormModel';

// src/library/suites/bravais/useBravaisCollectionForms.ts
// 缝的表单态的执行端（状态机在 bravaisFormModel）：改名提交 mutations.rename，没改成停在表单态；删除确认提交
// deleteCollection，成功后 onBack（整墙翻回父层）；加入歌单在选择态里挑一张可写的 Navidrome 歌单（addToPlaylist），
// 「新建歌单…」在同一个表单里展开输入框（createPlaylist）。作用的歌由调用方给：聚焦卡上的那一首，或整个集合的可播放曲目。
// 每日推荐的风格选择确认后交给 setDailyStyle（存到账号上再换歌），没换成就停在表单态。
// 结果的提示与失败原因走 useBravaisMutationNotice。

type Run = (action: () => Promise<LibraryMutationResult>) => Promise<LibraryMutationResult | null>;

export const useBravaisCollectionForms = ({
    mutations,
    displayTitle,
    tracksFor,
    onBack,
    run,
    describe,
}: {
    mutations: CollectionMutationController | null;
    displayTitle: string;
    /** 加入 / 新建歌单作用的歌。 */
    tracksFor: (scope: BravaisPlaylistScope) => SongResult[];
    onBack: () => void;
    run: Run;
    describe: (result: LibraryMutationResult) => string | undefined;
}) => {
    const [state, dispatch] = useReducer(reduceBravaisForm, null);
    const latest = useRef({ state, mutations, displayTitle, tracksFor, onBack, run, describe });
    latest.current = { state, mutations, displayTitle, tracksFor, onBack, run, describe };

    const settle = useCallback((result: LibraryMutationResult | null) => {
        if (!result) return;
        dispatch({ type: 'result', result, errorText: latest.current.describe(result) });
    }, []);

    const openRename = useCallback(() => dispatch({ type: 'open-rename', initial: latest.current.displayTitle }), []);
    const openDelete = useCallback(() => dispatch({ type: 'open-delete' }), []);
    const openPick = useCallback((scope: BravaisPlaylistScope) => dispatch({ type: 'open-pick', scope }), []);
    const openDailyStyle = useCallback(() => {
        latest.current.mutations?.loadDailyStyleGroups();
        dispatch({ type: 'open-daily-style' });
    }, []);
    const startCreate = useCallback(() => dispatch({ type: 'start-create' }), []);
    const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);

    /** 表单的提交：改名（输入的名字）、删除确认、新建歌单（输入的名字）。 */
    const submit = useCallback(async (value: string) => {
        const { state: current, mutations: controller, tracksFor: tracksOf, run: execute } = latest.current;
        if (!current || !controller) return;
        if (current.kind === 'rename') {
            settle(await execute(() => controller.rename(value)));
            return;
        }
        if (current.kind === 'confirm-delete') {
            const result = await execute(() => controller.deleteCollection());
            settle(result);
            if (result?.ok) latest.current.onBack();
            return;
        }
        if (current.kind === 'pick-playlist' && current.creating) settle(await execute(() => controller.createPlaylist(value, tracksOf(current.scope))));
    }, [settle]);

    /** 选择态里挑了一张歌单。 */
    const pick = useCallback(async (playlistId: string | number) => {
        const { state: current, mutations: controller, tracksFor: tracksOf, run: execute } = latest.current;
        if (current?.kind !== 'pick-playlist' || !controller) return;
        settle(await execute(() => controller.addToPlaylist(playlistId, tracksOf(current.scope))));
    }, [settle]);

    /** 风格选择里确认了一组风格。 */
    const pickDailyStyle = useCallback(async (selection: DailyStyleSelection) => {
        const { state: current, mutations: controller, run: execute } = latest.current;
        if (current?.kind !== 'pick-daily-style' || !controller) return;
        settle(await execute(() => controller.setDailyStyle(selection)));
    }, [settle]);

    return useMemo(
        () => ({ state, openRename, openDelete, openPick, openDailyStyle, startCreate, cancel, submit, pick, pickDailyStyle }),
        [cancel, openDailyStyle, openDelete, openPick, openRename, pick, pickDailyStyle, startCreate, state, submit],
    );
};
