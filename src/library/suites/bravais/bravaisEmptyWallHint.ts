import type { TFunction } from 'i18next';
import type { LibraryHomeOnlineSource } from '../../core/home/homeModel.contract';
import type { BravaisSeamTab } from './bravaisLayer';
import type { BravaisWallHint } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisEmptyWallHint.ts
// 首页空墙上的说明（BravaisWallHint 画的背景字）写什么：在线页签（歌单 / 电台 / 专辑 / 探索）还没连上在线平台、本地页签
// 还没导入文件夹时，说这面墙会铺什么、从缝里哪个按钮开始。按钮名取它们自己的文案（缝里的「连接在线平台」、「⋯」里的
// 「导入文件夹」、本地页签名），按钮改名说明跟着变。别的空墙（空歌单、过滤没有匹配、读取中）不给说明，只在缝的状态行说。

/** 在线来源没登录时的说明（登录过期另说一句）；已登录、解析中、无账户的平台不给。localTab 是能去的本地页签名，没有就不提本地。 */
export const onlineWallHint = (
    online: Pick<LibraryHomeOnlineSource, 'accountView' | 'needsRelogin' | 'providerLabel'>,
    localTab: string | null,
    t: TFunction,
): BravaisWallHint | undefined => {
    if (online.accountView !== 'guest') return undefined;
    const connect = t('libraryBravaisHome.connect');
    if (online.needsRelogin) {
        return {
            title: t('libraryBravaisHome.wallHint.reloginTitle', { provider: online.providerLabel }),
            body: t('libraryBravaisHome.wallHint.reloginBody', { connect }),
        };
    }
    return {
        title: t('libraryBravaisHome.wallHint.guestTitle'),
        body: localTab
            ? t('libraryBravaisHome.wallHint.guestBodyWithLocal', { connect, local: localTab })
            : t('libraryBravaisHome.wallHint.guestBody', { connect }),
    };
};

/** 本地曲库空着（没有歌、也没导入过文件夹）时的说明；canImport 是缝的「⋯」里有没有「导入文件夹」。 */
export const localWallHint = (canImport: boolean, t: TFunction): BravaisWallHint => ({
    title: t('libraryBravaisHome.wallHint.localTitle'),
    body: canImport ? t('libraryBravaisHome.wallHint.localBody', { action: t('localMusic.importFolder') }) : undefined,
});

/** 页签条里能去的本地页签名（有、且没被禁用）。 */
export const availableLocalTabLabel = (tabs: readonly BravaisSeamTab[] | undefined): string | null => (
    tabs?.find(tab => tab.key === 'local' && !tab.disabled)?.label ?? null
);
