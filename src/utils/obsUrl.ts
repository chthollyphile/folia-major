// src/utils/obsUrl.ts
// Small helpers to build/parse OBS URLs (pure strings, no external deps -avoids a
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

// Build the NowPlaying OBS overlay URL: burn the current appearance shortcode and the
// source endpoint into a link.
export function buildObsNowPlayingUrl(shortcode: string, host: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const params = new URLSearchParams();
  params.set('obs', '1');
  params.set('obsSource', 'now-playing');
  if (host) params.set('host', host);
  if (shortcode) params.set('cfg', shortcode);
  return `${origin}${pathname}?${params.toString()}`;
}
