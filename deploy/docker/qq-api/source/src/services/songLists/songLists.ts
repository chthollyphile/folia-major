import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface SongListsParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg';

export default ({ method = 'get', params = {}, option = {} }: SongListsParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    picmid: 1,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('songLists', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      let response = res.data;
      if (typeof response === 'string') {
        const reg = /^\w+\(({[^()]+})\)$/;
        const matches = response.match(reg);
        if (matches) {
          response = JSON.parse(matches[1]);
        }
      }
      logServiceSuccess('songLists', upstream, response, {
        isJsonpResponse: typeof res.data === 'string',
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('songLists', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
