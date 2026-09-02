import { type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../../helpers/appState';

// test/ui/helpers/appFixtures.ts
// The mocked Netease / Navidrome / local-library world the UI specs boot the app into.
//
// This used to live inside app.screenshot.spec.ts, which is where it was written and where it was
// stuck: any other spec that needed a real, populated home surface had to either re-mock all of it
// or give up and test something narrower. The screenshots still use exactly what they always did.


export type MockNeteaseMode = 'logged-in' | 'guest';

export const NAVIDROME_SERVER = 'http://navidrome.test';

export const svgDataUrl = (label: string, background: string, foreground = '#ffffff') =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="${background}" rx="48"/>
      <text x="50%" y="50%" fill="${foreground}" font-size="56" font-family="Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${label}</text>
    </svg>`
  )}`;

export const createNavidromeCoverSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1f2937" />
        <stop offset="100%" stop-color="#0f766e" />
      </linearGradient>
    </defs>
    <rect width="600" height="600" fill="url(#bg)" rx="48"/>
    <circle cx="300" cy="300" r="160" fill="rgba(255,255,255,0.14)" />
    <text x="50%" y="50%" fill="#f8fafc" font-size="56" font-family="Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;

export const neteaseFixtures = {
  profile: {
    userId: 1001,
    nickname: 'Fixture Listener',
    avatarUrl: svgDataUrl('User', '#2563eb'),
    backgroundUrl: svgDataUrl('BG', '#0f172a'),
  },
  playlists: [
    {
      id: 9001,
      name: 'Daily Mix',
      coverImgUrl: svgDataUrl('Mix', '#ef4444'),
      trackCount: 18,
      playCount: 1204,
      updateTime: 1710000000000,
      trackUpdateTime: 1710000000000,
    },
    {
      id: 9002,
      name: 'Late Night Drive',
      coverImgUrl: svgDataUrl('Drive', '#7c3aed'),
      trackCount: 32,
      playCount: 420,
      updateTime: 1710000000000,
      trackUpdateTime: 1710000000000,
    },
  ],
  cloudSongs: [
    {
      id: 7001,
      name: 'Cloud Archive',
      ar: [{ id: 11, name: 'Cloud Artist' }],
      al: {
        id: 101,
        name: 'Cloud Album',
        picUrl: svgDataUrl('Cloud', '#0891b2'),
      },
      dt: 185000,
      t: 1,
    },
  ],
  likedSongIds: [7001, 7002, 7003],
};

export const navidromeFixtures = {
  config: {
    serverUrl: NAVIDROME_SERVER,
    username: 'fixture',
    passwordHash: 'fixture-password',
  },
  albums: [
    {
      id: 'album-aurora',
      name: 'Aurora Echoes',
      artist: 'Test Ensemble',
      artistId: 'artist-1',
      coverArt: 'cover-aurora',
      songCount: 8,
      duration: 1620,
      year: 2024,
    },
    {
      id: 'album-sunrise',
      name: 'Sunrise Circuit',
      artist: 'Signal Bloom',
      artistId: 'artist-2',
      coverArt: 'cover-sunrise',
      songCount: 11,
      duration: 1980,
      year: 2023,
    },
  ],
  playlists: [
    {
      id: 'playlist-main',
      name: 'Workspace Rotation',
      owner: 'fixture',
      coverArt: 'cover-playlist-main',
      songCount: 12,
    },
  ],
  artists: [
    {
      id: 'artist-1',
      name: 'Test Ensemble',
      albumCount: 1,
    },
    {
      id: 'artist-2',
      name: 'Signal Bloom',
      albumCount: 1,
    },
  ],
  randomSongs: [
    {
      id: 'song-random-1',
      title: 'Random Access Heart',
      album: 'Aurora Echoes',
      albumId: 'album-aurora',
      artist: 'Test Ensemble',
      artistId: 'artist-1',
      coverArt: 'cover-aurora',
      duration: 210,
      track: 1,
    },
  ],
  favoriteSongs: [
    {
      id: 'song-favorite-1',
      title: 'Starboard Lights',
      album: 'Sunrise Circuit',
      albumId: 'album-sunrise',
      artist: 'Signal Bloom',
      artistId: 'artist-2',
      coverArt: 'cover-sunrise',
      duration: 225,
      track: 2,
    },
  ],
};

export const localImportFixture = {
  rootName: 'Fixture Library',
  entries: [
    {
      kind: 'file',
      name: 'Test Artist - Midnight Train.mp3',
      type: 'audio/mpeg',
      content: 'fake-audio-data',
      lastModified: 1710000000000,
    },
    {
      kind: 'file',
      name: 'Test Artist - Midnight Train.lrc',
      type: 'text/plain',
      content: '[00:00.00]Midnight Train\n[00:12.00]Leaves the station',
      lastModified: 1710000000000,
    },
    {
      kind: 'file',
      name: 'cover.jpg',
      type: 'image/jpeg',
      content: 'fixture-cover',
      lastModified: 1710000000000,
    },
  ],
};

export async function installBaseState(
  page: Page,
  options: {
    neteaseMode?: MockNeteaseMode;
    navidromeEnabled?: boolean;
    localImportFixture?: typeof localImportFixture;
  } = {},
) {
  await page.addInitScript((payload: {
    navidromeServer: string;
    neteaseMode: MockNeteaseMode;
    navidromeEnabled: boolean;
    navidromeConfig: typeof navidromeFixtures.config;
    localImportFixture?: typeof localImportFixture;
    appVersion: string;
    guideVersionStorageKey: string;
  }) => {
    const createMatchMediaResult = (query: string) => ({
      matches: query.includes('light'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => createMatchMediaResult(query),
    });

    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'en-US',
    });
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['en-US', 'en'],
    });

    localStorage.clear();
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('default_theme_daylight', 'true');
    localStorage.setItem('static_mode', 'true');
    localStorage.setItem('last_app_view', 'home');
    localStorage.setItem('last_home_view_tab', 'playlist');
    // 必须写当前版本：写死旧版本会让用户指引弹窗自动弹出并盖住整页，后续点击全部被拦截
    localStorage.setItem(payload.guideVersionStorageKey, payload.appVersion);

    if (payload.navidromeEnabled) {
      localStorage.setItem('navidrome_enabled', 'true');
      localStorage.setItem('navidrome_config', JSON.stringify(payload.navidromeConfig));
    }

    if (payload.neteaseMode === 'logged-in') {
      localStorage.setItem('netease_cookie', 'fixture-cookie');
    }

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        getAudioCacheUsage: async () => 0,
        clearAudioCache: async () => {},
        getAudioCacheStats: async () => ({ size: 0, count: 0 }),
        isWindowMaximized: async () => false,
      },
    });

    window.alert = () => {};

    if (!payload.localImportFixture) {
      return;
    }

    class MockAudio extends EventTarget {
      duration = 126;
      #src = '';

      set src(value: string) {
        this.#src = value;
        void this.#src;
        setTimeout(() => {
          this.dispatchEvent(new Event('loadedmetadata'));
        }, 0);
      }

      get src() {
        return this.#src;
      }
    }

    const OriginalWorker = window.Worker;
    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readonly #url: string;

      constructor(url: string | URL) {
        this.#url = String(url);

        if (!this.#url.includes('metadataParser.worker')) {
          return new OriginalWorker(url as string, { type: 'module' }) as unknown as MockWorker;
        }
      }

      postMessage(message: { type: string; requestId: string; file?: File; cover?: Blob; }) {
        if (!this.#url.includes('metadataParser.worker')) {
          return;
        }

        if (message.type === 'hash-cover' && message.cover) {
          setTimeout(() => {
            this.onmessage?.({
              data: {
                type: 'result',
                requestId: message.requestId,
                data: {
                  cover: message.cover,
                  coverAssetId: `sha256:${'f'.repeat(64)}`,
                },
              },
            } as MessageEvent);
          }, 0);
          return;
        }

        if (message.type !== 'parse-metadata' || !message.file) {
          return;
        }

        const baseName = message.file.name.replace(/\.[^.]+$/, '');
        const [artist = 'Fixture Artist', title = baseName] = baseName.split(' - ');
        const response = {
          type: 'result',
          requestId: message.requestId,
          data: {
            title,
            artist,
            album: 'Fixture Album',
            duration: 126000,
          },
        };

        setTimeout(() => {
          this.onmessage?.({ data: response } as MessageEvent);
        }, 0);
      }

      terminate() {}

      addEventListener() {}

      removeEventListener() {}
    }

    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: MockWorker,
    });
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: MockAudio,
    });

    const createFileHandle = (entry: typeof localImportFixture.entries[number]) => ({
      kind: 'file' as const,
      name: entry.name,
      async getFile() {
        return new File([entry.content], entry.name, {
          type: entry.type,
          lastModified: entry.lastModified,
        });
      },
    });

    const createDirectoryHandle = (fixture: typeof localImportFixture) => {
      const fileHandles = fixture.entries.map(createFileHandle);

      return {
        kind: 'directory' as const,
        name: fixture.rootName,
        async *values() {
          for (const handle of fileHandles) {
            yield handle;
          }
        },
        async getFileHandle(name: string) {
          const handle = fileHandles.find(item => item.name === name);
          if (!handle) {
            throw new DOMException(`Missing file: ${name}`, 'NotFoundError');
          }
          return handle;
        },
        async getDirectoryHandle() {
          throw new DOMException('Nested directories are not defined in this fixture', 'NotFoundError');
        },
        async queryPermission() {
          return 'granted';
        },
        async requestPermission() {
          return 'granted';
        },
      };
    };

    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => createDirectoryHandle(payload.localImportFixture!),
    });
  }, {
    navidromeServer: NAVIDROME_SERVER,
    neteaseMode: options.neteaseMode ?? 'guest',
    navidromeEnabled: options.navidromeEnabled ?? false,
    navidromeConfig: navidromeFixtures.config,
    localImportFixture: options.localImportFixture,
    appVersion: APP_VERSION,
    guideVersionStorageKey: GUIDE_VERSION_STORAGE_KEY,
  });
}

