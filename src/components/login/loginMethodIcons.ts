// src/components/login/loginMethodIcons.ts
// 登录方式的图标。平台只声明图标的名字（LoginMethod.iconKey），这里按名字到 src/assets/providers/
// 里取同名的 .svg；没有这个文件就没有图标。加一种登录方式的图标只要往那个文件夹放一个文件。
// Folium 2.0 的音源模组给的是图片的地址（模组目录里的图片，folia-mod://；或 https、data: 地址），原样用。

const ICONS = import.meta.glob<string>('../../assets/providers/*.svg', { eager: true, query: '?url', import: 'default' });

const PICTURE_URL = /^(?:folia-mod:\/\/|https:\/\/|data:image\/)/;

export const loginMethodIcon = (iconKey: string): string => (
    PICTURE_URL.test(iconKey) ? iconKey : ICONS[`../../assets/providers/${iconKey}.svg`] ?? ''
);
