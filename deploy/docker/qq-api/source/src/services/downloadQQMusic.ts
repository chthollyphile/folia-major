import { AxiosRequestConfig } from 'axios';
import { requestConfig } from '../config';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../util/observability';
import request from '../util/request';

interface DownloadQQMusicParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/download/download.js';

export default ({ method = 'get', params = {}, option = {} }: DownloadQQMusicParams) => {
  const data = Object.assign(params, {
    format: 'jsonp',
    jsonpCallback: 'MusicJsonCallback',
    platform: 'yqq',
  });
  const options: AxiosRequestConfig = Object.assign(option, {
    headers: {
      host: 'y.qq.com',
      referer: requestConfig.referer.y,
      ...option.headers,
    },
    params: data,
  });
  logServiceRequest('downloadQQMusic', upstream, data);
  return request(upstream, method, options, 'y')
    .then((res: import('axios').AxiosResponse<any>) => {
      let response = res.data;
      const isJsonpResponse = typeof response === 'string';
      if (typeof response === 'string') {
        const reg = /^\w+\(({[^()]+})\)$/;
        const matches = response.match(reg);
        if (matches) {
          response = JSON.parse(matches[1]);
        }
      }
      logServiceSuccess('downloadQQMusic', upstream, response, {
        isJsonpResponse,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('downloadQQMusic', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
