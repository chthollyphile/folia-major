// src/services/onlineMusic/lxmusic/lxFacade.ts
// 洛雪对 UI 的门面：界面层不直连 provider adapter（D110），公开接口浏览与 id 规则都从这里出。
// 里面只是转手，逻辑仍在 provider 里——provider 自己也要用这些 id 规则，不能反过来依赖界面。

export { lxBrowse, lxChartCollectionId, lxSavedAlbumCollectionId } from './lxmusicProvider';
