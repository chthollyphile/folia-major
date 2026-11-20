// src/utils/coverUrl.ts

const NON_RESIZABLE_COVER_PROTOCOLS = new Set(['blob:', 'data:', 'file:', 'filesystem:']);
// Apple's artwork CDN names the box in the file name (`…/512x512bb.jpg`) and renders any size into it.
const APPLE_COVER_HOST_PATTERN = /(?:^|\.)mzstatic\.com$/i;
const APPLE_COVER_PATH_PATTERN = /\/(\d+)x(\d+)([a-z]{2})?\.(jpe?g|png|webp)$/i;
const APPLE_COVER_ORIGINAL_BOX = 5000;
// Google's picture hosts take the size as an ending (`=w544-h544-l90-rj`) and serve any size named.
const GOOGLE_COVER_HOST_PATTERN = /\.(?:googleusercontent|ggpht)\.com$/i;
const GOOGLE_COVER_SIZE_PATTERN = /=w(\d+)-h(\d+)((?:-[^=/]*)?)$/;
export const LOCAL_COVER_THUMBNAIL_SIZES = [512, 1024] as const;

export const resolveLocalCoverThumbnailSize = (size: number): number => {
    const normalizedSize = Math.max(1, Math.round(size));
    return LOCAL_COVER_THUMBNAIL_SIZES.find(candidate => candidate >= normalizedSize)
        ?? LOCAL_COVER_THUMBNAIL_SIZES[LOCAL_COVER_THUMBNAIL_SIZES.length - 1];
};

const withLocalCoverThumbnailSize = (url: URL, size: number): string => {
    url.searchParams.set('size', String(resolveLocalCoverThumbnailSize(size)));
    return url.toString();
};

// Only a square box is rewritten: a wide one (a banner, a video still) keeps the shape it was given.
const squareSize = (match: RegExpExecArray | null): number | null => (
    match && match[1] === match[2] ? Number(match[1]) : null
);

const isAppleCoverUrl = (url: URL): boolean => (
    APPLE_COVER_HOST_PATTERN.test(url.hostname) && squareSize(APPLE_COVER_PATH_PATTERN.exec(url.pathname)) !== null
);

const withAppleCoverSize = (url: URL, size: number): string => {
    url.pathname = url.pathname.replace(APPLE_COVER_PATH_PATTERN, (_match, _w, _h, box = '', extension: string) => (
        `/${size}x${size}${box}.${extension}`
    ));
    return url.toString();
};

const isGoogleCoverUrl = (url: URL): boolean => (
    GOOGLE_COVER_HOST_PATTERN.test(url.hostname) && squareSize(GOOGLE_COVER_SIZE_PATTERN.exec(url.pathname)) !== null
);

const withGoogleCoverSize = (url: URL, size: number): string => {
    url.pathname = url.pathname.replace(GOOGLE_COVER_SIZE_PATTERN, (_match, _w, _h, rest: string) => `=w${size}-h${size}${rest}`);
    return url.toString();
};

/**
 * How one picture host is asked for a size, given only a cover URL. A method answers null for a URL that is
 * not this rule's to rewrite, and the host's generic rule stands for it.
 *
 * Folium 2.0 seam (S1): the rules are a registry (`registerCoverUrlRule`), fed today from the table below; in S3
 * each source declares its own through its `covers@1` capability (its sync `sized(url, size)` and
 * `identity(url)`), and the table goes. Only the generic rules stay in this file: local thumbnails, Navidrome's
 * getCoverArt, and the protocols that cannot be resized.
 */
export interface CoverUrlRule {
    /** The name describeCoverUrl gives the host. */
    provider: CoverProvider;
    /** The `size`-pixel variant. */
    sized(url: URL, size: number): string | null;
    /** What names the artwork, apart from how it is fetched (getCoverIdentity). */
    identity(url: URL): string | null;
    /** The original asset (getOriginalCoverUrl). */
    original(url: URL): string | null;
    /** The size the URL asks for; null where it asks for none (describeCoverUrl). Undefined: not this rule's URL. */
    requestedSize(url: URL): number | null | undefined;
    /** The `size`-pixel variant of a text that does not parse as a URL. */
    sizedText?(text: string, size: number): string | null;
    /** True for a picture the web build fetches through the lyric proxy (the host sends no CORS headers). By host alone. */
    proxiedOnWeb?(url: URL): boolean;
}

const parseSize = (value: string | null | undefined): number | null => {
    const size = Number(String(value ?? '').split(/[xy]/i)[0]);
    return Number.isFinite(size) && size > 0 ? size : null;
};

