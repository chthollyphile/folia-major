import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSimilarSingerParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/v8/fcg-bin/fcg_v8_simsinger.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetSimilarSingerParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    utf8: 1,
    start: 0,
    num: 5,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSimilarSinger', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSimilarSinger', upstream, response, {
        singermid: data.singermid,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getSimilarSinger', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
