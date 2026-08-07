import services from '../services';

const { UCommon } = services;

// songmid=003rJSwm3TechU
// songmid=001yNIo41SJjuC,001wPuVc4ZiMhj
import { Context } from 'koa';
import get from 'lodash.get';
import { _guid, userInfo } from '../config';
import qrLoginService from '../services/auth/qrLogin';
import { getTypedParams, getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

interface MusicPlayParams {
  songmid?: string;
  quality?: string;
  mediaId?: string;
  resType?: string;
}

export default async (ctx: Context) => {
  const path = getTypedParams<MusicPlayParams>(ctx);
  const query = getTypedQuery<MusicPlayParams>(ctx);
  const songmid = String(path.songmid ?? query.songmid ?? '').trim();
  if (!songmid) {
    ctx.status = 400;
    ctx.body = {
      data: {
        message: 'no songmid',
      },
    };
    return;
  }

  const uin = userInfo.uin || '0';
  // response data only need play url value (all play)
  const justPlayUrl = (query.resType || 'play') === 'play';
  const guid = _guid ? `${_guid}` : '1429839143';
  const quality = query.quality ?? '128';
  const mediaId = query.mediaId;
  const authToken = getAuthToken(ctx);
  if (authToken) {
    const playUrl = await qrLoginService.getMusicPlay(authToken, songmid, quality, mediaId);
    if (!playUrl) {
      ctx.status = 401;
      ctx.body = { code: 401, message: 'Login required' };
      return;
    }
    ctx.status = 200;
    ctx.body = { data: { playUrl } };
    return;
  }

  const fileType = {
    m4a: {
      s: 'C400',
      e: '.m4a',
    },
    128: {
      s: 'M500',
      e: '.mp3',
    },
    320: {
      s: 'M800',
      e: '.mp3',
    },
    ape: {
      s: 'A000',
      e: '.ape',
    },
    flac: {
      s: 'F000',
      e: '.flac',
    },
  };
  const songmidList = songmid.split(',');
  const qualityKey = quality as keyof typeof fileType;
  const fileInfo = fileType[qualityKey] ?? fileType[128];
  const file = songmidList.map((_) => `${fileInfo.s}${_}${mediaId || _}${fileInfo.e}`);
  const data = {
    // req: {
    // 	module: 'CDN.SrfCdnDispatchServer',
    // 	method: 'GetCdnDispatch',
    // 	param: {
    // 		guid,
    // 		calltype: 0,
    // 		userip: '',
    // 	},
    // },
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        filename: file,
        guid,
        songmid: songmidList,
        songtype: [0],
        uin,
        loginflag: 1,
        platform: '20',
      },
    },
    loginUin: uin,
    comm: {
      uin,
      format: 'json',
      ct: 24,
      cv: 0,
    },
  };
  const params = Object.assign({
    format: 'json',
    sign: 'zzannc1o6o9b4i971602f3554385022046ab796512b7012',
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };

  await UCommon(props)
    .then((res: { data: any }) => {
      const response = res.data;
      const domain =
        get(response, 'req_0.data.sip', []).find((i: string) => !i.startsWith('http://ws')) ||
        get(response, 'req_0.data.sip[0]');

      const playUrl: Record<string, { url: string; error: string | boolean }> = {};
      get(response, 'req_0.data.midurlinfo', []).forEach(
        (item: { songmid: string; purl: string }) => {
          playUrl[item.songmid] = {
            url: item.purl ? `${domain}${item.purl}` : '',
            error: !item.purl && '暂无播放链接',
          };
        },
      );
      response.playUrl = playUrl;
      ctx.body = {
        data: justPlayUrl ? { playUrl } : response,
      };
    })
    .catch((error: unknown) => {
      throw error;
    });
};
