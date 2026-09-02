import type { CappellaAvatarImage, CappellaEmojiImage } from '../../types';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';

// src/services/obs/obsCustomCss.ts
// Carries the uploaded OBS assets the cfg URL cannot (an IndexedDB blob has no shareable URL) through
// the OBS Browser Source "Custom CSS" field instead: the producer downsamples each asset into a data
// URL packed as a :root custom property, and the overlay reads it back with getComputedStyle. This
// keeps the (already long) cfg URL untouched and, unlike reading IndexedDB, works for a remote OBS
// whose browser context never saw the upload.

// Downscale ceilings: the Monet pipeline rasterises the background at 1920x1080 and blurs it, so a
// smaller source is invisible; the portrait is drawn far smaller still; Cappella emojis/avatars are
// tiny on screen. All keep the base64 payload within what the OBS CSS field comfortably holds.
const BACKGROUND_MAX_SIZE = 1280;
const PORTRAIT_MAX_SIZE = 640;
const CAPPELLA_AVATAR_MAX_SIZE = 256;
const CAPPELLA_EMOJI_MAX_SIZE = 128;
const BACKGROUND_QUALITY = 0.82;

// Raw-passthrough budgets for animated GIF assets. Portraits / Cappella packs render through
// <img> / CSS background-image, so a canvas snapshot silently kills the animation the main app
// shows. When a GIF fits, we ship the original bytes as `data:image/gif;base64,...` and preserve
// frames. Backgrounds always stay on the canvas path (Monet and Nomand process images through their
// still frame anyway, so raw bytes would only bloat the payload).
// The absolute cap on the full CSS snippet keeps the OBS Custom CSS box within its comfortable
// range (see obs-browser browser-client.cpp: CSS goes through CefURIEncode + ExecuteJavaScript over
// a Mojo IPC with a 128 MB message limit; 12 MB is well below the point where the editor UI, scene
// save/load, and the CEF apply step start to feel it). RAW_PORTRAIT / RAW_CAPPELLA_ITEM are
// per-file, and the downgrade pass in buildObsCustomCss enforces the total.
const RAW_PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;
const RAW_CAPPELLA_ITEM_MAX_BYTES = 4 * 1024 * 1024;
const TOTAL_CSS_MAX_BYTES = 12 * 1024 * 1024;
const GIF_MIME = 'image/gif';

const OBS_CSS_BACKGROUND_VAR = '--folia-obs-custom-bg';
const OBS_CSS_PORTRAIT_VAR = '--folia-obs-custom-portrait';
const OBS_CSS_CAPPELLA_EMOJIS_VAR = '--folia-obs-cappella-emojis';
const OBS_CSS_CAPPELLA_AVATARS_VAR = '--folia-obs-cappella-avatars';

// {id, name, url} — the shape both Cappella packs share and the overlay consumes.
interface NamedImageAsset {
  id: string;
  name: string;
  url: string;
}

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  // Uploaded assets are same-origin blob: URLs, so no crossOrigin is needed; guard http(s) anyway in
  // case a future caller passes a remote source.
  if (/^https?:/i.test(src)) {
    image.crossOrigin = 'anonymous';
  }
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
  image.src = src;
});

// Re-encode a source image to a size-bounded data URL. JPEG for the opaque background (smallest);
// PNG elsewhere so an uploaded cut-out (portrait, emoji, avatar) keeps its transparency.
const encodeBoundedDataUrl = async (
  sourceUrl: string,
  maxSize: number,
  mimeType: 'image/jpeg' | 'image/png',
  quality?: number,
): Promise<string | null> => {
  const image = await loadImage(sourceUrl);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    return null;
  }

  const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
};

// Peek at the source blob so we can branch on MIME (raw-GIF passthrough vs canvas). Returns null on
// fetch / decode failure so callers can silently fall through to the canvas path.
const readSourceBlob = async (sourceUrl: string): Promise<Blob | null> => {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    console.warn('OBS CSS: failed to read source blob, falling back.', err);
    return null;
  }
};

