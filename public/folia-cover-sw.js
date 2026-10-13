// public/folia-cover-sw.js
// Serves validated content-addressed local cover files directly from OPFS.
// Not registered on its own: vite.config.ts imports it into the PWA worker (workbox importScripts),
// which owns install/activate (skipWaiting + clientsClaim from registerType 'autoUpdate'). Only the
// fetch listener lives here, and it answers nothing outside /__folia_cover/, so the precache and
// navigation routes registered after it still see every other request.

const COVER_PATH_PREFIX = '/__folia_cover/';
const ASSET_ID_PATTERN = /^sha256:([0-9a-f]{64})$/;
const THUMBNAIL_SIZES = new Set([512, 1024]);
const thumbnailJobs = new Map();
const thumbnailQueue = [];
let activeThumbnailJobs = 0;
const ALLOWED_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const parseThumbnailSize = (requestUrl) => {
  const value = Number(requestUrl.searchParams.get('size'));
  return Number.isInteger(value) && THUMBNAIL_SIZES.has(value) ? value : null;
};

// Keeps first-use full-resolution decodes bounded while protocol requests wait asynchronously.
const scheduleThumbnailJob = (task) => new Promise((resolve, reject) => {
  const run = async () => {
    activeThumbnailJobs += 1;
    try {
      resolve(await task());
    } catch (error) {
      reject(error);
    } finally {
      activeThumbnailJobs -= 1;
      thumbnailQueue.shift()?.();
    }
  };
  if (activeThumbnailJobs < 2) void run();
  else thumbnailQueue.push(() => void run());
});

// Generates one content-addressed derivative and closes decoded bitmap memory immediately.
const getOrCreateThumbnail = async (directory, digest, sourceFile, requestedSize) => {
  const thumbnailName = `${digest}.bin.${requestedSize}.webp`;
  try {
    return await directory.getFileHandle(thumbnailName).then(handle => handle.getFile());
  } catch {
    // Continue with lazy generation.
  }

  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
  const jobKey = `${digest}:${requestedSize}`;
  const existingJob = thumbnailJobs.get(jobKey);
  if (existingJob) return await existingJob;

  const job = scheduleThumbnailJob(async () => {
    const bitmap = await createImageBitmap(sourceFile);
    try {
      const scale = Math.min(1, requestedSize / Math.max(bitmap.width, bitmap.height));
      if (scale >= 1) return null;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      const thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      if (!thumbnail || thumbnail.size <= 0) return null;
      const handle = await directory.getFileHandle(thumbnailName, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(thumbnail);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      return await handle.getFile();
    } finally {
      bitmap.close();
    }
  }).finally(() => thumbnailJobs.delete(jobKey));
  thumbnailJobs.set(jobKey, job);
  return await job;
};

const getCoverResponse = async (requestUrl) => {
  let assetId;
  try {
    assetId = decodeURIComponent(requestUrl.pathname.slice(COVER_PATH_PREFIX.length));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const match = ASSET_ID_PATTERN.exec(assetId);
  if (!match) return new Response('Bad request', { status: 400 });

  try {
    const root = await navigator.storage.getDirectory();
    const foliaRoot = await root.getDirectoryHandle('folia-cache');
    const directory = await foliaRoot.getDirectoryHandle('local-cover-assets');
    const [file, rawDescriptor] = await Promise.all([
      directory.getFileHandle(`${match[1]}.bin`).then(handle => handle.getFile()),
      directory.getFileHandle(`${match[1]}.json`).then(handle => handle.getFile()).then(value => value.text()),
    ]);
    const descriptor = JSON.parse(rawDescriptor);
    const mimeType = typeof descriptor?.mimeType === 'string' ? descriptor.mimeType.toLowerCase() : '';
    if (descriptor?.id !== assetId
      || !ALLOWED_MIME_TYPES.has(mimeType)
      || descriptor?.size !== file.size
      || file.size <= 0) {
      return new Response('Not found', { status: 404 });
    }
    const requestedSize = parseThumbnailSize(requestUrl);
    const thumbnail = requestedSize
      ? await getOrCreateThumbnail(directory, match[1], file, requestedSize).catch(() => null)
      : null;
    const responseFile = thumbnail || file;
    const responseMimeType = thumbnail ? 'image/webp' : mimeType;
    return new Response(responseFile.stream(), {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(responseFile.size),
        'Content-Type': responseMimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(COVER_PATH_PREFIX)) {
    return;
  }
  event.respondWith(getCoverResponse(url));
});
