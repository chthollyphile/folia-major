import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../../types';
import type {
    RecommendationPreferenceChoice,
    RecommendationPreferenceLabel,
    RecommendationPreferenceRatio,
} from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { Button, Row, Segmented, Select } from '../modal/settings/kit';
import { GROUP_CARD_CLASS } from '../modal/settings/kit/Group';
import { settingsTokens } from '../modal/settings/kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../modal/settings/kit/motion';
import { percent, SliderRow } from '../visualizer/panelRows';
import { changesOf, ratioSide, snapRatio } from './preferenceDraft';
import { selectPreferencesAccountKey, useRecommendationPreferencesStore } from './useRecommendationPreferencesStore';

// src/components/recommendationPreferences/RecommendationPreferencesPanel.tsx
// 命令面板里「偏好设置」的面板：最上面一行平台给的说明（这份偏好保存在账号上、影响到哪里），下面每一项一行——
// 选项式用胶囊（选项多于四个时用下拉），比例用滑杆，拖动时显示百分比。
// 打开就读一次；「重置」直接保存默认值。不认平台：偏好项和说明都是平台交来、omni 整理过的。

/** Segmented 放得下的选项数；更多的用下拉。 */
const MAX_SEGMENTED_OPTIONS = 4;
const CONTROL_KEYS = new Set(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

type RecommendationPreferencesPanelProps = {
    isDaylight: boolean;
    theme: Theme;
    /** 收起命令面板。 */
    onClose: () => void;
};

export default function RecommendationPreferencesPanel({ isDaylight, theme, onClose }: RecommendationPreferencesPanelProps) {
    const { t } = useTranslation();
    const reducedMotion = useKitReducedMotion();
    const panelRef = useRef<HTMLDivElement>(null);
    const pressedSlider = useRef<HTMLInputElement | null>(null);
    const [draggedSlider, setDraggedSlider] = useState<HTMLInputElement | null>(null);
    const [sliderPosition, setSliderPosition] = useState(0);
    const startDrag = useCallback(() => setDraggedSlider(pressedSlider.current), []);
    const endDrag = useCallback(() => setDraggedSlider(null), []);
    const state = useRecommendationPreferencesStore(useShallow(store => ({
        phase: store.phase,
        preferences: store.preferences,
        draft: store.draft,
        saving: store.saving,
        open: store.open,
        setValue: store.setValue,
        save: store.save,
    })));
    const { open } = state;
    const accountKey = useOnlineProviderAccountStore(selectPreferencesAccountKey);

    useLayoutEffect(() => {
        if (!draggedSlider) return;
        // 用控件实际显示的值，百分比和拇指都跟着步进、吸附后的结果走。
        const min = Number(draggedSlider.min);
        const max = Number(draggedSlider.max);
        setSliderPosition((draggedSlider.valueAsNumber - min) / (max - min));
    }, [draggedSlider, state.draft]);

    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    // 打开时读一次；开着的时候换了平台或账号，就按新的账号重读（旧的答复由 store 作废）。
    // 登出了、或换到没有偏好的平台，这份偏好就没有主人了：面板留着只剩一行说明，直接收起。
    useEffect(() => {
        void open();
        if (useRecommendationPreferencesStore.getState().owner === null) closeRef.current();
    }, [open, accountKey]);

    const say = (label: RecommendationPreferenceLabel): string => (
        label.labelKey ? t(label.labelKey, { defaultValue: label.labelFallback }) : label.labelFallback
    );

    const save = async (intent?: 'reset') => {
        const { openTicket } = useRecommendationPreferencesStore.getState();
        const outcome = await state.save(intent);
        if (outcome === 'confirmed') {
            setStatusMessage({ type: 'success', text: t('recommendationPreferences.saved') });
        } else if (outcome === 'unconfirmed') {
            setStatusMessage({ type: 'info', text: t('recommendationPreferences.unconfirmed') });
        } else if (outcome === 'failed') {
            setStatusMessage({ type: 'error', text: t('recommendationPreferences.saveFailed') });
        }
        // 提示照常发。只有发起保存的那次面板读取可以关闭面板。
        const shouldClose = outcome === 'confirmed' || outcome === 'unconfirmed' || (intent === 'reset' && outcome === 'unchanged');
        if (
            shouldClose && panelRef.current
            && useRecommendationPreferencesStore.getState().openTicket === openTicket
            && selectPreferencesAccountKey(useOnlineProviderAccountStore.getState()) === accountKey
        ) {
            onClose();
        }
    };

    const keepControlKeys = (event: KeyboardEvent<HTMLDivElement>) => {
        if (CONTROL_KEYS.has(event.key) && event.target instanceof Element && event.target.matches('button, input[type="range"]')) {
            // 让控件和浏览器先处理，别再交给 window 上的命令面板按键监听。
            event.stopPropagation();
        }
    };

    const closeFromOpenSelect = (event: KeyboardEvent<HTMLDivElement>) => {
        // 下拉展开时焦点仍在触发按钮上；它会拦住 Escape，所以在捕获阶段关闭面板。
        if (event.key === 'Escape' && event.target instanceof Element && event.target.matches('button[role="combobox"][aria-expanded="true"]')) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    };

    const items = state.preferences?.items ?? [];
    const changed = state.preferences ? Object.keys(changesOf(items, state.draft)).length > 0 : false;

    const choiceRow = (item: RecommendationPreferenceChoice) => {
        const value = String(state.draft[item.key] ?? item.value);
        const options = item.options.map(option => ({ value: option.value, label: say(option.label) }));
        return (
            <Row key={item.key} label={say(item.label)}>
                {options.length <= MAX_SEGMENTED_OPTIONS ? (
                    <Segmented value={value} options={options} disabled={state.saving} onChange={next => state.setValue(item.key, next)} />
                ) : (
                    <Select value={value} options={options} disabled={state.saving} onChange={next => state.setValue(item.key, next)} />
                )}
            </Row>
        );
    };

    const ratioRow = (item: RecommendationPreferenceRatio) => {
        const value = Number(state.draft[item.key] ?? item.value);
        // 跨度太小的比例按百分之一走。
        const step = item.max - item.min >= 20 ? 1 : (item.max - item.min) / 100;
        return (
            <SliderRow
                key={item.key}
                label={say(item.label)}
                value={value}
                min={item.min}
                max={item.max}
                step={step}
                marks={[{ value: item.defaultValue, label: t('recommendationPreferences.default') }]}
                format={shown => t(`recommendationPreferences.${ratioSide(item, shown)}`)}
                disabled={state.saving}
                onDragStart={startDrag}
                onDragEnd={endDrag}
                onChange={next => state.setValue(item.key, snapRatio(item, next))}
            />
        );
    };

    return (
        <div
            ref={panelRef}
            onPointerDownCapture={event => {
                const target = event.target;
                pressedSlider.current = target instanceof HTMLInputElement && target.type === 'range' ? target : null;
            }}
            onKeyDown={keepControlKeys}
            onKeyDownCapture={closeFromOpenSelect}
            // 和字幕调节一样，是命令面板里的一个小设置窗：kit 的颜色、动效和焦点框都挂在 st-window 上。
            className="st-window flex h-full justify-center overflow-y-auto px-4 py-6 text-[color:var(--st-t1)]"
            style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reducedMotion) }}
            data-testid="recommendation-preferences-surface"
        >
            <div className="w-full max-w-lg self-start">
                <p className="mb-2 px-1 text-xs text-[color:var(--st-t3)]">
                    {state.preferences?.note ? say(state.preferences.note) : t('recommendationPreferences.noteDefault')}
                </p>
                {state.phase === 'loading' && (
                    <div className={GROUP_CARD_CLASS}>
                        <Row label={t('recommendationPreferences.loading')}>
                            <Loader2 size={16} className="animate-spin text-[color:var(--st-t3)]" />
                        </Row>
                    </div>
                )}
                {state.phase === 'failed' && (
                    <div className={GROUP_CARD_CLASS}>
                        <Row label={t('recommendationPreferences.loadFailed')}>
                            <Button onClick={() => void open()}>{t('recommendationPreferences.retry')}</Button>
                        </Row>
                    </div>
                )}
                {state.phase === 'ready' && items.length === 0 && (
                    <div className={GROUP_CARD_CLASS}>
                        <Row label={t('recommendationPreferences.empty')} />
                    </div>
                )}
                {state.phase === 'ready' && items.length > 0 && (
                    <>
                        <div className={GROUP_CARD_CLASS} data-testid="recommendation-preferences-items">
                            {items.map(item => (item.kind === 'choice' ? choiceRow(item) : ratioRow(item)))}
                        </div>
                        {/* 气泡跟着滑杆的轨道走，和默认刻度一样各留半个拇指的宽度。 */}
                        {draggedSlider?.parentElement && !state.saving && createPortal(
                            <span aria-hidden className="pointer-events-none absolute inset-x-2 top-0 z-10">
                                <span
                                    data-testid="recommendation-preference-ratio-position"
                                    className="absolute -top-1 -translate-x-1/2 -translate-y-full rounded-md bg-[var(--st-accent)] px-1.5 text-xs leading-5 text-[color:var(--st-on-accent)] tabular-nums"
                                    style={{ left: `${sliderPosition * 100}%` }}
                                >
                                    {percent(sliderPosition)}
                                </span>
                            </span>,
                            draggedSlider.parentElement,
                        )}
                        <div className="ml-auto mt-3 grid w-max grid-flow-col auto-cols-fr gap-2 [&_button]:w-full">
                            <Button disabled={state.saving} onClick={() => void save('reset')}>
                                {t('recommendationPreferences.reset')}
                            </Button>
                            <Button variant="primary" disabled={state.saving || !changed} onClick={() => void save()}>
                                {state.saving ? t('recommendationPreferences.saving') : t('recommendationPreferences.save')}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
