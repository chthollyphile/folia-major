// src/utils/accountIdDisplay.ts
// Account IDs act as pseudonyms; keep the start of long IDs and mark the remainder with an ellipsis.
// Short numeric IDs remain unchanged.

/** How much of a long account id the account rows keep. */
export const ACCOUNT_ID_PREFIX = 12;

export const shortAccountId = (id: string, keep = ACCOUNT_ID_PREFIX): string => (
    id.length <= keep ? id : `${id.slice(0, keep)}...`
);
