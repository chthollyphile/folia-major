// electron/obsBrowserSourceHttp.cjs
// HTTP boundary for the desktop OBS browser source, independent of Electron startup.

function sendObsJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function createObsBrowserSourceHttpHandler({
  getConfiguredObsBrowserSourcePort,
  isObsBrowserSourceEnabled,
  obsBrowserSourceClients,
  matchesObsBrowserSourceToken,
  sendObsBrowserSourceBootstrapEvents,
  broadcastObsBrowserSourceStatus,
  isElectronDevRuntime,
  serveObsStaticFile,
}) {
  return async function handleObsBrowserSourceHttpRequest(req, res) {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${getConfiguredObsBrowserSourcePort()}`);
    const pathname = requestUrl.pathname;

    if (pathname === '/obs/health' && req.method === 'GET') {
      // Health is public; the credential-bearing status belongs to the desktop IPC flow.
      sendObsJson(res, 200, {
        enabled: isObsBrowserSourceEnabled(),
        port: getConfiguredObsBrowserSourcePort(),
        clientCount: obsBrowserSourceClients.size,
      });
      return;
    }

    if (!isObsBrowserSourceEnabled()) {
      sendObsJson(res, 503, { error: 'OBS browser source is disabled.' });
      return;
    }

    if (pathname === '/obs/events' && req.method === 'GET') {
      if (!matchesObsBrowserSourceToken(requestUrl)) {
        sendObsJson(res, 401, { error: 'Unauthorized.' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      obsBrowserSourceClients.add(res);
      sendObsBrowserSourceBootstrapEvents(res);
      broadcastObsBrowserSourceStatus();

      req.on('close', () => {
        obsBrowserSourceClients.delete(res);
        broadcastObsBrowserSourceStatus();
      });
      return;
    }

    if (pathname === '/obs' && req.method === 'GET') {
      if (!matchesObsBrowserSourceToken(requestUrl)) {
        sendObsJson(res, 401, { error: 'Unauthorized.' });
        return;
      }

      if (isElectronDevRuntime()) {
        const devUrl = new URL('http://localhost:3000');
        devUrl.searchParams.set('obs', '1');
        devUrl.searchParams.set('token', requestUrl.searchParams.get('token') || '');
        devUrl.searchParams.set('obsPort', String(getConfiguredObsBrowserSourcePort()));
        res.writeHead(302, { Location: devUrl.toString() });
        res.end();
        return;
      }
    }

    await serveObsStaticFile(req, res, pathname);
  };
}

module.exports = { createObsBrowserSourceHttpHandler, sendObsJson };
