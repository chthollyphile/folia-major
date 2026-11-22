// sources/qishui/main/mediaCors.d.cts
// The types of mediaCors.cjs, for main/index.ts (sources/ compiles without allowJs).

/** The fields of a webRequest read the policy looks at. */
export interface QishuiMediaRead {
    url: string;
    method: string;
    resourceType: string;
    responseHeaders?: Readonly<Record<string, readonly string[] | string>>;
}

export interface QishuiMediaPolicy {
    register(url: string): void;
    allows(details: QishuiMediaRead): boolean;
    followRedirect(details: QishuiMediaRead & { redirectURL: string }): void;
}

export function createQishuiMediaPolicy(options?: { now?: () => number }): QishuiMediaPolicy;
