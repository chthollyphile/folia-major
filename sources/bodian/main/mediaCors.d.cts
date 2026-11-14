// sources/bodian/main/mediaCors.d.cts
// The types of mediaCors.cjs, for main/index.ts (sources/ compiles without allowJs).

/** The fields of a webRequest read the policy looks at. */
export interface BodianMediaRead {
    url: string;
    method: string;
    resourceType: string;
    responseHeaders?: Readonly<Record<string, readonly string[] | string>>;
}

export interface BodianMediaPolicy {
    register(url: string): void;
    allows(details: BodianMediaRead): boolean;
    followRedirect(details: BodianMediaRead & { redirectURL: string }): void;
}

export function createBodianMediaPolicy(options?: { now?: () => number }): BodianMediaPolicy;
