import { AppConfig } from './schema';

const defaultCookie: string = '';
const cookieList: string[] = defaultCookie ? defaultCookie.split('; ') : [];
const cookieObject: Record<string, string> = {};

if (cookieList.length) {
  cookieList.forEach((cookie: string) => {
    const arr = cookie.split('=');
    const key = arr[0];
    const value = arr[1];
    cookieObject[key] = value;
  });
}

export const defaultConfig: Partial<AppConfig> = {
  server: {
    port: parseInt(process.env.PORT || '3200', 10),
    cors: {
      exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'],
      maxAge: 5,
      credentials: false,
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
    },
  },
  request: {
    timeout: 10000,
    withCredentials: true,
    contentType: 'application/x-www-form-urlencoded;charset=UTF-8;text/plain;',
    responseType: 'json',
    baseURL: {
      y: 'https://y.qq.com',
      c: 'https://c.y.qq.com',
      u: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
      pic: 'https://y.gtimg.cn/music/photo_new/',
    },
    referer: {
      y: 'https://y.qq.com/',
      c: 'https://c.y.qq.com/',
      u: 'https://y.qq.com/portal/player.html',
    },
  },
  api: {
    commonParams: {
      g_tk: 1124214810,
      get loginUin() {
        return cookieObject.uin || '0';
      },
      hostUin: 0,
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 0,
    },
    _guid: (Math.round(2147483647 * Math.random()) * new Date().getUTCMilliseconds()) % 1e10,
    options: {
      param: 'jsonpCallback',
      prefix: 'tan',
    },
    optionsPrefix: {
      param: 'jsonpCallback',
      prefix: 'playlistinfoCallback',
    },
  },
  user: {
    loginUin: '',
    cookie: defaultCookie,
    uin: cookieObject.uin || '',
    cookieList,
    cookieObject,
  },
};
