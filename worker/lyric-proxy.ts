// worker/lyric-proxy.ts

/**
 * Cloudflare Worker API Proxy handler.
 * Proxies requests to allowed domains (*.qq.com and *.kugou.com) to bypass CORS.
 */

export async function handleLyricProxy(request: Request): Promise<Response> {
  const corsHeaders = {
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
  const ignoredForwardHeaders = ['host', 'connection', 'content-length', 'origin', 'referer'];
  const isAllowedLyricProxyHost = (hostname: string): boolean =>
    hostname === 'qq.com' || hostname.endsWith('.qq.com') ||
    hostname === 'kugou.com' || hostname.endsWith('.kugou.com');

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const targetUrlStr = url.searchParams.get('url');

  if (!targetUrlStr) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const hostname = targetUrl.hostname;

    // Security check: only allow proxying to qq.com and kugou.com domains
    const isAllowed = isAllowedLyricProxyHost(hostname);

    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Forbidden: Domain not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter headers to forward
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!ignoredForwardHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(request.method);
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    if (hasBody) {
      fetchOptions.body = await request.clone().arrayBuffer();
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);
    const responseHeaders = new Headers(response.headers);
    
    // Add CORS headers to the response
    Object.entries(corsHeaders).forEach(([key, val]) => {
      responseHeaders.set(key, val);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Cloudflare Worker Proxy request failed:', error);
    return new Response(JSON.stringify({ error: 'Proxy request failed', details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
