// dev/folium/sample-account-console/index.cjs
// Folium 1.7 sample, Node half: pushes messages to this mod's client and reads the `secret`
// settings field from the main process.
//
//   - `heartbeat`: api.rpc.send every 15 seconds, whether or not the client is listening. Nothing
//     is queued: a message sent while the client is not running is dropped, so the client asks
//     for the current state once (`status`) after it starts listening.
//   - `pong`: sent from inside the `ping` handler, the reverse direction of the call that came in.
//     The page's button calls `ping`, and so does the client's `ping` command, which the user can
//     bind in Settings → Global shortcuts.
//   - `secretStatus`: api.secrets.subscribe hears that the user saved or cleared the key (it gets
//     the key, never the value); the main entry reads it again and tells the client whether it is
//     set. The value itself never leaves this file and is never logged.
//
// No permission is needed for any of it: api.secrets reaches only this mod's own values, and
// api.rpc.send only this mod's own client.

'use strict';

const SECRET_KEY = 'apiKey';
const HEARTBEAT_MS = 15_000;

module.exports = function activate(api) {
  // Folium 1.6 hosts have neither api.secrets nor api.rpc.send.
  if (api.host.folium.minor < 7) {
    api.log.warn('sample-account-console needs Folium 1.7 (api.secrets, api.rpc.send)');
    return undefined;
  }

  const startedAt = Date.now();
  let sent = 0;
  let beats = 0;

  // A bad name or a payload that is not JSON (or over 64 KB) throws here; a missing window does not.
  const send = (name, payload) => {
    api.rpc.send(name, payload);
    sent += 1;
  };

  /*
   * 'set' or 'unset'. On every start the main entry runs before the client registers its settings
   * section, so the host does not know yet that `apiKey` is a secret field: a key with no value then
   * reads as null all the same (only `set` has to wait for the section).
   */
  const readSecretStatus = async () => {
    const value = await api.secrets.get(SECRET_KEY);
    // A real mod would use `value` here (an Authorization header, say) and keep it nowhere else.
    return value === null ? 'unset' : 'set';
  };

  // Stopped by the host when the mod stops; no disposer needed.
  api.secrets.subscribe((key) => {
    if (key !== SECRET_KEY) return;
    readSecretStatus()
      .then((status) => send('secretStatus', { status, at: Date.now() }))
      .catch((error) => api.log.warn('could not read the secret field', String(error)));
  });

  const timer = setInterval(() => {
    beats += 1;
    send('heartbeat', { count: beats, at: Date.now() });
  }, HEARTBEAT_MS);
  api.onDispose(() => clearInterval(timer));

  // What the client fetches once after adding its rpc.on listeners: messages sent before were dropped.
  api.rpc.handle('status', async () => ({
    startedAt,
    sent,
    beats,
    secret: await readSecretStatus(),
  }));

  // Answers the call, then pushes a message of its own.
  api.rpc.handle('ping', (note) => {
    send('pong', { note: typeof note === 'string' ? note.slice(0, 80) : '', at: Date.now() });
    return { sent };
  });

  readSecretStatus()
    .then((status) => api.log.info(`sample-account-console ${api.manifest.version}: secret field ${status}`))
    .catch((error) => api.log.warn('could not read the secret field', String(error)));
};
