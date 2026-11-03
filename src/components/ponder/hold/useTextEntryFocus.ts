import { useSyncExternalStore } from 'react';
import { isTextEntryTarget } from '../../../utils/keyboardTargets';

// src/components/ponder/hold/useTextEntryFocus.ts
// 焦点此刻是不是在接收文字的东西上。问的是长按 G 让路时用的同一个 isTextEntryTarget，
// 只是问 document.activeElement：是的话 G 是它的字，按住什么都不会打开，提示胶囊也就不出现。

const subscribe = (onChange: () => void) => {
    // 焦点没有换、拿着焦点的那个控件自己变了也要重问（设置里的按键框开始录键、下拉展开，
    // 都只是改它自己的属性，不发焦点事件）：盯着它的属性。
    const watcher = new MutationObserver(onChange);
    const watchFocused = () => {
        watcher.disconnect();
        if (document.activeElement) {
            watcher.observe(document.activeElement, { attributes: true });
        }
    };
    const handleFocusMove = () => {
        watchFocused();
        onChange();
    };

    watchFocused();
    window.addEventListener('focusin', handleFocusMove);
    window.addEventListener('focusout', handleFocusMove);
    return () => {
        watcher.disconnect();
        window.removeEventListener('focusin', handleFocusMove);
        window.removeEventListener('focusout', handleFocusMove);
    };
};

const read = () => isTextEntryTarget(document.activeElement);

/**
 * 跟着 focusin / focusout 和焦点控件自己的属性更新；每次渲染也重读一遍 —— 输入框带着焦点被卸载时
 * （关掉一个窗口）浏览器不发 focusout，下一次渲染读到的仍然是对的。
 */
export const useTextEntryFocus = (): boolean => useSyncExternalStore(subscribe, read);
