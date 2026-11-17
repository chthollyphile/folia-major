// src/utils/obsUrl.ts
// Small helpers to build/parse OBS URLs (pure strings, no external deps - avoids a
// cycle with the appearance codec / settings component).

// Read cfg from a URL's fragment and query string. buildObsSourceUrl writes it into the fragment
// (#cfg=...); links copied before that carry it in the query string, so the query is the fallback.
// A fragment without cfg (e.g. #home) is ignored. Either argument may keep its leading '?' / '#',
// as location.search / location.hash do.
export function readCfgParam(search: string, hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('cfg') || new URLSearchParams(search).get('cfg');
}

// Extract the appearance shortcode from user input: the input may be a full OBS URL
// (with cfg in the fragment, or in the query string for older links) or a bare shortcode / JSON.
// If it is a URL carrying cfg, return the decoded cfg value; otherwise return the input unchanged
// (decompressConfig handles it).
export function extractCfgFromInput(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const cfg = readCfgParam(url.search, url.hash);
    if (cfg) return cfg;
  } catch {
    // Not a URL: treat as a bare shortcode / JSON.
  }
  return trimmed;
}

// Build an OBS overlay URL for a given web source: burn the appearance shortcode and the
// endpoint into a link. Source-neutral - obsSource selects the browser-direct source
// ('now-playing' or 'playercap'). Host may be empty to use the page default. extra carries
// source-specific technical params (e.g. daylight, or PlayerCap's nxpcPlayer/nxpcBasis/nxpcSticky).
export function buildObsSourceUrl(obsSource: string, cfg: string, host: string, extra?: Record<string, string>): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  // All technical params live in `params` (the query string); a new source should add its params via
  // `extra` (or above) — never into the fragment next to cfg.
  const params = new URLSearchParams();
  params.set('obs', '1');
  params.set('obsSource', obsSource);
  if (host) params.set('host', host);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
  }
  // cfg is the long base64 appearance blob (about 11 KB with default settings). It goes in the fragment,
  // OUTSIDE `params`: the browser never sends the fragment to the server, so hosting front ends that
  // cap the request URL (e.g. Azure Front Door rejects query strings over 8192 bytes) still serve the page.
  // Keeping it after the query also leaves the readable technical params leading the URL.
  const cfgFragment = cfg ? `#${new URLSearchParams({ cfg }).toString()}` : '';
  return `${origin}${pathname}?${params.toString()}${cfgFragment}`;
}
