import { expect, test } from './fixtures';

// test/component/fmTab.spec.ts
// 私人 FM 面板的模式入口。整应用测试进不到 FM 播放状态，所以走组件探针，
// 覆盖入口是否可点、以及 provider 不支持模式时是否整块消失。

test('fm tab opens the mode picker and hides the entry without provider support', async ({ mount }) => {
    const component = await mount('fmTab');

    const entry = component.getByRole('button', { name: '场景 · 助眠' });
    await expect(entry).toBeVisible();

    await entry.click();
    await expect(component.locator('[data-probe-open-count="1"]')).toBeVisible();

    await component.locator('[data-probe-toggle="supported"]').click();
    await expect(entry).toBeHidden();
});
