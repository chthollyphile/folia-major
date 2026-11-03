import React, { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import type { DailyStyleSelection } from '../../../types/onlineMusic';
import { toggleDailyStyleTag } from '../../core/collection/dailyStyle';
import type { BravaisSeamForm } from './bravaisSeamModels';
import { BravaisSeamFlip } from './BravaisSeamFlip';

// src/library/suites/bravais/BravaisSeamFormView.tsx
// 缝的表单态（设计稿 §10.1「表单态」）：缝原地翻成输入框、确认或选择列表，完成或取消后再翻回。不是导航，不写 history。
// - rename：横排输入框（初值是现在的名字），Enter 提交，没改成就停在这里并显示原因；
// - confirm-delete：标题 + 说明 +「删除 / 取消」，确认按钮拿到焦点（Enter 确认）；
// - pick-playlist：可写的 Navidrome 歌单（横排列表，与面板列表同一种行），顶上「新建歌单…」在同一个表单里展开输入框；
// - pick-daily-style：每日推荐的风格（#938），一排分组、这一组的风格，选几个再「保存」。选到一半的风格记在这里，不经过层描述。
// 输入框是非受控的：打字不经过层描述（不让 stage 每个字都重算），只在提交时把值交给 surface。
// Esc：输入框里自己处理（先收起新建输入框，再撤销）；焦点在按钮上时由墙的 Esc 阶梯的「表单」一级撤销。
// 「新建歌单…」与它展开的输入框之间翻一格（绕 X 轴，BravaisSeamFlip）；出错的一行淡入（CSS）。

const FormInput: React.FC<{
    initial: string;
    placeholder?: string;
    submitLabel: string;
    cancelLabel: string;
    pending: boolean;
    onSubmit: (value: string) => void;
    onCancel: () => void;
    name: string;
}> = ({ initial, placeholder, submitLabel, cancelLabel, pending, onSubmit, onCancel, name }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus({ preventScroll: true });
        input.select();
    }, []);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!pending) onSubmit(inputRef.current?.value ?? '');
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
    };
    return (
        <form className="bravais-form-input" onSubmit={submit}>
            <input ref={inputRef} name={name} defaultValue={initial} placeholder={placeholder} autoComplete="off" spellCheck={false} onKeyDown={onKeyDown} />
            <span className="bravais-form-buttons">
                <button type="submit" className="bravais-chrome-button is-primary" data-bravais-form-action="submit" disabled={pending}>
                    {pending && <Loader2 aria-hidden className="animate-spin" />}{submitLabel}
                </button>
                <button type="button" className="bravais-chrome-button" data-bravais-form-action="cancel" onClick={onCancel}>{cancelLabel}</button>
            </span>
        </form>
    );
};

/** 风格选择：打开时从账号现在的选择开始、停在它那一组；一次只能选同一组里的（core/collection/dailyStyle）。 */
const DailyStylePicker: React.FC<{ form: BravaisSeamForm }> = ({ form }) => {
    const groups = form.dailyStyle?.groups ?? [];
    const initial = form.dailyStyle?.selection ?? null;
    const [draft, setDraft] = useState<DailyStyleSelection | null>(initial);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(initial?.groupId ?? null);
    const activeGroup = groups.find(group => group.id === activeGroupId) ?? groups[0];
    const { labels, pending } = form;
    const cancelButton = (
        <button type="button" className="bravais-chrome-button" data-bravais-form-action="cancel" onClick={form.onCancel}>{labels.cancel}</button>
    );

    if (groups.length === 0) {
        const style = form.dailyStyle;
        return (
            <>
                {style?.failed ? (
                    <p className="bravais-form-message">{style.failedLabel}</p>
                ) : labels.empty && (
                    <p className="bravais-form-message"><Loader2 aria-hidden className="animate-spin" /> {labels.empty}</p>
                )}
                <span className="bravais-form-buttons">
                    {style?.failed && (
                        <button type="button" className="bravais-chrome-button is-primary" data-bravais-form-action="retry" onClick={style.onRetry}>{style.retryLabel}</button>
                    )}
                    {cancelButton}
                </span>
            </>
        );
    }
    return (
        <>
            <div className="bravais-form-style-groups" role="tablist" aria-label={labels.title}>
                {groups.map(group => {
                    const active = group.id === activeGroup?.id;
                    const picked = draft?.groupId === group.id && draft.tagIds.length > 0;
                    return (
                        <button key={group.id} type="button" role="tab" aria-selected={active}
                            className={`bravais-form-style-group${active ? ' is-active' : ''}${picked ? ' has-picks' : ''}`}
                            data-bravais-form-style-group={group.id} onClick={() => setActiveGroupId(group.id)}>
                            {group.name}
                        </button>
                    );
                })}
            </div>
            <div className="bravais-form-style-tags" role="group" aria-label={activeGroup?.name}>
                {(activeGroup?.tags ?? []).map(tag => {
                    const checked = draft?.groupId === activeGroup?.id && draft.tagIds.includes(tag.id);
                    return (
                        <button key={tag.id} type="button" role="checkbox" aria-checked={checked}
                            className={`bravais-form-style-tag${checked ? ' is-on' : ''}`} data-bravais-form-style-tag={tag.id} disabled={pending}
                            onClick={() => activeGroup && setDraft(current => toggleDailyStyleTag(current, activeGroup.id, tag.id))}>
                            {checked && <Check aria-hidden strokeWidth={2.5} />}
                            {tag.name}
                        </button>
                    );
                })}
            </div>
            <span className="bravais-form-buttons">
                <button type="button" className="bravais-chrome-button is-primary" data-bravais-form-action="submit"
                    disabled={pending || !draft || draft.tagIds.length === 0} onClick={() => draft && form.onPickDailyStyle?.(draft)}>
                    {pending && <Loader2 aria-hidden className="animate-spin" />}{labels.submit}
                </button>
                {cancelButton}
            </span>
        </>
    );
};

