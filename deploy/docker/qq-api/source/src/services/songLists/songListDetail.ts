import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface SongListDetailParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';

export default ({ method = 'get', params = {}, option = {} }: SongListDetailParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    type: 1,
    json: 1,
    utf8: 1,
    onlysong: 0,
    new_format: 1,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('songListDetail', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('songListDetail', upstream, response, {
        disstid: data.disstid,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('songListDetail', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
