import { ListChecks } from 'lucide-react';
import { omni } from '../../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { openLoginWindow } from '../../login/loginWindowStore';
import { defineCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/providerSetupCommand.ts
// 当前平台的配置清单（平台声明了 auth.getSetup，例如要装本机程序才能播放的平台）：打开登录窗口，直接到清单。
// 没登录的平台照常登录，登录之后的检查会给出清单。只在当前平台有清单时出现。

export const providerSetupCommand: CommandPaletteCommand = defineCommand({
    id: 'provider-playback-setup',
    group: 'settings',
    title: 'Platform playback setup',
    description: 'Open the setup checklist of the current platform',
    keywords: ['playback setup', 'platform setup', '播放设置', '平台配置'],
    icon: ListChecks,
    isAvailable: () => omni.hasSetup(useOnlineProviderAccountStore.getState().activeProviderId),
    execute: () => {
        openLoginWindow(useOnlineProviderAccountStore.getState().activeProviderId, null, 'setup');
        return true;
    },
});
