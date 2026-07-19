// src/utils/obsUrl.ts
// Small helpers to build/parse OBS URLs (pure strings, no external deps - avoids a
// cycle with the appearance codec / settings component).

// Extract the appearance shortcode from user input: the input may be a full OBS URL
// (with a cfg query param) or a bare shortcode / JSON. If it is a URL carrying cfg,
// return the decoded cfg value; otherwise return the input unchanged (decompressConfig
// handles it).
export function extractCfgFromInput(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const cfg = url.searchParams.get('cfg');
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
  // All technical params live in `params`; a new source should add its params via `extra` (or above) —
  // never after cfg.
  const params = new URLSearchParams();
  params.set('obs', '1');
  params.set('obsSource', obsSource);
  if (host) params.set('host', host);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
  }
  // cfg is the long base64 appearance blob — appended as the terminal segment OUTSIDE `params`, so any
  // future param stays in front of it (readable technical params keep leading the URL) by construction.
  const cfgSuffix = cfg ? `&${new URLSearchParams({ cfg }).toString()}` : '';
  return `${origin}${pathname}?${params.toString()}${cfgSuffix}`;
}
