// src/utils/blobGuards.ts
// Guards browser Blob values that may have crossed IndexedDB or runtime boundaries.

export const isBlob = (value: unknown): value is Blob => (
    typeof Blob !== 'undefined' && value instanceof Blob
);

export const getBlobObjectUrlSignature = (
    blob: Blob,
    stableParts: readonly (string | number | boolean | null | undefined)[] = [],
): string => [
    ...stableParts.map(part => part ?? ''),
    blob.size,
    blob.type,
].join('::');