// Chunked binary -> base64. Uploaded assets can be several MB, and String.fromCharCode(...bytes) on
// the whole array blows the call stack past a few hundred KB.
const encodeBlobAsBase64DataUrl = async (blob: Blob, mimeType: string): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

// Encoded asset with just enough context to be re-encoded down to a canvas snapshot later, in case
// the total-budget pass in buildObsCustomCss decides to drop this raw GIF frame.
interface EncodedAsset {
  dataUrl: string;
  // True while we hold the raw GIF; buildObsCustomCss can downgrade it to canvas to fit the total.
  isRawGif: boolean;
  // Downgrade recipe. Preserved even for canvas-first assets so the shape stays uniform.
  sourceUrl: string;
  canvasMaxSize: number;
  canvasMime: 'image/jpeg' | 'image/png';
  canvasQuality?: number;
}

// Prefer raw-GIF passthrough for animated inputs (portrait / Cappella packs) when the file fits its
// per-item budget; otherwise fall back to the canvas snapshot path. rawBudget=0 disables raw entirely
// (backgrounds always stay canvas). A corrupt file / stale blob URL is isolated here so one asset
// cannot take down the whole copy operation.
const safeEncodeAssetDataUrl = async (
  sourceUrl: string,
  canvasMaxSize: number,
  canvasMime: 'image/jpeg' | 'image/png',
  rawBudget: number,
  canvasQuality?: number,
): Promise<EncodedAsset | null> => {
  try {
    if (rawBudget > 0) {
      const blob = await readSourceBlob(sourceUrl);
      if (blob && blob.type === GIF_MIME && blob.size <= rawBudget) {
        const dataUrl = await encodeBlobAsBase64DataUrl(blob, GIF_MIME);
        return { dataUrl, isRawGif: true, sourceUrl, canvasMaxSize, canvasMime, canvasQuality };
      }
    }
    const canvasUrl = await encodeBoundedDataUrl(sourceUrl, canvasMaxSize, canvasMime, canvasQuality);
    return canvasUrl
      ? { dataUrl: canvasUrl, isRawGif: false, sourceUrl, canvasMaxSize, canvasMime, canvasQuality }
      : null;
  } catch (err) {
    console.warn('OBS CSS: failed to encode asset, skipping.', err);
    return null;
  }
};

// UTF-8-safe base64, chunked so a large pack never overflows the call stack. A JSON list of data URLs
// carries characters ("/;,) and non-ASCII emoji names that are awkward to escape inside a raw CSS
// string, so packing it as base64 keeps the custom-property value a single CSS-safe token.
const encodeBase64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const decodeBase64Utf8 = (value: string): string => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
};

// Encode every image in a pack, keeping the {id, name, encoded} shape so the downgrade pass in
// buildObsCustomCss can walk raw-GIF entries alongside single-asset raw-GIFs. Encoding is isolated
// per entry so a single corrupt file cannot take down the rest of the pack.
interface EncodedPackEntry {
  id: string;
  name: string;
  encoded: EncodedAsset;
}

const encodeImagePack = async (
  images: NamedImageAsset[],
  canvasMaxSize: number,
  rawBudget: number,
): Promise<EncodedPackEntry[]> => {
  const results = await Promise.all(images.map(async (image) => {
    const encoded = await safeEncodeAssetDataUrl(image.url, canvasMaxSize, 'image/png', rawBudget);
    return encoded ? { id: image.id, name: image.name, encoded } : null;
  }));
  return results.filter((entry): entry is EncodedPackEntry => entry !== null);
};

// Serialise the surviving pack entries into the base64(JSON) form the overlay parses. Reads the
// current encoded.dataUrl, so a downgrade in the total-budget pass shows up here for free.
const serialiseEncodedPack = (entries: EncodedPackEntry[]): string | null => {
  if (entries.length === 0) return null;
  const list = entries.map((entry) => ({ id: entry.id, name: entry.name, url: entry.encoded.dataUrl }));
  return encodeBase64Utf8(JSON.stringify(list));
};

