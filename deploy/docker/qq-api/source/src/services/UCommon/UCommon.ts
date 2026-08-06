import { AxiosRequestConfig } from 'axios';
import u_common from '../u_common';

interface UCommonParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

export default ({ method = 'get', params = {}, option = {} }: UCommonParams) => {
  const options = Object.assign(option, { params });
  return u_common({ method, options });
};
