import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
    installBaseState,
    localImportFixture,
    mockNavidromeApi,
    mockNeteaseApi,
    openApp,
} from './helpers/appFixtures';

// test/ui/app.screenshot.spec.ts
// Visual baselines for the three home surfaces. The mocked world they boot into lives in
// ./helpers/appFixtures so other specs can reach a populated grid too.
// The dev-only suite switch (it shows on the home since P3.4) is hidden while capturing: it is not
// part of the app a production build ships, and the baselines predate it.
const HIDE_DEV_OVERLAYS = fileURLToPath(new URL('./helpers/hideDevOverlays.css', import.meta.url));


test.describe('frontend screenshot coverage', () => {
  test('captures the Netease playlist home view', async ({ page }) => {
    await installBaseState(page, { neteaseMode: 'logged-in' });
    await mockNeteaseApi(page, 'logged-in');

    await openApp(page);

    await expect(page.getByRole('heading', { name: 'Daily Mix' }).first()).toBeVisible();
    await expect(page).toHaveScreenshot('netease-home.png', {
      animations: 'disabled',
      stylePath: HIDE_DEV_OVERLAYS,
      scale: 'css',
      fullPage: true,
    });
  });

  test('captures the Navidrome library view with mocked Subsonic responses', async ({ page }) => {
    await installBaseState(page, {
      neteaseMode: 'logged-in',
      navidromeEnabled: true,
    });
    await mockNeteaseApi(page, 'logged-in');
    await mockNavidromeApi(page);

    await openApp(page);

    await page.getByRole('button', { name: 'Navi' }).last().click();
    await expect(page.getByText('Aurora Echoes').first()).toBeVisible();
    await expect(page).toHaveScreenshot('navidrome-home.png', {
      animations: 'disabled',
      stylePath: HIDE_DEV_OVERLAYS,
      scale: 'css',
      fullPage: true,
    });
  });

  test('captures the local library after importing a mocked folder', async ({ page }) => {
    await installBaseState(page, {
      neteaseMode: 'guest',
      localImportFixture,
    });
    await mockNeteaseApi(page, 'guest');

    await openApp(page);

    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Folder' }).first()).toBeVisible();
    await expect(page).toHaveScreenshot('local-library.png', {
      animations: 'disabled',
      stylePath: HIDE_DEV_OVERLAYS,
      scale: 'css',
      fullPage: true,
    });
  });

  test('refreshes the active provider and closes the QR dialog after login', async ({ page }) => {
    test.setTimeout(30_000);
    await installBaseState(page, { neteaseMode: 'guest' });
    await mockNeteaseApi(page, 'guest');

    await openApp(page);
    // The home button opens the sign-in window with nothing chosen; the row of the platform starts its sign-in.
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    const loginDialog = page.getByRole('dialog');
    await expect(loginDialog).toBeVisible();
    await loginDialog.getByRole('option').first().click();
    await expect(loginDialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Daily Mix' }).first()).toBeVisible();
  });
});