export interface BuildObsCustomCssResult {
  css: string;
  // Count of GIFs we had to downgrade to a canvas snapshot to stay under TOTAL_CSS_MAX_BYTES so the
  // caller can warn the user "your animation was flattened".
  degradedGifCount: number;
}

// Build the CSS snippet the user pastes into OBS Browser Source -> Custom CSS. Returns null when no
// uploaded asset is actually in use, so callers can hide the affordance. Includes OBS's own
// transparent-body reset so the snippet is a complete drop-in replacement, not an addition.
export const buildObsCustomCss = async (): Promise<BuildObsCustomCssResult | null> => {
  const storeVisualizer = useVisualizerSettingsStore.getState();
  const storeAssets = useVisualizerAssetStore.getState();
  const usesUploadedBackground = storeVisualizer.monetBackgroundTuning.backgroundSource === 'uploaded-global'
    || storeVisualizer.nomandBackgroundTuning.imageSource === 'uploaded-global';
  const usesCustomPortrait = storeVisualizer.monetTuning.portraitSource === 'custom';
  const usesCustomEmojis = storeVisualizer.cappellaTuning.emojiPackSource === 'custom'
    && storeAssets.cappellaCustomEmojiImages.length > 0;
  const usesCustomAvatars = storeVisualizer.cappellaTuning.avatarSource === 'custom'
    && storeAssets.cappellaCustomAvatarImages.length > 0;

  const [background, portrait, emojiEntries, avatarEntries] = await Promise.all([
    usesUploadedBackground && storeAssets.monetBackgroundImage
      ? safeEncodeAssetDataUrl(storeAssets.monetBackgroundImage.url, BACKGROUND_MAX_SIZE, 'image/jpeg', 0, BACKGROUND_QUALITY)
      : null,
    usesCustomPortrait && storeAssets.monetPortraitImage
      ? safeEncodeAssetDataUrl(storeAssets.monetPortraitImage.url, PORTRAIT_MAX_SIZE, 'image/png', RAW_PORTRAIT_MAX_BYTES)
      : null,
    usesCustomEmojis
      ? encodeImagePack(storeAssets.cappellaCustomEmojiImages, CAPPELLA_EMOJI_MAX_SIZE, RAW_CAPPELLA_ITEM_MAX_BYTES)
      : [] as EncodedPackEntry[],
    usesCustomAvatars
      ? encodeImagePack(storeAssets.cappellaCustomAvatarImages, CAPPELLA_AVATAR_MAX_SIZE, RAW_CAPPELLA_ITEM_MAX_BYTES)
      : [] as EncodedPackEntry[],
  ]);

  // Total-budget downgrade pass. Every raw GIF we picked can still be re-encoded to a canvas snapshot
  // if the whole snippet blows past TOTAL_CSS_MAX_BYTES; we shed the largest one at a time, in place,
  // until we fit or nothing raw is left. The dataUrl length is a fine proxy for the CSS byte count -
  // everything downstream is ASCII plus a fixed wrapper per slot.
  const collectAssets = (): EncodedAsset[] => [
    ...(background ? [background] : []),
    ...(portrait ? [portrait] : []),
    ...emojiEntries.map((entry) => entry.encoded),
    ...avatarEntries.map((entry) => entry.encoded),
  ];
  const totalBytes = () => collectAssets().reduce((sum, asset) => sum + asset.dataUrl.length, 0);
  let degradedGifCount = 0;
  while (totalBytes() > TOTAL_CSS_MAX_BYTES) {
    const rawEntries = collectAssets().filter((asset) => asset.isRawGif);
    if (rawEntries.length === 0) break;
    rawEntries.sort((a, b) => b.dataUrl.length - a.dataUrl.length);
    const target = rawEntries[0];
    try {
      const snapshot = await encodeBoundedDataUrl(target.sourceUrl, target.canvasMaxSize, target.canvasMime, target.canvasQuality);
      if (!snapshot) {
        // Canvas path also unusable for this asset; mark non-raw so we don't retry it forever.
        target.isRawGif = false;
        continue;
      }
      target.dataUrl = snapshot;
      target.isRawGif = false;
      degradedGifCount += 1;
    } catch (err) {
      console.warn('OBS CSS: failed to downgrade raw GIF asset, dropping animation.', err);
      target.isRawGif = false;
    }
  }

  const declarations: string[] = [];
  if (background) {
    declarations.push(`  ${OBS_CSS_BACKGROUND_VAR}: url("${background.dataUrl}");`);
  }
  if (portrait) {
    declarations.push(`  ${OBS_CSS_PORTRAIT_VAR}: url("${portrait.dataUrl}");`);
  }
  const emojiList = serialiseEncodedPack(emojiEntries);
  if (emojiList) {
    declarations.push(`  ${OBS_CSS_CAPPELLA_EMOJIS_VAR}: "${emojiList}";`);
  }
  const avatarList = serialiseEncodedPack(avatarEntries);
  if (avatarList) {
    declarations.push(`  ${OBS_CSS_CAPPELLA_AVATARS_VAR}: "${avatarList}";`);
  }

  if (declarations.length === 0) {
    return null;
  }

  const css = [
    '/* Folia OBS custom assets. Paste into OBS Browser Source -> Custom CSS. */',
    'body { background-color: rgba(0, 0, 0, 0); margin: 0; overflow: hidden; }',
    ':root {',
    ...declarations,
    '}',
    '',
  ].join('\n');
  return { css, degradedGifCount };
};

