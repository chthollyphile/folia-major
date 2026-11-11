import { useEffect, useState } from 'react';

// Whether this window was built with the macOS traffic lights (`titleBarStyle: 'hidden'`).
// The setting is read when the window is created, so until the next start the window and the
// setting can disagree; the titlebar follows the window, or it would lose its only close button.

let known: boolean | null = null;
let pending: Promise<boolean> | null = null;

const askWindow = (): Promise<boolean> => {
    pending ??= (window.electron?.hasNativeTrafficLights() ?? Promise.resolve(false))
        .then(value => value, () => false)
        .then((value) => {
            known = value;
            return value;
        });
    return pending;
};

export const useNativeTrafficLights = (): boolean => {
    const [active, setActive] = useState(known ?? false);

    useEffect(() => {
        if (known !== null) return;
        let mounted = true;
        void askWindow().then((value) => {
            if (mounted) setActive(value);
        });
        return () => {
            mounted = false;
        };
    }, []);

    return active;
};
