import { describe, expect, it } from 'vitest';

// test/unit/electron/tempDirEnvironment.test.ts
// Windows 上 TEMP / TMP 里没展开的 %NAME% 要在 main.cjs 开头就地展开（#690），其余情形原样不动。

const { repairTempDirEnvironment } = require('../../../electron/tempDirEnvironment.cjs') as {
    repairTempDirEnvironment: (options?: { platform?: string; env?: Record<string, string | undefined> }) => Array<{
        key: string;
        from: string;
        to: string;
    }>;
};

describe('repairTempDirEnvironment', () => {
    it('expands the unexpanded %USERPROFILE% from #690 in both TEMP and TMP', () => {
        const env: Record<string, string | undefined> = {
            USERPROFILE: 'C:\\Users\\folia',
            TEMP: '%USERPROFILE%\\AppData\\Local\\Temp',
            TMP: '%USERPROFILE%\\AppData\\Local\\Temp',
        };

        const repairs = repairTempDirEnvironment({ platform: 'win32', env });

        expect(env.TEMP).toBe('C:\\Users\\folia\\AppData\\Local\\Temp');
        expect(env.TMP).toBe('C:\\Users\\folia\\AppData\\Local\\Temp');
        expect(repairs).toEqual([
            { key: 'TEMP', from: '%USERPROFILE%\\AppData\\Local\\Temp', to: 'C:\\Users\\folia\\AppData\\Local\\Temp' },
            { key: 'TMP', from: '%USERPROFILE%\\AppData\\Local\\Temp', to: 'C:\\Users\\folia\\AppData\\Local\\Temp' },
        ]);
    });

    it('resolves variable names case-insensitively, like Windows does', () => {
        const env: Record<string, string | undefined> = {
            SystemRoot: 'C:\\Windows',
            TEMP: '%SYSTEMROOT%\\Temp',
        };

        repairTempDirEnvironment({ platform: 'win32', env });

        expect(env.TEMP).toBe('C:\\Windows\\Temp');
    });

    it('leaves references it cannot resolve in place and only expands one level', () => {
        const env: Record<string, string | undefined> = {
            NESTED: '%USERPROFILE%\\Nested',
            TEMP: '%MISSING%\\Temp',
            TMP: '%NESTED%\\Temp',
        };

        const repairs = repairTempDirEnvironment({ platform: 'win32', env });

        expect(env.TEMP).toBe('%MISSING%\\Temp');
        expect(env.TMP).toBe('%NESTED%\\Temp');
        expect(repairs).toEqual([]);
    });

    it('does not touch already expanded values or other platforms', () => {
        const windowsEnv: Record<string, string | undefined> = { TEMP: 'C:\\Users\\folia\\AppData\\Local\\Temp' };
        expect(repairTempDirEnvironment({ platform: 'win32', env: windowsEnv })).toEqual([]);
        expect(windowsEnv.TEMP).toBe('C:\\Users\\folia\\AppData\\Local\\Temp');

        const linuxEnv: Record<string, string | undefined> = { HOME: '/home/folia', TEMP: '%HOME%/tmp' };
        expect(repairTempDirEnvironment({ platform: 'linux', env: linuxEnv })).toEqual([]);
        expect(linuxEnv.TEMP).toBe('%HOME%/tmp');
    });
});
