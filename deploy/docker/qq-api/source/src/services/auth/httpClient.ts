import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type Method,
} from 'axios';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const JSON_CONTENT_TYPE = 'application/json';

export interface AuthHttpClient {
  getCookieHeader(): string;
  request<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
}

const normalizeSetCookies = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
};

const updateCookieJar = (jar: Map<string, string>, setCookies: string[]): void => {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
};

const cookieHeader = (jar: Map<string, string>): string =>
  Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');

const mergeCookieHeaders = (...headers: string[]): string => {
  const merged = new Map<string, string>();
  for (const header of headers) {
    for (const item of header.split(';')) {
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      const name = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();
      if (name) merged.set(name, value);
    }
  }
  return cookieHeader(merged);
};

const redirectedMethod = (status: number, method: string | undefined): Method => {
  if (status === 303) return 'GET';
  if ([301, 302].includes(status) && String(method).toUpperCase() === 'POST') return 'GET';
  return (method ?? 'GET') as Method;
};

export const createAuthHttpClient = (
  transport: AxiosInstance = axios.create({ timeout: 25000, maxRedirects: 0 }),
): AuthHttpClient => {
  const jar = new Map<string, string>();

  const request = async <T>(initial: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    let config = { ...initial };
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const cookies = cookieHeader(jar);
      const configuredHeaders = { ...(config.headers ?? {}) } as Record<string, unknown>;
      const explicitCookieEntry = Object.entries(configuredHeaders).find(
        ([name]) => name.toLowerCase() === 'cookie',
      );
      if (explicitCookieEntry) delete configuredHeaders[explicitCookieEntry[0]];
      const explicitCookies =
        typeof explicitCookieEntry?.[1] === 'string' ? explicitCookieEntry[1] : '';
      const mergedCookies = mergeCookieHeaders(cookies, explicitCookies);
      // `src/util/request.ts` mutates the GLOBAL axios defaults (POST Content-Type,
      // responseType) for the legacy y.qq.com/c.y.qq.com services, and `axios.create()`
      // snapshots those defaults when it runs. Whether that module is imported before or
      // after this client is built is an import-order accident, so the auth protocol pins
      // its own JSON contract per request instead of inheriting whatever is global.
      const response = await transport.request<T>({
        ...config,
        headers: {
          ...(config.data === undefined ? {} : { 'Content-Type': JSON_CONTENT_TYPE }),
          ...configuredHeaders,
          ...(mergedCookies ? { Cookie: mergedCookies } : {}),
        },
        // The web login channels answer with HTML, `window.wx_errcode=...` / `ptuiCB('...')`
        // script text and raw QR images, so a caller may opt into `text` / `arraybuffer`
        // explicitly. Anything that does not ask stays JSON: this must never fall back to the
        // global axios default, which is exactly what `src/util/request.ts` rewrites.
        responseType: config.responseType ?? 'json',
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });
      updateCookieJar(jar, normalizeSetCookies(response.headers['set-cookie']));

      const location = response.headers.location;
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
      if (redirectCount === MAX_REDIRECTS) throw new Error('QQ auth redirect limit exceeded');

      const method = redirectedMethod(response.status, config.method);
      config = {
        ...config,
        url: new URL(location, config.url).toString(),
        method,
        data: method === 'GET' ? undefined : config.data,
      };
    }
    throw new Error('QQ auth redirect limit exceeded');
  };

  return {
    getCookieHeader: () => cookieHeader(jar),
    request,
    post: <T>(url: string, data?: unknown, config: AxiosRequestConfig = {}) =>
      request<T>({ ...config, url, data, method: 'POST' }),
  };
};

export default createAuthHttpClient;
