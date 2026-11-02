// src/components/login/platformLogo.ts
// 平台记号的图标。平台只声明图标的名字（ProviderMark.logoKey），这里按名字到 src/assets/folia-login-icon/
// 里取同名的 .svg；没有这个文件就没有图标，记号画字。加一个平台的图标只要往那个文件夹放一个文件。

const LOGOS = import.meta.glob<string>('../../assets/folia-login-icon/*.svg', { eager: true, query: '?url', import: 'default' });

export const platformLogo = (logoKey: string): string => LOGOS[`../../assets/folia-login-icon/${logoKey}.svg`] ?? '';
