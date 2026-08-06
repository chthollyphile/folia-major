import { AxiosRequestConfig } from 'axios';
import { Context } from 'koa';

type QueryLikeValue = string | string[] | undefined;
export type TypedQuery<T extends object> = {
  [K in keyof T]?: Extract<T[K], QueryLikeValue> extends never
    ? QueryLikeValue
    : Extract<T[K], QueryLikeValue>;
};

export const getTypedQuery = <T extends object>(ctx: Context): TypedQuery<T> =>
  ctx.query as TypedQuery<T>;

export type TypedParams<T extends object> = {
  [K in keyof T]?: string;
};

export const getTypedParams = <T extends object>(ctx: Context): TypedParams<T> =>
  (ctx as Context & { params?: TypedParams<T> }).params ?? {};

/**
 * 基础的服务请求参数抽象
 * 所有 Service 层的方法参数都应该继承此接口
 */
export interface BaseServiceParams {
  /**
   * HTTP 请求方法，默认 'get'
   */
  method?: string;
  /**
   * 传递给 axios 的额外请求配置
   */
  options?: AxiosRequestConfig;
  /**
   * URL 查询参数或 body 数据
   */
  params?: Record<string, unknown>;
}

/**
 * U.y.qq.com 域名下的通用请求参数
 */
export interface BaseUCommonParams extends Omit<BaseServiceParams, 'params'> {}

/**
 * C.y.qq.com 域名下的通用请求参数
 */
export interface BaseYCommonParams extends Omit<BaseServiceParams, 'params'> {
  /**
   * 请求路径
   */
  url: string;
  /**
   * 是否需要携带全局的 commonParams
   * @default true
   */
  hasCommonParams?: boolean;
}

/**
 * 通用的 Service 返回格式
 */
export interface BaseServiceResponse<T = any> {
  status: number;
  body: {
    response?: T;
    error?: unknown;
  };
}

/**
 * 带有类型化查询参数的 Koa Context
 * 仅用于局部类型表达，不建议直接作为 koa-router handler 的参数类型。
 */
export interface TypedQueryContext<T extends object> extends Context {
  query: Context['query'] & TypedQuery<T>;
}

/**
 * 带有类型化 Body 参数的 Koa Context
 */
export interface TypedBodyContext<T extends object> extends Context {
  request: Context['request'] & {
    body: T;
  };
}
