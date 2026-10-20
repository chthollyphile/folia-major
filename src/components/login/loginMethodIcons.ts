// src/components/login/loginMethodIcons.ts
// 登录方式的图标。平台只声明图标的名字（LoginMethod.iconKey），这里按名字到 src/assets/providers/
// 里取同名的文件；没有这个文件就没有图标。加一种登录方式的图标只要往那个文件夹放一个文件。
//
// 顺序 svg → png → webp：以前只认 .svg，于是那两颗扫码方式只能用手绘的简笔图
// （两个圆加一撇），跟资料库来源角标、平台记号上那些真机图标（从它们的 App 里
// 抠出来的 .png / .webp）根本不是一回事。现在把真图标（.png）放进那个文件夹就能
// 直接用，手绘那两张已经删掉。
//
// 这里**不许点名任何平台**：登录窗口的目录要与平台无关（见 loginModuleKnowsNoPlatform
// 那条守卫），平台自己的东西由它自己的 adapter 通过 omni 声明。文件名只是按 iconKey
// 拼出来的，写出来就成了把平台硬编进这一层。

const ICONS = import.meta.glob<string>(
    ['../../assets/providers/*.svg', '../../assets/providers/*.png', '../../assets/providers/*.webp'],
    { eager: true, query: '?url', import: 'default' },
);

/** 同名文件可能不止一种格式，按顺序取第一个找得到的。 */
const SUFFIXES = ['.svg', '.png', '.webp'] as const;

export const loginMethodIcon = (iconKey: string): string => {
    for (const suffix of SUFFIXES) {
        const hit = ICONS[`../../assets/providers/${iconKey}${suffix}`];
        if (hit) return hit;
    }
    return '';
};
