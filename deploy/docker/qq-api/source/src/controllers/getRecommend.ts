import services from '../services';

const { UCommon } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const data = {
    comm: {
      ct: 24,
    },
    category: {
      method: 'get_hot_category',
      param: {
        qq: '',
      },
      module: 'music.web_category_svr',
    },
    recomPlaylist: {
      method: 'get_hot_recommend',
      param: {
        async: 1,
        cmd: 2,
      },
      module: 'playlist.HotRecommendServer',
    },
    playlist: {
      method: 'get_playlist_by_category',
      param: {
        id: 8,
        curPage: 1,
        size: 40,
        order: 5,
        titleid: 8,
      },
      module: 'playlist.PlayListPlazaServer',
    },
    new_song: {
      module: 'newsong.NewSongServer',
      method: 'get_new_song_info',
      param: {
        type: 5,
      },
    },
    new_album: {
      module: 'newalbum.NewAlbumServer',
      method: 'get_new_album_info',
      param: {
        area: 1,
        sin: 0,
        num: 10,
      },
    },
    new_album_tag: {
      module: 'newalbum.NewAlbumServer',
      method: 'get_new_album_area',
      param: {},
    },
    toplist: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetAll',
      param: {},
    },
    focus: {
      module: 'QQMusic.MusichallServer',
      method: 'GetFocus',
      param: {},
    },
  };
  const params = Object.assign({
    format: 'json',
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
  await UCommon(props)
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      ctx.status = 200;
      ctx.body = {
        response,
      };
    })
    .catch((error: unknown) => {
      throw error;
    });
};