// The picture hosts' rules as the host has always had them: one entry each, in no order that matters (no two
// match one URL). The size steps of each are explained where its helpers are, above.
const BUILT_IN_COVER_URL_RULES: readonly CoverUrlRule[] = [
    {
        provider: 'apple',
        sized: (url, size) => (isAppleCoverUrl(url) ? withAppleCoverSize(url, size) : null),
        identity: url => (isAppleCoverUrl(url) ? `apple:${url.pathname.replace(APPLE_COVER_PATH_PATTERN, '/*')}` : null),
        // Apple fits the picture into the box and stops at the original (5000 measured; 100000 is refused).
        original: url => (isAppleCoverUrl(url) ? withAppleCoverSize(url, APPLE_COVER_ORIGINAL_BOX) : null),
        requestedSize: url => (isAppleCoverUrl(url) ? parseSize(APPLE_COVER_PATH_PATTERN.exec(url.pathname)?.[1]) : undefined),
    },
    {
        provider: 'google',
        sized: (url, size) => (isGoogleCoverUrl(url) ? withGoogleCoverSize(url, size) : null),
        identity: url => (isGoogleCoverUrl(url) ? `google:${url.pathname.replace(GOOGLE_COVER_SIZE_PATTERN, '')}` : null),
        // Google's `=s0` ending is the original itself.
        original: (url) => {
            if (!isGoogleCoverUrl(url)) return null;
            url.pathname = url.pathname.replace(GOOGLE_COVER_SIZE_PATTERN, '=s0');
            return url.toString();
        },
        requestedSize: url => (isGoogleCoverUrl(url) ? parseSize(GOOGLE_COVER_SIZE_PATTERN.exec(url.pathname)?.[1]) : undefined),
    },
];

const coverUrlRules: CoverUrlRule[] = [...BUILT_IN_COVER_URL_RULES];

/** Adds a picture host's rule (Folium 2.0: a source's covers capability); returns the function that takes it out. */
export const registerCoverUrlRule = (rule: CoverUrlRule): (() => void) => {
    coverUrlRules.push(rule);
    return () => {
        const at = coverUrlRules.indexOf(rule);
        if (at >= 0) coverUrlRules.splice(at, 1);
    };
};

/** Whether the web build fetches the picture at `url` through the lyric proxy (coverCache.ts), by its host's rule. */
export const isCoverFetchedThroughProxy = (url: string): boolean => {
    try {
        const urlObj = new URL(url);
        return coverUrlRules.some(rule => rule.proxiedOnWeb?.(urlObj) === true);
    } catch {
        return false;
    }
};

// The first rule's answer for `url`. One URL object goes round (this is on the covers' hot path): a rule rewrites
// it only for a URL of its own, and then answers.
const firstRuleAnswer = <T>(url: URL, ask: (rule: CoverUrlRule, url: URL) => T | null | undefined): T | null | undefined => {
    for (const rule of coverUrlRules) {
        const answer = ask(rule, url);
        if (answer !== null && answer !== undefined) return answer;
    }
    return undefined;
};

/**
 * Restores the original CDN asset when the source URL exposes a known resize suffix.
 */
export const getOriginalCoverUrl = (url: string | null | undefined): string => {
    const trimmedUrl = url?.trim() ?? '';
    if (!trimmedUrl) return '';

    try {
        return firstRuleAnswer(new URL(trimmedUrl), (rule, url) => rule.original(url)) ?? trimmedUrl;
    } catch {
        return trimmedUrl;
    }
};

/**
 * Names the artwork a cover URL points at, ignoring what only changes how it is fetched: the query
 * string and fragment, the protocol, Netease's interchangeable pN hosts, and the size QQ, KuGou,
 * Kuwo and Apple write into the path (or Google into its ending). Two URLs with the same key show the same picture, so callers can
 * compare covers (one album cover shared by every track, a cover flying back to its tile) without
 * being fooled by the CDN handing the same file out under different names.
 */
