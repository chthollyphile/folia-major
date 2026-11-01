// src/utils/accountIdDisplay.ts
// An account's id is shown beside its platform as a pseudonym. Some providers use a long one (an
// Apple Music account is 64 hex characters), more than the row can show: keep its start, mark the
// rest with an ellipsis. Short ids (a numeric NetEase id, say) are left as they are.

/** How much of a long account id the account rows keep. */
export const ACCOUNT_ID_PREFIX = 12;

export const shortAccountId = (id: string, keep = ACCOUNT_ID_PREFIX): string => (
    id.length <= keep ? id : `${id.slice(0, keep)}...`
);
