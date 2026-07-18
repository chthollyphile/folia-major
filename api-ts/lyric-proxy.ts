import { URL } from 'url';

// 当前文件：Vercel 歌词请求代理函数的 TypeScript 源文件。

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
  'Access-Control-Allow-Headers': [
    'X-CSRF-Token',
    'X-Requested-With',
    'Accept',
    'Accept-Version',
    'Content-Length',
    'Content-MD5',
    'Content-Type',
    'Date',
    'X-Api-Version',
    'KG-Rec',
    'KG-RC',
    'KG-CLIENTTIMEMS',
    'mid',
    'x-router',
  ].join(', '),
};

const IGNORED_FORWARD_HEADERS = [
  'host',
  'connection',
  'content-length',
  'origin',
  'referer',
  'cookie',
  'authorization',
  'proxy-authorization',
  'x-vercel-protection-bypass',
];

function isAllowedLyricProxyHost(hostname: string): boolean {
  return hostname === 'qq.com' || hostname.endsWith('.qq.com') ||
    hostname === 'y.gtimg.cn' ||
    hostname === 'kugou.com' || hostname.endsWith('.kugou.com') ||
    hostname === 'amll-ttml-db.stevexmh.net';
}

function isAmllDbHost(hostname: string): boolean {
  return hostname === 'amll-ttml-db.stevexmh.net';
}

export default async function handler(req: any, res: any) {
  // Allow CORS for the proxy
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url: targetUrlStr } = req.query;
  if (!targetUrlStr) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const hostname = targetUrl.hostname;

    // Security check: only allow proxying to known lyric provider domains
    const isAllowed = isAllowedLyricProxyHost(hostname);

    if (!isAllowed) {
      return res.status(403).json({ error: 'Forbidden: Domain not allowed' });
    }

    // Filter headers to forward
    const headers: Record<string, string> = {};
    for (const key of Object.keys(req.headers)) {
      if (!IGNORED_FORWARD_HEADERS.includes(key.toLowerCase())) {
        headers[key] = req.headers[key] as string;
      }
    }

    if (hostname === 'u.y.qq.com') {
      headers.Cookie = 'tmeLoginType=-1;';
      headers['User-Agent'] = 'okhttp/3.14.9';
    }

    // Forward the method and body (if present and method is not GET/HEAD)
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (hasBody) {
      if (typeof req.body === 'object') {
        fetchOptions.body = JSON.stringify(req.body);
      } else {
        fetchOptions.body = req.body;
      }
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);
    if (isAmllDbHost(hostname) && response.status === 404) {
      return res.status(204).end();
    }

    const contentType = response.headers.get('content-type') || '';

    // Forward response headers
    res.setHeader('Content-Type', contentType);

    if (contentType.includes('application/json')) {
      const json = await response.json();
      return res.status(response.status).json(json);
    } else {
      const buffer = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Proxy request failed:', error);
    return res.status(500).json({ error: 'Proxy request failed', details: String(error) });
  }
}
