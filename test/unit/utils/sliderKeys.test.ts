// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSliderKey, isTextEntryTarget } from '../../../src/utils/keyboardTargets';

// test/unit/utils/sliderKeys.test.ts
// 面板的音量滑杆是应用自己画的（一个 role="slider" 的 div），不是 <input>，所以不被
// isTextEntryTarget 挡住。焦点在它上面时按左右方向键，全局快捷键（播放页快退快进 5 秒）
// 必须让路，否则一下按键既改音量又跳进度。这个错从界面上很难想到去试。

const slider = () => {
    const element = document.createElement('div');
    element.setAttribute('role', 'slider');
    element.tabIndex = 0;
    return element;
};

describe('isSliderKey', () => {
    it('方向键、Home、End 落在滑杆上时是滑杆的', () => {
        const target = slider();
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
            expect(isSliderKey({ target, key })).toBe(true);
        }
    });

    it('滑杆上的空格和字母仍然是快捷键', () => {
        const target = slider();
        expect(isSliderKey({ target, key: ' ' })).toBe(false);
        expect(isSliderKey({ target, key: 'g' })).toBe(false);
        expect(isTextEntryTarget(target)).toBe(false);
    });

    it('方向键落在别的东西上时不归滑杆', () => {
        expect(isSliderKey({ target: document.createElement('button'), key: 'ArrowLeft' })).toBe(false);
        expect(isSliderKey({ target: null, key: 'ArrowLeft' })).toBe(false);
    });
});

// 面板里打开着的菜单（role="menu"）：焦点在它的一条上时，空格是选这一条，不是播放 / 暂停；
// 菜单自己不拦空格和回车，靠全局快捷键来问 isTextEntryTarget。
describe('菜单里的条目', () => {
    it('算作正在读键盘的控件，菜单外面的按钮不算', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        const entry = menu.appendChild(document.createElement('button'));
        expect(isTextEntryTarget(entry)).toBe(true);
        expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    });
});
