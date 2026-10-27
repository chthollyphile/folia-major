import { useEffect, useRef } from 'react';
import { installControlBridge } from './install';
import { createControlHostDeps } from './controlHostDeps';
import type { ControlHostProps } from './controlHostDeps';

// src/control/ControlHost.tsx
// Mounts the renderer control bridge for as long as the app is up. App.tsx renders it once with the
// command palette context, the local library and the two playback callbacks; the bridge reads them
// through a ref so a re-render never unmounts it.

export const ControlHost = (props: ControlHostProps) => {
    const depsRef = useRef(createControlHostDeps(props));
    depsRef.current = createControlHostDeps(props);

    useEffect(() => {
        const { uninstall } = installControlBridge({ getHostDeps: () => depsRef.current });
        return uninstall;
    }, []);

    return null;
};
