import { Package } from 'lucide-react';
import { defineCommand } from '../commandFactories';

// Portable renderer bundles are available on the web as well as the desktop.
export const stylePackCommands = [defineCommand({
    id: 'style-packs', group: 'panel', title: 'Style packs', description: 'Import, select and export player style packs',
    keywords: ['style', 'skin', 'pack', '风格包', '播放器皮肤', '导入'], icon: Package,
    requiresInput: true,
    surface: { load: () => import('../../../stylePacks/StylePackSurface'), mapProps: () => ({}) },
    execute: () => false,
})];