export const getCoverIdentity = (url: string | null | undefined): string => {
    const trimmedUrl = url?.trim() ?? '';
    if (!trimmedUrl) return '';

    try {
        const urlObj = new URL(trimmedUrl);
        if (NON_RESIZABLE_COVER_PROTOCOLS.has(urlObj.protocol)) return trimmedUrl;
        const identity = firstRuleAnswer(urlObj, (rule, url) => rule.identity(url));
        if (identity) return identity;
    } catch {
        // Relative paths (/__folia_cover/…) fall through to the plain rule.
    }
    return trimmedUrl.split(/[?#]/)[0];
};

/**
 * Resolves a cover image URL to a smaller CDN variant when the source supports it.
 */
export const getSizedCoverUrl = (url: string | null | undefined, size: number): string => {
    const trimmedUrl = url?.trim() ?? '';
    if (!trimmedUrl) return '';

    const normalizedSize = Math.max(1, Math.round(size));

    try {
        const urlObj = new URL(trimmedUrl);
        if (NON_RESIZABLE_COVER_PROTOCOLS.has(urlObj.protocol)) {
            return trimmedUrl;
        }

        if (urlObj.protocol === 'folia-cover:') {
            return withLocalCoverThumbnailSize(urlObj, normalizedSize);
        }

        const sized = firstRuleAnswer(urlObj, (rule, url) => rule.sized(url, normalizedSize));
        if (sized) return sized;

        if (urlObj.pathname.includes('getCoverArt')) {
            urlObj.searchParams.set('size', String(normalizedSize));
            return urlObj.toString();
        }

        return trimmedUrl;
    } catch {
        if (trimmedUrl.startsWith('/__folia_cover/')) {
            const localUrl = new URL(trimmedUrl, 'https://folia.local');
            localUrl.searchParams.set('size', String(resolveLocalCoverThumbnailSize(normalizedSize)));
            return `${localUrl.pathname}${localUrl.search}`;
        }

        for (const rule of coverUrlRules) {
            const sized = rule.sizedText?.(trimmedUrl, normalizedSize);
            if (sized) return sized;
        }

        return trimmedUrl;
    }
};

/**
 * Widths a card is allowed to ask for. The steps double, so a box has to change gear by a factor
 * of two before its artwork is refetched, and every one of them lands on something the providers
 * actually serve: QQ rounds 256 up to its own 300 bucket, 512 up to 800 and 1024 up to 1200; Kuwo uses 240 and 800 below that and the size given above. Local thumbnails are
 * stored at exactly 512 and 1024, and Netease, KuGou and Navidrome resize to the number given.
 * Quantising also keeps the URL shared between cards showing the same song at similar sizes, which
 * is what lets the browser hand them all one decoded bitmap.
 */
export const COVER_SIZE_STEPS = [256, 512, 1024] as const;

/**
 * Most a many-cover surface (the wall) asks for past its top step. Providers' originals run to
 * 3000×3000, and Chromium decodes an image that big again for every tile it rasters, so a wall
 * holding a few of them stalls for hundreds of milliseconds while panning; 1200 still covers the
 * largest card (an expanded one at DPR 2 is about 1230 device pixels across).
 */
export const COVER_MAX_SIZE = 1200;

/**
 * Smallest step that still covers `size` device pixels. Past the top step there is no bucket left
 * to ask for, so the answer is `Infinity`: the caller asks for `COVER_MAX_SIZE`, not the provider's
 * own asset.
 */
export const resolveCoverSizeStep = (size: number): number => (
    COVER_SIZE_STEPS.find(step => step >= size) ?? Number.POSITIVE_INFINITY
);

export type CoverProvider = 'netease' | 'kugou' | 'qq' | 'apple' | 'google' | 'navidrome' | 'local' | 'other' | (string & {});

export interface CoverUrlDescription {
    provider: CoverProvider;
    /** Size this URL asks for, or null when it carries none and the provider answers with its original. */
    requestedSize: number | null;
}

/**
 * Reads back what a cover URL is asking its provider for - the inverse of `getSizedCoverUrl`, kept
 * beside it so the host rules are written once. The debug overlay uses it to line up what was
 * requested against the dimensions the CDN actually returned, which is the only way to find out
 * that a provider quietly ignores or clamps a size.
 */
export const describeCoverUrl = (url: string | null | undefined): CoverUrlDescription | null => {
    const trimmedUrl = url?.trim() ?? '';
    if (!trimmedUrl) return null;

    try {
        const urlObj = new URL(trimmedUrl);
        if (NON_RESIZABLE_COVER_PROTOCOLS.has(urlObj.protocol)) return null;
        if (urlObj.protocol === 'folia-cover:') {
            return { provider: 'local', requestedSize: parseSize(urlObj.searchParams.get('size')) };
        }
        for (const rule of coverUrlRules) {
            const requestedSize = rule.requestedSize(urlObj);
            if (requestedSize !== undefined) return { provider: rule.provider, requestedSize };
        }
        if (urlObj.pathname.includes('getCoverArt')) {
            return { provider: 'navidrome', requestedSize: parseSize(urlObj.searchParams.get('size')) };
        }
        return { provider: 'other', requestedSize: null };
    } catch {
        if (trimmedUrl.startsWith('/__folia_cover/')) {
            const localUrl = new URL(trimmedUrl, 'https://folia.local');
            return { provider: 'local', requestedSize: parseSize(localUrl.searchParams.get('size')) };
        }
        return null;
    }
};
