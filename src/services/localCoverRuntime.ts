import { isLocalCoverWebRuntimeSupported } from './localCoverBinaryStore';
import { migrateLegacyLocalCoverAssetsInBackground } from './localCoverAssetService';
import { isLocalCoverAssetUrl } from './localCoverAssetUrl';

// src/services/localCoverRuntime.ts
// Re-requests local covers that failed before the Web resource route served them, then starts resumable legacy migration.

// Re-assigns the src of every rendered local cover that has not decoded, so the browser requests it again.
const retryBrokenLocalCoverImages = (): void => {
  document.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    const source = image.getAttribute('src');
    if (!isLocalCoverAssetUrl(source) || image.naturalWidth > 0) return;
    image.removeAttribute('src');
    queueMicrotask(() => {
      if (image.isConnected) image.src = source;
    });
  });
};

export const initializeLocalCoverRuntime = (): void => {
  if (isLocalCoverWebRuntimeSupported() && 'serviceWorker' in navigator) {
    // /__folia_cover/ is answered by the PWA worker (vite.config.ts imports public/folia-cover-sw.js
    // into it), which vite-plugin-pwa registers. Startup does not wait for it: on a first visit it only
    // activates after the whole precache is downloaded. A returning page is already controlled; one
    // that is not (first visit, or a worker from before the route was imported) gets the covers that
    // failed meanwhile requested again when the new worker claims it.
    navigator.serviceWorker.addEventListener('controllerchange', retryBrokenLocalCoverImages);
  }

  // Retry only covers that failed before their legacy payload reached external storage.
  void migrateLegacyLocalCoverAssetsInBackground().then(retryBrokenLocalCoverImages);
};
