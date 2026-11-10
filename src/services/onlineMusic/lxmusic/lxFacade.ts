// src/services/onlineMusic/lxmusic/lxFacade.ts
// 洛雪对 UI 的门面：界面层不直连 provider adapter，也不直连平台的取数层（D110），
// 浏览、id 规则与公开接口清单都从这里出。里面只是转手，逻辑仍在 provider 与 transport 里。

export { lxBrowse, lxChartCollectionId, lxSavedAlbumCollectionId } from './lxmusicProvider';

export {
    LX_PUBLIC_PLATFORMS,
    LX_PUBLIC_PLATFORM_KEYS,
    lxApiAlbumName,
    lxApiCharts,
    lxApiPlaylistTags,
} from './lxmusicTransport';

export type {
    LxApiChart,
    LxApiRadioProgram,
    LxPublicPlatform,
    LxSquareTagCatalog,
} from './lxmusicTransport';
