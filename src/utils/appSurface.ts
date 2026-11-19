// src/utils/appSurface.ts
// Which root this window mounts, decided once from the URL. bootstrap.tsx picks the React root with
// it; features that only make sense in the main app window (the video layer, mod clients) read the
// same answer instead of re-parsing the URL.

// `location` is checked too: unit tests stub a bare `window` without one.
const pageLocation = typeof window === 'undefined' ? undefined : (window.location as Location | undefined);
const searchParams = new URLSearchParams(pageLocation?.search ?? '');

export const isObsBrowserSourceSurface = typeof window !== 'undefined'
    && (searchParams.get('obs') === '1' || pageLocation?.pathname === '/obs');

export const obsSourceKind = searchParams.get('obsSource');

export const isRemoteControlSurface = !isObsBrowserSourceSurface && searchParams.get('remote') === '1';

/** The performance check's window (electron/perfCheck.cjs, components/perfCheck/). */
export const isPerfCheckSurface = !isObsBrowserSourceSurface && !isRemoteControlSurface && searchParams.get('perfCheck') === '1';

export const isMainAppSurface = typeof window !== 'undefined' && !isObsBrowserSourceSurface && !isRemoteControlSurface && !isPerfCheckSurface;
