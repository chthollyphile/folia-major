import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSmartboxParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/splcloud/fcgi-bin/smartbox_new.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetSmartboxParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    is_xml: 0,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSmartbox', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSmartbox', upstream, response, {
        key: data.key,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getSmartbox', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
