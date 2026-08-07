import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetTopListsParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/v8/fcg-bin/fcg_myqq_toplist.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetTopListsParams) => {
  const hasCommonParams = false;
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    platform: 'h5',
    needNewCode: 1,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getTopLists', upstream, data, {
    hasCommonParams,
  });
  return y_common({
    url: upstream,
    method,
    options,
    hasCommonParams,
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
      logServiceSuccess('getTopLists', upstream, response, {
        hasCommonParams,
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
      logServiceFailure('getTopLists', upstream, error, data, {
        hasCommonParams,
      });
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
