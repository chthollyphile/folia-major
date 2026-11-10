import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp, svgDataUrl } from './helpers/appFixtures';

// test/ui/collectionOpenTransition.spec.ts
// The whole app with the open transition switched on: what a click on a home card does to the
// screen in its first frames, and the way back.
//
// Why the whole app: the transition's own tests (test/component/collectionMorph.spec.ts) run it
// on a page that stands in for the host. What only the real host can show is here: the home
// surface, the page and the carrier in the same frames.
//
// The first case is the regression of a fault measured on 2026-10-08: the home surface was hidden
// in the very commit that mounted the page, while the page was still see-through. For some 90 ms
// what the player draws behind the home surface showed bare, without the home surface's tint and
// blur, which read as a flash of the background (with a bright picture standing behind, the mean
// brightness of the screen went from 129.8 to 146.7 for two frames, then down to the page's).

test.use({ serviceWorkers: 'block' });

const HOME_CARD = '[data-grid3d-index="0"]';
const PAGE = '[data-ponder-page-scope="grid-view-page"]';

type Frame = {
    t: number;
    /** The home surface's `visibility`. */
    home: string;
    /** The collection page's opacity; null while there is no page. */
    page: number | null;
    /** The carrier, where one is up: its direction, its frame's opacity (null with no frame), and its titles. */
    carrier: { direction: string | null; frame: number | null; titles: string[] } | null;
    /** The clicked home card's opacity. */
    card: string | null;
};

const bootHome = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'logged-in', preserveNativeMediaQueries: true });
    await page.addInitScript(() => {
        // The base state reduces every motion surface, for still screenshots; this one is the subject.
        localStorage.removeItem('reduce_motion_collectionMorph');
        Object.assign(window.electron!, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
        // Service workers are blocked: fail the cover worker's registration at once, so that the
        // app takes its "worker unavailable" path instead of waiting out a 10 s readiness timeout.
        const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        Object.defineProperty(navigator.serviceWorker, 'register', {
            configurable: true,
            value: (scriptURL: string | URL, options?: RegistrationOptions) => (
                String(scriptURL).includes('folia-cover-sw')
                    ? Promise.reject(new Error('Service workers are blocked in this spec.'))
                    : register(scriptURL, options)
            ),
        });
    });
    await mockNeteaseApi(page, 'logged-in');
    await page.route('**/__mock_netease__/user/cloud?*', route => route.fulfill({ json: { count: 0, songs: [] } }));
    // The shared mock gives a playlist no tracks; a page with no card has none to fly back.
    await page.route('**/__mock_netease__/playlist/track/all?*', route => route.fulfill({
        json: {
            songs: Array.from({ length: 9 }, (_, index) => ({
                id: 8000 + index,
                name: `Track ${index + 1}`,
                ar: [{ id: 21, name: 'Fixture Artist' }],
                al: { id: 201, name: 'Fixture Album', picUrl: svgDataUrl(`T${index + 1}`, '#0f766e') },
                dt: 180000,
            })),
            privileges: [],
        },
    }));
    await openApp(page);
    await expect(page.locator('[data-grid3d-slider] + div h3')).toHaveText('Daily Mix');
};

