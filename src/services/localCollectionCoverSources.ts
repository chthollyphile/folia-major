import { getDirHandles } from './db';
import { fetchCoverBlob } from './coverCache';
import { isLocalCoverAssetUrl } from './localCoverAssetUrl';

// src/services/localCollectionCoverSources.ts
// 本地集合自定义封面的三个来源取图片字节：文件夹里的 poster.png、用户上传的图片、集合里一首歌的封面；再统一缩到
// 合适的大小。只在设置那一刻读一次，存下来的是字节本身（library/core/collection/cover/localCollectionCovers.service），
// 之后与来源无关。要画布、图片元素与目录句柄，所以放在 services，不进 headless 的 library core；
// 一首歌该取哪几张图（纯规则）由 core 的 resolveLocalSongCoverCandidates 算好再交进来。

/** 存下来的封面最长边。集合封面最大也就铺满一张海报，1024 足够，存储也小。 */
export const LOCAL_COLLECTION_COVER_MAX_EDGE = 1024;
/** 不超过最长边、体积也不大的 PNG / JPEG / WebP 原样保留（不白白再压一次）。 */
const KEEP_ORIGINAL_MAX_BYTES = 768 * 1024;
const KEEP_ORIGINAL_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** poster 的候选文件名，按优先顺序；大小写不敏感。 */
const POSTER_FILE_NAMES = ['poster.png', 'poster.jpg', 'poster.jpeg', 'poster.webp'];

const encodeCanvas = (canvas: HTMLCanvasElement, type: string, quality: number) => (
    new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
);

/**
 * 把一张图整理成要存的样子：解码失败（不是图片）时抛错；最长边超过 1024 或体积偏大时缩放并重新编码为 WebP
 * （浏览器不支持 WebP 编码时用 JPEG），否则原样返回。
 */
export const prepareLocalCollectionCoverImage = async (source: Blob): Promise<Blob> => {
    if (source.size === 0) throw new Error('The image is empty.');
    const bitmap = await createImageBitmap(source);
    try {
        const longestEdge = Math.max(bitmap.width, bitmap.height);
        const scale = Math.min(1, LOCAL_COLLECTION_COVER_MAX_EDGE / longestEdge);
        if (scale === 1 && source.size <= KEEP_ORIGINAL_MAX_BYTES && KEEP_ORIGINAL_TYPES.has(source.type)) {
            return source;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context is unavailable.');
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const webp = await encodeCanvas(canvas, 'image/webp', 0.86);
        if (webp && webp.type === 'image/webp' && webp.size > 0) return webp;
        const jpeg = await encodeCanvas(canvas, 'image/jpeg', 0.88);
        if (jpeg && jpeg.size > 0) return jpeg;
        throw new Error('The image could not be encoded.');
    } finally {
        bitmap.close();
    }
};

type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
    values?: () => AsyncIterable<FileSystemHandle>;
};

/**
 * 找 poster 的结果：found 带着文件；missing 文件夹里没有；no-access 曲库根目录的读取权限没给（再点一次会去要）；
 * unavailable 这个文件夹没有保存的目录句柄（读不到磁盘上的文件夹）。
 */
export type LocalFolderPosterLookup =
    | { status: 'found'; file: File }
    | { status: 'missing' }
    | { status: 'no-access' }
    | { status: 'unavailable' };

/**
 * 在曲库文件夹（路径含根文件夹名，与 LocalSong.folderName 相同）里找 poster.png / .jpg / .jpeg / .webp。
 * 读的是导入时保存的根目录句柄（与重新扫描同一个）。requestAccess 为真时，没有权限就向用户要（要在点击里调用）。
 */
export const findLocalFolderPoster = async (
    folderPath: string,
    { requestAccess = false }: { requestAccess?: boolean } = {},
): Promise<LocalFolderPosterLookup> => {
    const [rootName, ...segments] = folderPath.split('/').filter(Boolean);
    if (!rootName) return { status: 'unavailable' };
    const handles = await getDirHandles();
    const root = handles[rootName] as PermissionAwareDirectoryHandle | undefined;
    if (!root) return { status: 'unavailable' };

    let permission: PermissionState = (await root.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (permission !== 'granted' && requestAccess && root.requestPermission) {
        permission = await root.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') return { status: 'no-access' };

    let directory: PermissionAwareDirectoryHandle = root;
    try {
        for (const segment of segments) {
            directory = await directory.getDirectoryHandle(segment) as PermissionAwareDirectoryHandle;
        }
    } catch (error) {
        console.warn(`[LocalCollectionCover] Folder "${folderPath}" is not readable:`, error);
        return { status: 'missing' };
    }
    if (!directory.values) return { status: 'unavailable' };

    const candidates = new Map<string, FileSystemFileHandle>();
    for await (const entry of directory.values()) {
        const name = entry.name.toLowerCase();
        if (entry.kind === 'file' && POSTER_FILE_NAMES.includes(name) && !candidates.has(name)) {
            candidates.set(name, entry as FileSystemFileHandle);
        }
    }
    const handle = POSTER_FILE_NAMES.map(name => candidates.get(name)).find(Boolean);
    return handle ? { status: 'found', file: await handle.getFile() } : { status: 'missing' };
};

/**
 * 经 <img crossOrigin> 解码再画到画布上取字节：fetch 被拒（没有 CORS 头的图床）时的退路，与取色读封面像素同一条路。
 * 画布被污染时 toBlob 抛错，由调用方接住。
 */
const loadImageBlobViaElement = (url: string) => new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context || !canvas.width || !canvas.height) throw new Error('The cover image is empty.');
            context.drawImage(image, 0, 0);
            canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The cover image could not be encoded.'))), 'image/png');
        } catch (error) {
            reject(error);
        }
    };
    image.onerror = () => reject(new Error('The cover image failed to load.'));
    image.src = url;
});

const fetchSongCoverBlob = async (url: string): Promise<Blob> => {
    if (!isLocalCoverAssetUrl(url)) return fetchCoverBlob(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Local cover request failed: ${response.status}`);
    return response.blob();
};

/**
 * 取一首歌封面的原图字节：candidates 是这首歌的候选封面（core 的 resolveLocalSongCoverCandidates，按偏好排好，
 * 不带尺寸——本地封面读原尺寸资源，不是缩略图）。在线封面经封面缓存同一条请求路径（网页版的代理）；请求被拒时
 * 退回经图片元素解码。首选的那张取不到时试下一张；都取不到抛错。songId 只用于日志。
 */
export const loadLocalSongCoverBlob = async (candidates: readonly string[], songId: string): Promise<Blob> => {
    let lastError: unknown = new Error('The song has no cover.');
    for (const url of candidates) {
        try {
            const blob = await fetchSongCoverBlob(url).catch(() => loadImageBlobViaElement(url));
            if (blob.size > 0) return blob;
        } catch (error) {
            lastError = error;
            console.warn(`[LocalCollectionCover] Failed to read a cover of song ${songId}:`, error);
        }
    }
    throw lastError;
};
