import axios, { AxiosRequestConfig, AxiosResponse, Method, ResponseType } from 'axios';
import { requestConfig } from '../config';
import { logger } from './logger';
import { summarizeValue } from './observability';

require('../util/colors');

// `withCredentials` 表示跨域请求时是否需要使用凭证
axios.defaults.withCredentials = requestConfig.withCredentials;
axios.defaults.timeout = requestConfig.timeout;
axios.defaults.headers.post['Content-Type'] = requestConfig.contentType;
axios.defaults.responseType = requestConfig.responseType as ResponseType;

function request<T = unknown>(
  url: string,
  method: string,
  options: AxiosRequestConfig = {},
  isUUrl = 'c',
): Promise<AxiosResponse<T>> {
  let baseURL = '';
  switch (isUUrl) {
    case 'y':
      baseURL = requestConfig.baseURL.y + url;
      break;
    case 'u':
      baseURL = url;
      break;
    case 'c':
      baseURL = requestConfig.baseURL.c + url;
      break;
    default:
      baseURL = requestConfig.baseURL.c + url;
      break;
  }

  const axiosMethod = method.toLowerCase() as Method;
  const requestConfigOptions: AxiosRequestConfig = {
    ...options,
    url: baseURL,
    method: axiosMethod,
  };

  logger.debug('upstream.requesting', {
    scope: 'request',
    url: baseURL,
    method: axiosMethod,
    params: summarizeValue(options.params),
  });

  return axios(requestConfigOptions).then(
    (response: AxiosResponse<T>) => {
      if (!response) {
        throw Error('response is null');
      }
      logger.debug('upstream.succeeded', {
        scope: 'request',
        url: baseURL,
        method: axiosMethod,
        status: response.status,
        result: summarizeValue(response.data),
      });
      return response;
    },
    (error: unknown) => {
      logger.error('upstream.failed', {
        scope: 'request',
        url: baseURL,
        method: axiosMethod,
        error: summarizeValue(error),
      });
      throw error;
    },
  );
}

export default request;
