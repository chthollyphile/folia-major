import { expect, test } from './fixtures';

// test/component/foliumSelectField.spec.ts
// 模组 select 参数换成宿主 CustomSelect（#485）后真实浏览器里的几件事：compact 触发按钮与文本框等高、
// 等宽；触发按钮的可访问名是「字段名 当前值」；鼠标按下选项时焦点移到选项上（focusin）不会提前收起菜单；
// 拦 mousedown 的容器（命令面板）里点别处能收起；Escape 只关菜单，外层收不到。
// 审查后补的：触发按钮是 select-only combobox，aria-activedescendant 跟着高亮项走（读屏靠它听到 ↑↓）；
// Enter 落在当前值上只收起；长列表（虚拟化分支）用键盘打开时当前项滚进视野，鼠标打开不滚。
// 见 dev/probes/foliumSelectField.probe.tsx。

test.describe('Folium select field', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('the compact trigger stands level with the text field of the same form', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const text = page.locator('[data-folium-entry] input[type="text"]');
        const select = page.getByRole('combobox', { name: 'Codec' });
        await expect(select).toHaveText('HEVC');
        // 同原生 select 的「名字 + 值」：读屏不打开菜单也能听到当前值。
        await expect(select).toHaveAccessibleName('Codec HEVC');

        const textBox = (await text.boundingBox())!;
        const selectBox = (await select.boundingBox())!;
        expect(Math.abs(selectBox.height - textBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(selectBox.width - textBox.width)).toBeLessThanOrEqual(1);

        // 底色与描边取自表单 token，和文本框一致。
        const look = (selector: string) => page.locator(selector).first().evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, border: style.borderTopColor };
        });
        expect(await look('[data-folium-entry] button[aria-haspopup="listbox"]'))
            .toEqual(await look('[data-folium-entry] input[type="text"]'));
    });

    test('a mouse pick lands: pressing an option leaves focus on the combobox and does not close the menu first', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('combobox', { name: 'Codec' });
        await select.click();
        const listbox = page.getByRole('listbox', { name: 'Codec' });
        const option = listbox.getByRole('option', { name: 'H.264', exact: true });

        // 菜单从不拿焦点（CustomSelectMenu 在 mousedown 上 preventDefault）：按下时焦点留在触发按钮上，
        // 菜单不因为焦点移动而收起，否则松开时点不到选项。
        await option.hover();
        await page.mouse.down();
        await expect(select).toBeFocused();
        await expect(listbox).toBeVisible();
        await page.mouse.up();

        await expect(listbox).toHaveCount(0);
        await expect(select).toHaveText('H.264');
        await expect(select).toHaveAccessibleName('Codec H.264');
        await expect(select).toHaveAttribute('aria-expanded', 'false');
    });

    test('a press elsewhere closes the menu inside a container that stops mousedown', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('combobox', { name: 'Codec' });
        await select.click();
        await expect(page.getByRole('listbox', { name: 'Codec' })).toBeVisible();

        await page.locator('[data-probe-elsewhere]').click();
        await expect(page.getByRole('listbox', { name: 'Codec' })).toHaveCount(0);
        await expect(select).toHaveAttribute('aria-expanded', 'false');
    });

    test('Escape closes only the menu and the keyboard picks an option', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('combobox', { name: 'Codec' });
        const outer = page.locator('[data-probe-outer-escapes]');

        await select.click();
        await page.keyboard.press('Escape');
        await expect(select).toHaveAttribute('aria-expanded', 'false');
        await expect(outer).toHaveAttribute('data-probe-outer-escapes', '0');
        await expect(select).toBeFocused();

        // Enter 打开、Enter 关闭：高亮停在当前值上，不算改值。
        await page.keyboard.press('Enter');
        await expect(page.getByRole('listbox', { name: 'Codec' })).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('listbox', { name: 'Codec' })).toHaveCount(0);
        await expect(select).toHaveText('HEVC');

        await page.keyboard.press('ArrowDown');
        const listbox = page.getByRole('listbox', { name: 'Codec' });
        await expect(listbox).toBeVisible();
        // 焦点留在触发按钮上，aria-controls / aria-activedescendant 把高亮项告诉读屏。
        await expect(select).toBeFocused();
        await expect(select).toHaveAttribute('aria-controls', (await listbox.getAttribute('id'))!);
        const hevc = listbox.getByRole('option', { name: 'HEVC', exact: true });
        await expect(select).toHaveAttribute('aria-activedescendant', (await hevc.getAttribute('id'))!);
        await page.keyboard.press('ArrowDown');
        const prores = listbox.getByRole('option', { name: 'ProRes 4444', exact: true });
        await expect(select).toHaveAttribute('aria-activedescendant', (await prores.getAttribute('id'))!);
        await page.keyboard.press('Enter');
        await expect(select).toHaveText('ProRes 4444');
        await expect(select).toHaveAccessibleName('Codec ProRes 4444');
        await expect(select).toHaveAttribute('aria-expanded', 'false');
        await expect(select).not.toHaveAttribute('aria-activedescendant', /./);

        await page.keyboard.press('Escape');
        await expect(outer).toHaveAttribute('data-probe-outer-escapes', '1');
    });

    test('a long list opened by keyboard shows its current option, opened by mouse starts at the top', async ({ mount, page }) => {
        await mount('foliumSelectField');
        const select = page.getByRole('combobox', { name: 'Preset' });
        const listbox = page.getByRole('listbox', { name: 'Preset' });
        const current = listbox.getByRole('option', { name: 'Preset 30', exact: true });

        await select.focus();
        await page.keyboard.press('ArrowDown');
        await expect(current).toBeInViewport({ ratio: 1 });
        await expect(current).toHaveAttribute('data-active', 'true');
        await expect(select).toHaveAttribute('aria-activedescendant', (await current.getAttribute('id'))!);
        // 下一格是 31。
        await page.keyboard.press('ArrowDown');
        await expect(listbox.getByRole('option', { name: 'Preset 31', exact: true })).toHaveAttribute('data-active', 'true');
        await page.keyboard.press('Escape');
        await expect(listbox).toHaveCount(0);

        await select.click();
        await expect(listbox.getByRole('option', { name: 'Preset 0', exact: true })).toBeInViewport({ ratio: 1 });
        await expect(current).toHaveCount(0);
    });
});
