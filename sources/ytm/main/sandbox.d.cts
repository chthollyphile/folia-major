// sources/ytm/main/sandbox.d.cts
// The types of sandbox.cjs, for main/index.ts (sources/ compiles without allowJs).

/** What the sandbox uses of its partition (api.net.session). */
export interface YtmSandboxSession {
    intercept(scheme: 'http' | 'https', handler: (request: Request) => Response | Promise<Response>): unknown;
    refusePermissions(): unknown;
    setProxy(config: Record<string, unknown>): Promise<void>;
}

export interface YtmSandbox {
    /** Runs one script in the page and resolves to its result. */
    evaluate(code: string): Promise<unknown>;
    /** Closes the page; the next use opens it again. */
    destroy(): void;
}

export function createYtmSandbox(options: {
    session: YtmSandboxSession;
    /** api.windows.hidden: an Electron BrowserWindow. */
    hidden: (options: Record<string, unknown>) => unknown;
    isAllowed?: () => boolean;
    timeoutMs?: number;
}): YtmSandbox;
