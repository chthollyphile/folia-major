// src/components/perfCheck/openPerfCheck.ts
// Opens the performance check's window (electron/perfCheck.cjs). Its own module so the settings page
// and the command palette can call it without loading the check's components.

/** Opens the check's window; false where there is none (the web build). */
export const openPerfCheck = (): boolean => {
    const open = window.electron?.openPerfCheck;
    if (!open) return false;
    void open().catch((error: unknown) => console.warn('[PerfCheck] could not open the window', error));
    return true;
};
