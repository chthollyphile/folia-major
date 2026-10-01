import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/electron/nowPlayingSenderFixedPort.test.ts
// The port is deliberately not configurable: 9863 is what now-playing-service, its frontend and
// PV Tool all dial, and only one listener can hold it. Exposing a setter invites the user to move
// the sender off the one port every existing client tries.

describe('now playing sender port', () => {
  const mainCjsPath = path.resolve(__dirname, '../../../electron/main.cjs');
  const mainContent = fs.readFileSync(mainCjsPath, 'utf8');

  it('binds a single fixed port and offers no way to change it', () => {
    expect(mainContent).toContain("const NOW_PLAYING_SENDER_PORT = 9863;");
    expect(mainContent).not.toContain('NOW_PLAYING_SENDER_PORT_SETTING_KEY');
    expect(mainContent).not.toContain("ipcMain.handle('now-playing-sender-set-port'");
    expect(mainContent).not.toContain("ipcMain.handle('now-playing-sender-port-available'");
  });

  it('exposes no port verbs through the preload bridge', () => {
    const preloadContent = fs.readFileSync(path.resolve(__dirname, '../../../electron/preload.cjs'), 'utf8');
    expect(preloadContent).not.toContain('setNowPlayingSenderPort');
    expect(preloadContent).not.toContain('isNowPlayingSenderPortAvailable');
  });
});
