import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetRadioListsParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/v8/fcg-bin/fcg_v8_radiolist.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetRadioListsParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    channel: 'radio',
    page: 'index',
    tpl: 'wk',
    new: 1,
    p: Math.round(1),
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getRadioLists', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getRadioLists', upstream, response, {
        page: data.p,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getRadioLists', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
