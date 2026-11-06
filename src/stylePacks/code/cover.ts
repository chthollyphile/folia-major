// Clear the old song immediately and discard any image decode that finishes after a switch.
export function loadCodeCover(url: string | null | undefined, host: { setCover: (image: ImageBitmap | null) => Promise<void> }) {
    let disposed = false;
    const image = new Image(); image.crossOrigin = 'anonymous';
    const cleared = host.setCover(null).catch(() => {});
    image.onload = () => {
        void (async () => {
            const bitmap = await createImageBitmap(image);
            if (disposed) { bitmap.close(); return; }
            await cleared;
            if (disposed) { bitmap.close(); return; }
            try { await host.setCover(bitmap); } catch (error) { bitmap.close(); throw error; }
        })().catch(error => { if (!disposed) console.warn('[StylePacks] Cover unavailable', error); });
    };
    image.onerror = () => console.warn('[StylePacks] Cover unavailable; cleared previous image');
    if (url) image.src = url;
    return () => { disposed = true; image.onload = null; image.onerror = null; image.src = ''; };
}
