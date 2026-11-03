import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';

// src/library/suites/bravais/bravaisFormModel.ts
// 缝的表单态（设计稿 §10.1「表单态」、§10.2 rename / delete-collection / add-to-playlist / create-playlist，
// 以及每日推荐的风格选择 #938）的状态机，纯规则。
// 表单态不是导航：不写 history，Esc 先撤销它。改名没改成就停在表单态（与网格留在编辑模式一致）；删除确认失败也留着
// 并显示原因；加入歌单的选择态里「新建歌单…」在同一个表单里展开输入框，Esc 先收起输入框、再撤销整个表单。
// busy（同一动作还在进行）不改变状态、不提示。

/** 加入歌单作用在哪：聚焦卡上的那一首，或整个集合（与网格信息面板的「加入歌单」一致）。 */
export type BravaisPlaylistScope = { kind: 'entry'; entryKey: string } | { kind: 'collection' };

export type BravaisFormState =
    | { kind: 'rename'; initial: string; error: string | null }
    | { kind: 'confirm-delete'; error: string | null }
    | { kind: 'pick-playlist'; scope: BravaisPlaylistScope; creating: boolean; error: string | null }
    /** 每日推荐的风格选择：选到一半的风格由表单视图自己记着，确认时才交出来。 */
    | { kind: 'pick-daily-style'; error: string | null };

export type BravaisFormEvent =
    | { type: 'open-rename'; initial: string }
    | { type: 'open-delete' }
    | { type: 'open-pick'; scope: BravaisPlaylistScope }
    | { type: 'open-daily-style' }
    | { type: 'start-create' }
    | { type: 'cancel' }
    /** 提交的结果回来了；errorText 是 surface 翻译好的失败文案（busy 时忽略）。 */
    | { type: 'result'; result: LibraryMutationResult; errorText?: string };

export const reduceBravaisForm = (state: BravaisFormState | null, event: BravaisFormEvent): BravaisFormState | null => {
    switch (event.type) {
        case 'open-rename': return { kind: 'rename', initial: event.initial, error: null };
        case 'open-delete': return { kind: 'confirm-delete', error: null };
        case 'open-pick': return { kind: 'pick-playlist', scope: event.scope, creating: false, error: null };
        case 'open-daily-style': return { kind: 'pick-daily-style', error: null };
        case 'start-create':
            return state?.kind === 'pick-playlist' ? { ...state, creating: true, error: null } : state;
        case 'cancel':
            if (state?.kind === 'pick-playlist' && state.creating) return { ...state, creating: false, error: null };
            return null;
        case 'result': {
            if (!state) return null;
            if (event.result.ok) return null;
            if (event.result.reason === 'busy') return state;
            return { ...state, error: event.errorText ?? event.result.message ?? null };
        }
        default: return state;
    }
};

/** Esc 阶梯里表单态的那一级：有表单就先撤销它（选择态里展开的新建输入框先收起）。 */
export const hasOpenForm = (state: BravaisFormState | null) => state !== null;
