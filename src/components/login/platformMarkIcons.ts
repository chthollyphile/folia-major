// src/components/login/platformMarkIcons.ts
// 平台的记号图标。平台只声明图标的名字（ProviderMark.icon），这里按名字到 src/assets/platformMarks/
// 里取同名的 .svg；没有这个文件就回空串，界面退回画字母。加一个平台的图标只要往那个文件夹放一个文件。

const ICONS = import.meta.glob<string>('../../assets/platformMarks/*.svg', { eager: true, query: '?url', import: 'default' });

export const platformMarkIcon = (iconKey?: string): string => (
    iconKey ? ICONS[`../../assets/platformMarks/${iconKey}.svg`] ?? '' : ''
);
