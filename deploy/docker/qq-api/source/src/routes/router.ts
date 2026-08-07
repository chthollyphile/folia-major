import Router from 'koa-router';

const router = new Router();

import context from '../controllers';

// cookies
router.get('/user/getCookie', context.getCookie);
router.get('/user/setCookie', context.setCookie);

// native QQ Music QR login
router.get('/login/qr/key', context.qrKey);
router.get('/login/qr/create', context.qrCreate);
router.get('/login/qr/check', context.qrCheck);
router.get('/login/status', context.loginStatus);
router.get('/logout', context.logout);
router.get('/user/detail', context.userDetail);
router.get('/user/playlist', context.getUserPlaylist);
router.get('/user/liked-songs', context.getUserLikedSongs);

// downloadQQMusic
router.get('/downloadQQMusic', context.getDownloadQQMusic);

router.get('/getHotkey', context.getHotKey);

router.get('/getSearchByKey/:key?/:limit?/:page?/:catZhida?', context.getSearchByKey);

// search smartbox
router.get('/getSmartbox/:key?', context.getSmartbox);

// 1
router.get('/getSongListCategories', context.getSongListCategories);

router.get('/getSongLists/:page?/:limit?/:categoryId?/:sortId?', context.getSongLists);

router.post('/batchGetSongLists', context.batchGetSongLists);

// getSongInfo
router.get('/getSongInfo/:songmid?/:songid?', context.getSongInfo);
router.post('/batchGetSongInfo', context.batchGetSongInfo);

// 4
// disstid=7011264340
router.get('/getSongListDetail/:disstid?', context.getSongListDetail);

// newDisk
router.get('/getNewDisks/:page?/:limit?', context.getNewDisks);

// getMvByTag
router.get('/getMvByTag', context.getMvByTag);

// MV
// area_id=15&version_id=7
router.get('/getMv/:area_id?/:version_id?/:limit?/:page?', context.getMv);

// getSingerList
router.get('/getSingerList/:area?/:sex?/:genre?/:index?/:page?', context.getSingerList);

// getSimilarSinger
// singermid=0025NhlN2yWrP4
router.get('/getSimilarSinger/:singermid?', context.getSimilarSinger);

// getSingerAlbum
// singermid=0025NhlN2yWrP4
router.get('/getSingerAlbum/:singermid?/:limit?/:page?', context.getSingerAlbum);

router.get('/getSingerHotsong/:singermid?/:limit?/:page?', context.getSingerHotsong);

/**
 * @description: getSingerMv
 * @param order: time(fan upload) || listen(singer all)
 */
router.get('/getSingerMv/:singermid?/:limit?/:order?', context.getSingerMv);

router.get('/getSingerDesc/:singermid?', context.getSingerDesc);

router.get('/getSingerStarNum/:singermid?', context.getSingerStarNum);

// radio
router.get('/getRadioLists', context.getRadioLists);

// DigitalAlbum
router.get('/getDigitalAlbumLists', context.getDigitalAlbumLists);

// music
// getLyric
// songmid=003rJSwm3TechU
router.get('/getLyric/:songmid?/:isFormat?', context.getLyric);

// songmid=003rJSwm3TechU
router.get('/getMusicPlay/:songmid?', context.getMusicPlay);

// album
// albummid=0016l2F430zMux
router.get('/getAlbumInfo/:albummid?', context.getAlbumInfo);

router.get(
  '/getComments/:id?/:rootcommentid?/:cid?/:pagesize?/:pagenum?/:cmd?/:reqtype?/:biztype?',
  context.getComments,
);

// recommend
router.get('/getRecommend', context.getRecommend);

// mv play
router.get('/getMvPlay/:vid?', context.getMvPlay);

// rankList: getTopLists
router.get('/getTopLists', context.getTopLists);

// ranks
router.get('/getRanks/:topId?/:limit?/:page?', context.getRanks);

// ticket
router.get('/getTicketInfo', context.getTicketInfo);

// getImageUrl
router.get('/getImageUrl', context.getImageUrl);

export default router;
