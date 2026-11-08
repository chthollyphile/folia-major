import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/dedicatus/contracts/desktopPreferences.test.ts
// D510：以主进程为准的桌面偏好（托盘、壁纸、显卡、遥控窗口……）只经 useDesktopSettingsStore 的 setter 和 IPC 写。
// 启动时 useAppPreferences 会用主进程的快照覆盖 localStorage，别处直接写 localStorage 的值重启就被改回去，
// 设置导入却显示“已应用”（#1041）。这里找出这些键在 store 文件之外的写入。

const ROOT = path.resolve(__dirname, '../../../..');
const STORE = 'src/stores/useDesktopSettingsStore.ts';

const listSources = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(relative);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [relative] : [];
});

/** store 文件里导出的桌面偏好存储键：常量名 → 值。 */
const desktopKeys = (): Map<string, string> => {
    const text = readFileSync(path.join(ROOT, STORE), 'utf8');
    return new Map([...text.matchAll(/export const (\w+_STORAGE_KEY) = '([^']+)';/g)].map(match => [match[1], match[2]]));
};

/** 写这些键的调用：setStored* / writeStored* / Storage.setItem，键是常量名或它的字面值。 */
const writePattern = (keys: Map<string, string>) => {
    const keyPattern = [...keys.keys(), ...[...keys.values()].map(value => `['"\`]${value}['"\`]`)].join('|');
    return new RegExp(`(?:setStored\\w*|writeStored\\w*|localStorage\\.setItem|sessionStorage\\.setItem)\\(\\s*(?:${keyPattern})`);
};

describe('D510 desktop preferences are written only through their store', () => {
    it('finds the keys and the store\'s own writes, so the patterns still match something', () => {
        expect(desktopKeys().get('CLOSE_TO_TRAY_STORAGE_KEY')).toBe('close_to_tray');
        expect(desktopKeys().size).toBeGreaterThan(10);
        const storeText = readFileSync(path.join(ROOT, STORE), 'utf8');
        expect(storeText.split('\n').filter(line => writePattern(desktopKeys()).test(line)).length).toBeGreaterThan(5);
    });

    it('writes none of them outside src/stores/useDesktopSettingsStore.ts', () => {
        const write = writePattern(desktopKeys());
        const offenders = listSources('src')
            .filter(file => file !== STORE)
            .flatMap(file => readFileSync(path.join(ROOT, file), 'utf8').split('\n')
                .map((line, index) => (write.test(line) ? `${file}:${index + 1}` : null))
                .filter((hit): hit is string => hit !== null));
        expect(offenders, 'D510：这些桌面偏好以主进程为准，只经 useDesktopSettingsStore 的 setter / IPC 写').toEqual([]);
    });
});
