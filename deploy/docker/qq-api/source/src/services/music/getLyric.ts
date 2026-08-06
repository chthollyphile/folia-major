import moment from 'moment';
import { BaseServiceParams, BaseServiceResponse } from '../../types/core/request';
import lyricParse from '../../util/lyricParse';
import {
  logServiceBranch,
  logServiceFailure,
  logServiceRequest,
  logServiceSuccess,
} from '../../util/observability';
import y_common from '../y_common';

export interface GetLyricParams extends BaseServiceParams {
  isFormat?: boolean;
}

const upstream = '/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

export default ({
  method = 'get',
  params = {},
  options = {},
  isFormat = false,
}: GetLyricParams): Promise<BaseServiceResponse> => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    pcachetime: moment().valueOf(),
  });
  const opts = Object.assign(options, {
    params: data,
  });
  logServiceRequest('getLyric', upstream, data, {
    formatLyric: isFormat,
  });
  if (isFormat) {
    logServiceBranch('getLyric', upstream, 'format', {
      formatLyric: true,
    });
  }
  return y_common({
    url: upstream,
    method,
    options: opts,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const lyricString = res.data?.lyric && Buffer.from(res.data.lyric, 'base64').toString();
      const lyric = isFormat ? lyricParse.lyricParse(lyricString || '') : lyricString;
      const response = {
        ...(res.data || {}),
        lyric,
      };
      logServiceSuccess('getLyric', upstream, {
        code: res.data?.code,
        hasLyric: Boolean(lyricString),
        formatLyric: isFormat,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getLyric', upstream, error, data, {
        formatLyric: isFormat,
      });
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