const BravaisSeamFormView: React.FC<{ form: BravaisSeamForm }> = ({ form }) => {
    const { state, labels, pending } = form;
    const confirmRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (state.kind === 'confirm-delete') confirmRef.current?.focus({ preventScroll: true });
    }, [state.kind]);

    return (
        <div className="bravais-seam-form" data-bravais-form={state.kind} data-bravais-form-id={form.formId} role="group" aria-label={labels.title}>
            <h2 className="bravais-form-title">{labels.title}</h2>
            {labels.message && <p className="bravais-form-message">{labels.message}</p>}
            {state.kind === 'rename' && (
                <FormInput
                    name="bravais-rename"
                    initial={state.initial}
                    placeholder={labels.placeholder}
                    submitLabel={labels.submit}
                    cancelLabel={labels.cancel}
                    pending={pending}
                    onSubmit={form.onSubmit}
                    onCancel={form.onCancel}
                />
            )}
            {state.kind === 'confirm-delete' && (
                <span className="bravais-form-buttons">
                    <button ref={confirmRef} type="button" className="bravais-chrome-button is-primary is-danger" data-bravais-form-action="confirm"
                        disabled={pending} onClick={() => form.onSubmit('')}>
                        {pending && <Loader2 aria-hidden className="animate-spin" />}{labels.submit}
                    </button>
                    <button type="button" className="bravais-chrome-button" data-bravais-form-action="cancel" onClick={form.onCancel}>{labels.cancel}</button>
                </span>
            )}
            {state.kind === 'pick-playlist' && (
                <>
                    {(state.creating || (form.onStartCreate && labels.createLabel)) && <BravaisSeamFlip axis="x" flipKey={state.creating ? 'creating' : 'list'}>
                        {state.creating ? (
                            <FormInput
                                name="bravais-create-playlist"
                                initial=""
                                placeholder={labels.placeholder}
                                submitLabel={labels.submit}
                                cancelLabel={labels.cancel}
                                pending={pending}
                                onSubmit={form.onSubmit}
                                onCancel={form.onCancel}
                            />
                        ) : form.onStartCreate && labels.createLabel && (
                            <button type="button" className="bravais-form-row is-create" data-bravais-form-action="create" onClick={() => form.onStartCreate?.()}>
                                <Plus aria-hidden />{labels.createLabel}
                            </button>
                        )}
                    </BravaisSeamFlip>}
                    <div className="bravais-form-list" role="listbox" aria-label={labels.title}>
                        {(form.playlists ?? []).map(playlist => (
                            <button key={playlist.id} type="button" role="option" aria-selected={false} className="bravais-form-row"
                                data-bravais-form-playlist={playlist.id} disabled={pending} onClick={() => form.onPick?.(playlist.id)}>
                                {playlist.name}
                            </button>
                        ))}
                        {(form.playlists ?? []).length === 0 && labels.empty && <p className="bravais-form-message">{labels.empty}</p>}
                    </div>
                    {!state.creating && (
                        <span className="bravais-form-buttons">
                            <button type="button" className="bravais-chrome-button" data-bravais-form-action="cancel" onClick={form.onCancel}>{labels.cancel}</button>
                        </span>
                    )}
                </>
            )}
            {state.kind === 'pick-daily-style' && <DailyStylePicker form={form} />}
            {state.error && <p className="bravais-form-error" role="alert" data-bravais-form-error>{state.error}</p>}
        </div>
    );
};

export default BravaisSeamFormView;
