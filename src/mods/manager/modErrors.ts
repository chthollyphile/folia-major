// src/mods/manager/modErrors.ts
// Loader error codes as panel text, shared by the mods view, its detail pane and the storage section.

const CODE = /^[a-z0-9-]+$/;

/*
 * Maps a loader error code onto its localized message. A code may carry its detail after a colon
 * (`install-invalid-manifest:<why>`, `market-signature-invalid:<reason>`): the part before it is the key and
 * the rest is `value` (the whole code when there is no detail). Codes that have no entry (a raw JS message
 * from a mod's own failure) fall through to themselves. `extra` adds values some messages quote.
 */
export const translateModError = (
    t: (key: string, options: Record<string, unknown>) => string,
    error: string | null | undefined,
    fallbackCode: string,
    extra: Record<string, unknown> = {},
): string => {
    const code = error ?? fallbackCode;
    const split = code.indexOf(':');
    const head = split > 0 && CODE.test(code.slice(0, split)) ? code.slice(0, split) : code;
    const detail = head === code ? code : code.slice(split + 1).trim();
    // A `:` inside the key would read as an i18next namespace, so only a plain code is ever looked up.
    return CODE.test(head) ? t(`mods.errors.${head}`, { value: detail, defaultValue: code, ...extra }) : code;
};
