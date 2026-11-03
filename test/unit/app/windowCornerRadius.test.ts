import { describe, expect, it } from 'vitest';
import { resolveWindowCornerRadius } from '../../../src/components/app/AppShell';

// test/unit/app/windowCornerRadius.test.ts
// 透明播放窗口的圆角半径跟宿主系统对齐：Windows 11 原生窗口圆角是 8px，其余平台沿用 18px。

describe('resolveWindowCornerRadius', () => {
    it('uses 8px on Windows to match the native window radius', () => {
        expect(resolveWindowCornerRadius('win32')).toBe('8px');
    });

    it('keeps 18px on macOS', () => {
        expect(resolveWindowCornerRadius('darwin')).toBe('18px');
    });

    it('keeps 18px on Linux', () => {
        expect(resolveWindowCornerRadius('linux')).toBe('18px');
    });

    it('keeps 18px when the platform is unknown', () => {
        expect(resolveWindowCornerRadius('')).toBe('18px');
    });
});
