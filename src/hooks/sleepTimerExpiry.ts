// src/hooks/sleepTimerExpiry.ts
// Runs the platform-specific one-shot expiry action with a playback fallback.

type SleepTimerExpiryOptions = {
    quitApp?: () => Promise<boolean>;
    onFallback: () => void;
};

export const runSleepTimerExpiryAction = async ({ quitApp, onFallback }: SleepTimerExpiryOptions) => {
    if (!quitApp) {
        onFallback();
        return;
    }

    try {
        const didQuit = await quitApp();
        if (!didQuit) {
            onFallback();
        }
    } catch {
        onFallback();
    }
};