/** Reads the screen every frame for `ms` from the next click on; call BEFORE the click. */
const recordFromNextClick = (page: Page, ms: number) => page.evaluate(([cardAt, pageAt, limit]) => {
    (window as unknown as { __frames?: Promise<Frame[]> }).__frames = new Promise((resolve) => {
        document.addEventListener('click', () => {
            const frames: Frame[] = [];
            const started = performance.now();
            const read = () => {
                let home = document.querySelector<HTMLElement>('[data-grid3d-slider]');
                while (home && !home.hasAttribute('aria-hidden')) home = home.parentElement;
                const collectionPage = document.querySelector(pageAt);
                const cover = document.querySelector('[data-folia-collection-morph="cover"]');
                const card = document.querySelector(cardAt);
                const frame = document.querySelector('[data-folia-collection-morph="frame"]');
                frames.push({
                    t: Math.round(performance.now() - started),
                    home: home ? getComputedStyle(home).visibility : 'none',
                    page: collectionPage ? Number(getComputedStyle(collectionPage).opacity) : null,
                    carrier: cover
                        ? {
                            direction: cover.getAttribute('data-folia-collection-morph-direction'),
                            frame: frame ? Number(getComputedStyle(frame).opacity) : null,
                            titles: [...document.querySelectorAll('[data-folia-collection-morph="title"]')].map(line => line.textContent ?? ''),
                        }
                        : null,
                    card: card ? getComputedStyle(card).opacity : null,
                });
                if (performance.now() - started < limit) requestAnimationFrame(read);
                else resolve(frames);
            };
            read();
        }, { capture: true, once: true });
    });
}, [HOME_CARD, PAGE, ms] as const);

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Promise<Frame[]> }).__frames);

test('opening from a home card: the home surface stays shown until the page has covered it, and the card flies', async ({ page }) => {
    await bootHome(page);
    await recordFromNextClick(page, 1000);
    await page.locator(HOME_CARD).click();
    const seen = await frames(page);
    const withPage = seen.filter(frame => frame.page !== null);
    expect(withPage.length).toBeGreaterThan(10);

    // No frame with the home surface gone and the page not yet whole.
    expect(seen.filter(frame => frame.home === 'hidden' && (frame.page ?? 0) < 0.99)).toEqual([]);
    // It does go, once it is covered.
    expect(seen[seen.length - 1].home).toBe('hidden');

    // The carrier is up in the page's first frame: the card's frame, its cover and its title. The
    // frame is the home card's own, whole from the start (one the card did not have would fade in).
    expect(withPage[0].carrier).toEqual({ direction: 'in', frame: 1, titles: expect.arrayContaining(['Daily Mix']) });
    // The card itself is not shown beside its carrier.
    expect(withPage[0].card).toBe('0');
    // The flight ends by itself.
    await expect(page.locator('[data-folia-collection-morph]')).toHaveCount(0);
    await expect(page.locator(PAGE)).toBeVisible();
});

test('back to the home surface: the card flies back onto the home card, which is shown again when it has landed', async ({ page }) => {
    await bootHome(page);
    await page.locator(HOME_CARD).click();
    await expect(page.locator(PAGE)).toBeVisible();
    await expect(page.locator('[data-folia-collection-morph]')).toHaveCount(0);
    // The page's own cards are there, and the stand-in the card flew to has given way to them.
    await expect(page.locator(`${PAGE} [data-folia-grid-item-id]`)).toHaveCount(9);
    await expect(page.locator(`${PAGE} [data-folia-morph-target]`)).toHaveCount(0);

    await recordFromNextClick(page, 1000);
    await page.locator(`${PAGE} button`).first().click();
    const seen = await frames(page);
    const flying = seen.filter(frame => frame.carrier !== null);
    expect(flying.length).toBeGreaterThan(10);
    expect(new Set(flying.map(frame => frame.carrier!.direction))).toEqual(new Set(['out']));
    // What flies back is the card at the middle of the page, with its frame, turning into the home card.
    expect(flying[0].carrier).toEqual({ direction: 'out', frame: 1, titles: ['Track 1', 'Daily Mix'] });
    // The home surface is back under the page from the frame the page starts to leave, so that
    // nothing is bare behind it; the card the carrier flies to is not shown until it lands.
    expect(new Set(flying.map(frame => frame.home))).toEqual(new Set(['visible']));
    expect(flying[0].card).toBe('0');
    expect(flying[Math.floor(flying.length / 2)].card).toBe('0');

    await expect(page.locator('[data-folia-collection-morph]')).toHaveCount(0);
    await expect(page.locator(PAGE)).toHaveCount(0);
    expect(await page.locator(HOME_CARD).evaluate(card => getComputedStyle(card).opacity)).toBe('1');
});
