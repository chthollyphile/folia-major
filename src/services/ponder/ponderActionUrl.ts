import { openOutsideLink } from '../../utils/system/outsideLink';

// src/services/ponder/ponderActionUrl.ts
// 打开一章附带的外部链接（`PonderSceneAction` 的 openUrl）。怎么到应用外面打开一个地址在
// utils/system/outsideLink.ts；这里只管打不开的时候怎么办。

/** 在系统浏览器里打开 url；失败只记日志，教程不该因为一个链接崩掉。 */
export const openPonderActionUrl = (url: string): void => {
    void openOutsideLink(url).catch((error: unknown) => {
        console.error('[ponder] Failed to open action url:', error);
    });
};
