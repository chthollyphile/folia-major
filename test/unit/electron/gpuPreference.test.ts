import { describe, expect, it } from 'vitest';

// test/unit/electron/gpuPreference.test.ts
// The render GPU choice becomes Chromium's own switch on Windows only, and a switch passed on the
// command line wins over the stored choice.

type FakeApp = {
    commandLine: { hasSwitch: (name: string) => boolean; appendSwitch: (name: string) => void };
    getGPUInfo: (level: string) => Promise<unknown>;
};

const {
    activeGpuName,
    applyGpuPreference,
    createActiveGpuReader,
    gpuPreferenceSwitch,
    normalizeGpuPreference,
} = require('../../../electron/gpuPreference.cjs') as {
    activeGpuName: (info: unknown) => string | null;
    applyGpuPreference: (input: { app: FakeApp; store: { get: (key: string) => unknown }; platform: string }) => { preference: string; source: string };
    createActiveGpuReader: (app: FakeApp) => () => Promise<string | null>;
    gpuPreferenceSwitch: (preference: unknown, platform: string) => string | null;
    normalizeGpuPreference: (value: unknown) => string;
};

const fakeApp = (passed: string[] = [], getGPUInfo: FakeApp['getGPUInfo'] = async () => ({})) => {
    const appended: string[] = [];
    const app: FakeApp = {
        commandLine: {
            hasSwitch: name => passed.includes(name),
            appendSwitch: name => { appended.push(name); },
        },
        getGPUInfo,
    };
    return { app, appended };
};

const storeWith = (value: unknown) => ({ get: (key: string) => (key === 'GPU_PREFERENCE' ? value : undefined) });

describe('gpuPreference', () => {
    it('reads anything but the three choices as auto', () => {
        expect(normalizeGpuPreference('high-performance')).toBe('high-performance');
        expect(normalizeGpuPreference('low-power')).toBe('low-power');
        expect(normalizeGpuPreference(undefined)).toBe('auto');
        expect(normalizeGpuPreference('dgpu')).toBe('auto');
    });

    it('maps a choice to a switch on Windows and to nothing elsewhere', () => {
        expect(gpuPreferenceSwitch('high-performance', 'win32')).toBe('force_high_performance_gpu');
        expect(gpuPreferenceSwitch('low-power', 'win32')).toBe('force_low_power_gpu');
        expect(gpuPreferenceSwitch('auto', 'win32')).toBeNull();
        expect(gpuPreferenceSwitch('high-performance', 'darwin')).toBeNull();
        expect(gpuPreferenceSwitch('high-performance', 'linux')).toBeNull();
    });

    it('adds the stored choice\'s switch on Windows', () => {
        const { app, appended } = fakeApp();
        expect(applyGpuPreference({ app, store: storeWith('high-performance'), platform: 'win32' }))
            .toEqual({ preference: 'high-performance', source: 'setting' });
        expect(appended).toEqual(['force_high_performance_gpu']);
    });

    it('adds nothing for auto or an unknown stored value', () => {
        const { app, appended } = fakeApp();
        expect(applyGpuPreference({ app, store: storeWith('turbo'), platform: 'win32' }))
            .toEqual({ preference: 'auto', source: 'setting' });
        expect(appended).toEqual([]);
    });

    it('leaves macOS and Linux alone whatever is stored', () => {
        for (const platform of ['darwin', 'linux']) {
            const { app, appended } = fakeApp();
            expect(applyGpuPreference({ app, store: storeWith('low-power'), platform }))
                .toEqual({ preference: 'auto', source: 'platform' });
            expect(appended).toEqual([]);
        }
    });

    it('lets a switch passed on the command line win over the stored choice', () => {
        const { app, appended } = fakeApp(['force_low_power_gpu']);
        expect(applyGpuPreference({ app, store: storeWith('high-performance'), platform: 'win32' }))
            .toEqual({ preference: 'low-power', source: 'command-line' });
        expect(appended).toEqual([]);
    });

    it('names the active adapter, or null when none is marked active', () => {
        expect(activeGpuName({ gpuDevice: [
            { active: false, vendorId: 0x8086, deviceId: 0xa7a0, deviceString: 'Intel(R) Iris(R) Xe Graphics' },
            { active: true, vendorId: 0x10de, deviceId: 0x28a0, deviceString: 'NVIDIA GeForce RTX 4060 Laptop GPU' },
        ] })).toBe('NVIDIA GeForce RTX 4060 Laptop GPU');
        expect(activeGpuName({ gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x28a0 }] })).toBe('vendor 0x10de, device 0x28a0');
        expect(activeGpuName({ gpuDevice: [{ active: false, vendorId: 0x1414, deviceId: 0x8c }] })).toBeNull();
        expect(activeGpuName(undefined)).toBeNull();
    });

    it('asks Chromium for the complete info once per run, but again after a failed read', async () => {
        const levels: string[] = [];
        let fail = true;
        const { app } = fakeApp([], async (level) => {
            levels.push(level);
            if (fail) throw new Error('GPU process gone');
            return { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x28a0, deviceString: 'NVIDIA' }] };
        });
        const read = createActiveGpuReader(app);
        await expect(read()).rejects.toThrow('GPU process gone');
        fail = false;
        expect(await read()).toBe('NVIDIA');
        expect(await read()).toBe('NVIDIA');
        expect(levels).toEqual(['complete', 'complete']);
    });
});
