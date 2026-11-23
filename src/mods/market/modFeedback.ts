import type { ModAwesomeEntry, ModMarketEntry, ModRuntimeInfo } from '../types';

// src/mods/market/modFeedback.ts
// Where a mod's problems go: its author's tracker, not Folia's. The order is the manifest's `bugs`, its
// `repository` (turned into the tracker of a known forge), then the market catalog's entry for the same id.
// Folia's own mods (built in) go to Folia's tracker, and the market's official mods to folium-compound's.

export const FOLIA_ISSUES_URL = 'https://github.com/chthollyphile/folia-major/issues';
export const COMPOUND_ISSUES_URL = 'https://github.com/chthollyphile/folium-compound/issues';

const FORGES = new Map<string, string>([
    ['github.com', '/issues'],
    ['codeberg.org', '/issues'],
    ['gitlab.com', '/-/issues'],
]);

/** An https link without credentials, or null. */
export const httpsLinkOf = (value: unknown): string | null => {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
};

/** The issue tracker of a repository on a known forge (`<owner>/<repo>` only), or null. */
export const issuesUrlOf = (repository: string | null | undefined): string | null => {
    const link = httpsLinkOf(repository);
    if (!link) return null;
    const url = new URL(link);
    const suffix = FORGES.get(url.hostname.toLowerCase());
    if (!suffix) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[1].replace(/\.git$/i, '');
    return `https://${url.hostname}/${parts[0]}/${repo}${suffix}`;
};

export type ModFeedback = {
    /** Where to report a problem; null when nothing is known. */
    url: string | null;
    /** The source repository, when one is known. */
    repository: string | null;
    /** Whose tracker `url` is: the author's, Folia's (built in) or folium-compound's (official). */
    owner: 'author' | 'folia' | 'compound' | null;
};

const fromLinks = (bugs: string | null | undefined, repository: string | null | undefined): string | null => (
    httpsLinkOf(bugs) ?? issuesUrlOf(repository) ?? httpsLinkOf(repository)
);

/*
 * Where to report a problem with this mod. `installed` and `market` are the same id's runtime info and catalog
 * entry (either may be missing); an awesome entry stands alone.
 */
export const modFeedbackOf = ({ installed, market, awesome }: {
    installed?: ModRuntimeInfo | null;
    market?: ModMarketEntry | null;
    awesome?: ModAwesomeEntry | null;
}): ModFeedback => {
    if (awesome) {
        return { url: fromLinks(awesome.bugs, awesome.url), repository: httpsLinkOf(awesome.url), owner: 'author' };
    }
    if (installed && (installed.tier === 'builtin' || installed.signature.status === 'builtin')) {
        return { url: FOLIA_ISSUES_URL, repository: null, owner: 'folia' };
    }
    const repository = httpsLinkOf(installed?.repository) ?? httpsLinkOf(market?.repository) ?? null;
    const own = fromLinks(installed?.bugs, installed?.repository);
    if (own) return { url: own, repository, owner: 'author' };
    const listed = fromLinks(market?.bugs, market?.repository);
    if (listed) return { url: listed, repository, owner: 'author' };
    if (market?.origin === 'official') return { url: COMPOUND_ISSUES_URL, repository, owner: 'compound' };
    return { url: null, repository, owner: null };
};
