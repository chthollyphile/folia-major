import { HeartPulse, Square } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/heartbeatCommands.ts
// Heartbeat is a liked-playlist recommendation session independent of Personal FM.

export const heartbeatCommands: CommandPaletteCommand[] = [
    defineCommand({
        id: 'heartbeat-start',
        group: 'playback',
        title: 'Start Heartbeat',
        description: 'Play your liked songs with NetEase recommendations',
        keywords: ['intelligence', 'netease recommendations', '心动模式', '心动', '网易云推荐'],
        icon: HeartPulse,
        isAvailable: context => Boolean(context?.playback.canStartHeartbeat
            && !context.playback.isHeartbeatMode && !context.playback.isHeartbeatLoading),
        execute: (_input, context) => context.playback.startHeartbeat(),
    }),
    defineCommand({
        id: 'heartbeat-stop',
        group: 'playback',
        title: 'Stop Heartbeat',
        description: 'Finish the current track, then resume your previous queue',
        keywords: ['end recommendations', '停止心动', '退出心动模式'],
        icon: Square,
        isAvailable: context => Boolean(context?.playback.isHeartbeatMode || context?.playback.isHeartbeatLoading),
        execute: (_input, context) => {
            context.playback.stopHeartbeat();
            context.shared.setStatusMsg({ type: 'info', text: context.shared.t('heartbeat.stopped') });
            return true;
        },
    }),
];
