import services from '../services';

const { UCommon } = services;

// vid=u00222le4ox
import { Context } from 'koa';

export default async (ctx: Context) => {
  const { vid } = ctx.query;
  const data = {
    comm: {
      ct: 24,
      cv: 4747474,
    },
    getMVUrl: {
      module: 'gosrf.Stream.MvUrlProxy',
      method: 'GetMvUrls',
      param: {
        vids: [vid],
        request_typet: 10001,
      },
    },
    mvinfo: {
      module: 'video.VideoDataServer',
      method: 'get_video_info_batch',
      param: {
        vidlist: [vid],
        required: [
          'vid',
          'type',
          'sid',
          'cover_pic',
          'duration',
          'singers',
          'video_switch',
          'msg',
          'name',
          'desc',
          'playcnt',
          'pubdate',
          'isfav',
          'gmid',
        ],
      },
    },
    other: {
      module: 'video.VideoLogicServer',
      method: 'rec_video_byvid',
      param: {
        vid,
        required: [
          'vid',
          'type',
          'sid',
          'cover_pic',
          'duration',
          'singers',
          'video_switch',
          'msg',
          'name',
          'desc',
          'playcnt',
          'pubdate',
          'isfav',
          'gmid',
          'uploader_headurl',
          'uploader_nick',
          'uploader_encuin',
          'uploader_uin',
          'uploader_hasfollow',
          'uploader_follower_num',
        ],
        support: 1,
      },
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
  if (vid) {
    await UCommon(props)
      .then((res: import('axios').AxiosResponse<any>) => {
        const response = res.data;
        const mvurls = response.getMVUrl.data;
        const mvurlskey = Object.keys(mvurls)[0];
        const mp4_urls = mvurls[mvurlskey].mp4.map(
          (item: { freeflow_url: string[] }) => item.freeflow_url,
        );
        const hls_urls = mvurls[mvurlskey].hls.map(
          (item: { freeflow_url: string[] }) => item.freeflow_url,
        );
        const urls = [...mp4_urls, ...hls_urls];
        let play_urls: string[] = [];
        let playLists = {};
        urls.length &&
          urls.forEach((url) => {
            play_urls = [...play_urls, ...url];
          });
        playLists = {
          f10: play_urls.filter((item) => /\.f10\.mp4/.test(item)),
          f20: play_urls.filter((item) => /\.f20\.mp4/.test(item)),
          f30: play_urls.filter((item) => /\.f30\.mp4/.test(item)),
          f40: play_urls.filter((item) => /\.f40\.mp4/.test(item)),
        };
        response.playLists = playLists;
        ctx.status = 200;
        ctx.body = {
          response,
        };
      })
      .catch((error: unknown) => {
        throw error;
      });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'vid is null',
    };
  }
};
