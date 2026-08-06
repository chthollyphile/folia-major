// album
import getAlbumInfo from './album/getAlbumInfo';
// comments
import getComments from './comments/getComments';
// DigitalAlbum
import getDigitalAlbumLists from './digitalAlbum/getDigitalAlbumLists';
import downloadQQMusic from './downloadQQMusic';
// music
import getLyric from './music/getLyric';
// MV
import getMvByTag from './mv/getMvByTag';
// radio
import getRadioLists from './radio/getRadioLists';
// getTopLists
import getTopLists from './rank/getTopLists';
// search
import getHotKey from './search/getHotKey';
import getSearchByKey from './search/getSearchByKey';
import getSmartbox from './search/getSmartbox';
// singer
import getSimilarSinger from './singers/getSimilarSinger';
import getSingerDesc from './singers/getSingerDesc';
import getSingerMv from './singers/getSingerMv';
import getSingerStarNum from './singers/getSingerStarNum';
import songListCategories from './songLists/songListCategories';
import songListDetail from './songLists/songListDetail';
// song list
import songLists from './songLists/songLists';
// UCommon
import UCommon from './UCommon/UCommon';
import getUserLikedSongs from './user/getUserLikedSongs';
import getUserPlaylist from './user/getUserPlaylist';

export default {
  downloadQQMusic,
  // search
  getHotKey,
  getSearchByKey,
  getSmartbox,
  // song lists
  songLists,
  songListCategories,
  songListDetail,
  // MV
  getMvByTag,
  // singer
  getSimilarSinger,
  getSingerMv,
  getSingerDesc,
  getSingerStarNum,
  // radio
  getRadioLists,
  // DigitalAlbum
  getDigitalAlbumLists,
  // music
  getLyric,
  // album
  getAlbumInfo,
  // comments
  getComments,
  // UCommon
  UCommon,
  // getTopLists
  getTopLists,
  getUserLikedSongs,
  getUserPlaylist,
};
