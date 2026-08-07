import { AxiosRequestConfig } from 'axios';
import moment from 'moment';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSingerDescParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/splcloud/fcgi-bin/fcg_get_singer_desc.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetSingerDescParams) => {
  const hasCommonParams = false;
  const data = Object.assign(params, {
    format: 'xml',
    outCharset: 'utf-8',
    utf8: 1,
    r: moment().valueOf(),
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSingerDesc', upstream, data, {
    hasCommonParams,
  });
  return y_common({
    url: upstream,
    method,
    options,
    hasCommonParams,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSingerDesc', upstream, response, {
        hasCommonParams,
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
      logServiceFailure('getSingerDesc', upstream, error, data, {
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
