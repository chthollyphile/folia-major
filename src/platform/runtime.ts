import { Capacitor } from '@capacitor/core';

// src/platform/runtime.ts
// Keeps host-specific capability checks in one place.

export type RuntimeEnvironment = 'web' | 'electron' | 'capacitor-mobile';

export const hasElectronBridge = () =>
    typeof window !== 'undefined'
    && Boolean((window as typeof window & { electron?: unknown }).electron);

export const isCapacitorMobile = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    const platform = Capacitor.getPlatform();
    return Capacitor.isNativePlatform() && (platform === 'android' || platform === 'ios');
};

export const getRuntimeEnvironment = (): RuntimeEnvironment => {
    if (hasElectronBridge()) {
        return 'electron';
    }

    if (isCapacitorMobile()) {
        return 'capacitor-mobile';
    }

    return 'web';
};

export const supportsCapacitorSecureStorage = () => isCapacitorMobile();

export const allowsDesktopFeatures = () => getRuntimeEnvironment() === 'electron';