// Pull the data URL out of a `url("data:...")` custom-property value. Returns null for anything that
// is not a data URL (empty property, hand-edited CSS), so the overlay only ever adopts a real asset.
export const parseObsCssDataUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/url\(\s*["']?(data:[^"')]+)["']?\s*\)/);
  return match ? match[1] : null;
};

// Decode a base64(JSON) image-list custom property back into {id, name, url} entries. Any decode /
// shape failure yields an empty list so a hand-mangled CSS field can never throw in the overlay.
export const parseObsCssImageList = (value: string | null | undefined): NamedImageAsset[] => {
  if (!value) {
    return [];
  }
  const stripped = value.trim().replace(/^["']|["']$/g, '');
  if (!stripped) {
    return [];
  }
  try {
    const parsed = JSON.parse(decodeBase64Utf8(stripped));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry.url === 'string' && entry.url.startsWith('data:'))
      .map((entry) => ({ id: String(entry.id ?? ''), name: String(entry.name ?? ''), url: entry.url as string }));
  } catch {
    return [];
  }
};

export interface ObsCustomCssAssets {
  backgroundUrl: string | null;
  portraitUrl: string | null;
  cappellaEmojis: CappellaEmojiImage[];
  cappellaAvatars: CappellaAvatarImage[];
}

// Consumer side (OBS overlay): read the assets OBS injected via the Custom CSS field. Absent field ->
// empty, i.e. fall back to the previous cover-derived / builtin-pack behaviour.
export const readObsCustomCssAssets = (): ObsCustomCssAssets => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return { backgroundUrl: null, portraitUrl: null, cappellaEmojis: [], cappellaAvatars: [] };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    backgroundUrl: parseObsCssDataUrl(style.getPropertyValue(OBS_CSS_BACKGROUND_VAR)),
    portraitUrl: parseObsCssDataUrl(style.getPropertyValue(OBS_CSS_PORTRAIT_VAR)),
    cappellaEmojis: parseObsCssImageList(style.getPropertyValue(OBS_CSS_CAPPELLA_EMOJIS_VAR)),
    cappellaAvatars: parseObsCssImageList(style.getPropertyValue(OBS_CSS_CAPPELLA_AVATARS_VAR)),
  };
};
