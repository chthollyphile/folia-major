import { useState } from 'react';
import { usePonderStore } from '../../../stores/usePonderStore';
import { openCurrentPagePonder, readCurrentPagePonderTarget } from '../../../services/ponder/pagePonderTarget';
import type { PonderTargetId } from '../../../types/ponder';
import { effectiveKeyCode, isKeyCaptureTarget } from '../../../utils/keyboardTargets';
import type { PonderHoldProgressRefs } from './ponderHoldProgress';
import { usePonderHold } from './usePonderHold';

// src/components/ponder/hold/usePagePonderShortcut.ts
// 页面级入口：长按 Ctrl+G。
//
// 和组件级那条（悬停后长按 G）是同一份 usePonderHold。之前这里是按下即开，于是同一个功能有两种
// 触发感受 —— 一边要按住看擦除走满，一边一按就进。统一成长按之后，用户学会的是一件事。
//
// @note Ctrl+G 是页面级的，输入框（含命令面板搜索框）里也照常生效，所以不做文本目标判断。

export type PagePonderShortcutState = {
    /** 正在按住 Ctrl+G。提示胶囊靠它决定要不要出现。 */
    isHolding: boolean;
    /**
     * 松手会打开哪个页面教程。胶囊把它的名字写出来，用户按住的时候就知道讲的是哪一页。
     *
     * 在 keydown 当场解析一次：readVisiblePagePonderScope 要读 DOM，放进 render 里
     * 等于每次重渲染都强制一次重排，而它只在按下那一刻会变。
     */
    targetId: PonderTargetId | null;
};

export const usePagePonderShortcut = (refs: PonderHoldProgressRefs): PagePonderShortcutState => {
    const [targetId, setTargetId] = useState<PonderTargetId | null>(null);

    const isHolding = usePonderHold({
        enabled: true,
        accepts: event => (
            // 软件注入的按键 event.code 为空，按 key 认。
            effectiveKeyCode(event) === 'KeyG'
            && event.ctrlKey
            && !event.altKey
            && !event.metaKey
            && !event.shiftKey
            && !event.isComposing
            && !usePonderStore.getState().session
            // 设置里的按键框正在录键：这一下是录给它的。
            && !isKeyCaptureTarget(event.target)
            // 按实际页面解析出来没有教程（例如某个 suite 的页面声明了 none）：不起长按。
            && readCurrentPagePonderTarget() !== null
        ),
        // 松开 G 或松开 Ctrl 都算放弃 —— 按住 G 再松 Ctrl 之后擦除还在走会很怪。
        releasedBy: event => effectiveKeyCode(event) === 'KeyG' || event.key === 'Control',
        onPress: () => {
            // 提示一出现就把教程层那个 chunk 预热，400ms 按满时通常已经就绪。
            void import('../PonderStage');
            setTargetId(readCurrentPagePonderTarget());
        },
        onFull: openCurrentPagePonder,
        refs,
    });

    return { isHolding, targetId };
};

export default usePagePonderShortcut;