export async function mockNeteaseApi(page: Page, mode: MockNeteaseMode) {
  let qrConfirmed = false;
  await page.route('**/__mock_netease__/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/__mock_netease__', '');

    if (mode === 'guest' && endpoint === '/login/qr/key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { unikey: 'fixture-qr-key' } }) });
      return;
    }
    if (mode === 'guest' && endpoint === '/login/qr/create') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { qrimg: svgDataUrl('QR', '#ffffff', '#111827') } }) });
      return;
    }
    if (mode === 'guest' && endpoint === '/login/qr/check') {
      qrConfirmed = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 803, cookie: 'fixture-cookie' }) });
      return;
    }

    if (mode === 'guest' && !qrConfirmed) {
      if (endpoint === '/login/status') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {} }),
        });
        return;
      }
    }

    const playlistPayload = neteaseFixtures.playlists.map(playlist => ({
      ...playlist,
      creator: neteaseFixtures.profile,
      description: `${playlist.name} fixture playlist`,
    }));

    const responses: Record<string, unknown> = {
      '/login/status': {
        data: {
          profile: neteaseFixtures.profile,
        },
        cookie: 'fixture-cookie',
      },
      '/user/account': {
        account: {
          id: neteaseFixtures.profile.userId,
        },
        profile: neteaseFixtures.profile,
      },
      '/user/playlist': {
        playlist: playlistPayload,
      },
      '/user/cloud': {
        count: neteaseFixtures.cloudSongs.length,
        songs: neteaseFixtures.cloudSongs,
      },
      '/likelist': {
        ids: neteaseFixtures.likedSongIds,
      },
    };

    const body = responses[endpoint] ?? {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export async function mockNavidromeApi(page: Page) {
  await page.route(`${NAVIDROME_SERVER}/**`, async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/rest/', '');

    if (endpoint === 'getCoverArt') {
      const id = url.searchParams.get('id') || 'cover';
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: createNavidromeCoverSvg(id.replace(/^cover-/, '').toUpperCase()),
      });
      return;
    }

    const responses: Record<string, unknown> = {
      getAlbumList2: {
        'subsonic-response': {
          status: 'ok',
          albumList2: {
            album: navidromeFixtures.albums,
          },
        },
      },
      getPlaylists: {
        'subsonic-response': {
          status: 'ok',
          playlists: {
            playlist: navidromeFixtures.playlists,
          },
        },
      },
      getArtists: {
        'subsonic-response': {
          status: 'ok',
          artists: {
            index: [
              {
                name: 'F',
                artist: navidromeFixtures.artists,
              },
            ],
          },
        },
      },
      getStarred2: {
        'subsonic-response': {
          status: 'ok',
          starred2: {
            song: navidromeFixtures.favoriteSongs,
          },
        },
      },
      getRandomSongs: {
        'subsonic-response': {
          status: 'ok',
          randomSongs: {
            song: navidromeFixtures.randomSongs,
          },
        },
      },
      getOpenSubsonicExtensions: {
        'subsonic-response': {
          status: 'ok',
          openSubsonic: true,
          openSubsonicExtensions: [
            { name: 'songLyrics', versions: [1] },
            { name: 'formPost', versions: [1] },
          ],
        },
      },
      getUser: {
        'subsonic-response': {
          status: 'ok',
          user: {
            username: navidromeFixtures.config.username,
            scrobblingEnabled: true,
          },
        },
      },
      getMusicFolders: {
        'subsonic-response': {
          status: 'ok',
          musicFolders: {
            musicFolder: [
              { id: 'music', name: 'Music' },
            ],
          },
        },
      },
      getLicense: {
        'subsonic-response': {
          status: 'ok',
          license: {
            valid: true,
          },
        },
      },
      scrobble: {
        'subsonic-response': {
          status: 'ok',
        },
      },
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[endpoint] ?? {
        'subsonic-response': {
          status: 'ok',
        },
      }),
    });
  });
}

export async function openApp(page: Page) {
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        caret-color: transparent !important;
      }
      /* 隐藏所有 canvas：shell 背景是 Paper shader（latent 模式），每次加载的相位不同，
         即使 static_mode 冻结了动画，跨加载依然渲染出不同纹理 —— 实测三次加载得到三个哈希。
         不中和它就录不出稳定基线。用 visibility 而非 display，保持布局不变。 */
      canvas {
        visibility: hidden !important;
      }
    `,
  });
}
