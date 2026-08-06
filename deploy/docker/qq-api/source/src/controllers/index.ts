import { withControllerLogging } from '../util/observability';
import batchGetSongInfo from './batchGetSongInfo';
import batchGetSongLists from './batchGetSongLists';
import cookies from './cookies';
import getAlbumInfo from './getAlbumInfo';
import getComments from './getComments';
import getDigitalAlbumLists from './getDigitalAlbumLists';
import getDownloadQQMusic from './getDownloadQQMusic';
import getHotKey from './getHotkey';
import getImageUrl from './getImageUrl';
import getLyric from './getLyric';
import getMusicPlay from './getMusicPlay';
import getMv from './getMv';
import getMvByTag from './getMvByTag';
import getMvPlay from './getMvPlay';
import getNewDisks from './getNewDisks';
import getRadioLists from './getRadioLists';
import getRanks from './getRanks';
import getRecommend from './getRecommend';
import getSearchByKey from './getSearchByKey';
import getSimilarSinger from './getSimilarSinger';
import getSingerAlbum from './getSingerAlbum';
import getSingerDesc from './getSingerDesc';
import getSingerHotsong from './getSingerHotsong';
import getSingerList from './getSingerList';
import getSingerMv from './getSingerMv';
import getSingerStarNum from './getSingerStarNum';
import getSmartbox from './getSmartbox';
import getSongInfo from './getSongInfo';
import getSongListCategories from './getSongListCategories';
import getSongListDetail from './getSongListDetail';
import getSongLists from './getSongLists';
import getTicketInfo from './getTicketInfo';
import getTopLists from './getTopLists';
import getUserLikedSongs from './getUserLikedSongs';
import getUserPlaylist from './getUserPlaylist';
import { loginStatus, logout, qrCheck, qrCreate, qrKey, userDetail } from './login';

const { get: getCookie, set: setCookie } = cookies;

export default {
  getCookie: withControllerLogging('getCookie', getCookie),
  setCookie: withControllerLogging('setCookie', setCookie),
  getDownloadQQMusic: withControllerLogging('getDownloadQQMusic', getDownloadQQMusic),
  getHotKey: withControllerLogging('getHotKey', getHotKey),
  getSearchByKey: withControllerLogging('getSearchByKey', getSearchByKey),
  getSmartbox: withControllerLogging('getSmartbox', getSmartbox),
  getSongListCategories: withControllerLogging('getSongListCategories', getSongListCategories),
  getSongLists: withControllerLogging('getSongLists', getSongLists),
  batchGetSongLists: withControllerLogging('batchGetSongLists', batchGetSongLists),
  getSongInfo: withControllerLogging('getSongInfo', getSongInfo),
  batchGetSongInfo: withControllerLogging('batchGetSongInfo', batchGetSongInfo),
  getSongListDetail: withControllerLogging('getSongListDetail', getSongListDetail),
  getNewDisks: withControllerLogging('getNewDisks', getNewDisks),
  getMvByTag: withControllerLogging('getMvByTag', getMvByTag),
  getMv: withControllerLogging('getMv', getMv),
  getSingerList: withControllerLogging('getSingerList', getSingerList),
  getSimilarSinger: withControllerLogging('getSimilarSinger', getSimilarSinger),
  getSingerAlbum: withControllerLogging('getSingerAlbum', getSingerAlbum),
  getSingerHotsong: withControllerLogging('getSingerHotsong', getSingerHotsong),
  getSingerMv: withControllerLogging('getSingerMv', getSingerMv),
  getSingerDesc: withControllerLogging('getSingerDesc', getSingerDesc),
  getSingerStarNum: withControllerLogging('getSingerStarNum', getSingerStarNum),
  getRadioLists: withControllerLogging('getRadioLists', getRadioLists),
  getDigitalAlbumLists: withControllerLogging('getDigitalAlbumLists', getDigitalAlbumLists),
  getLyric: withControllerLogging('getLyric', getLyric),
  getMusicPlay: withControllerLogging('getMusicPlay', getMusicPlay),
  getAlbumInfo: withControllerLogging('getAlbumInfo', getAlbumInfo),
  getComments: withControllerLogging('getComments', getComments),
  getRecommend: withControllerLogging('getRecommend', getRecommend),
  getMvPlay: withControllerLogging('getMvPlay', getMvPlay),
  getTopLists: withControllerLogging('getTopLists', getTopLists),
  getRanks: withControllerLogging('getRanks', getRanks),
  getTicketInfo: withControllerLogging('getTicketInfo', getTicketInfo),
  getImageUrl: withControllerLogging('getImageUrl', getImageUrl),
  qrKey: withControllerLogging('qrKey', qrKey),
  qrCreate: withControllerLogging('qrCreate', qrCreate),
  qrCheck: withControllerLogging('qrCheck', qrCheck),
  loginStatus: withControllerLogging('loginStatus', loginStatus),
  logout: withControllerLogging('logout', logout),
  userDetail: withControllerLogging('userDetail', userDetail),
  getUserLikedSongs: withControllerLogging('getUserLikedSongs', getUserLikedSongs),
  getUserPlaylist: withControllerLogging('getUserPlaylist', getUserPlaylist),
};
