import { PlayerState } from '../../../types';
import { Heart, ListX, Pause, Piano, Play, Repeat, Shuffle, SkipBack, SkipForward, Star, VolumeX } from 'lucide-react';
import { executeModeCommand } from './executeModeCommand';
import { queueCommand } from './queueCommand';
import { volumeCommand } from './volumeCommand';
import { fmModeCommand } from './fmModeCommand';
import { heartbeatCommands } from './heartbeatCommands';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, createReplayGainCommand, createSoundPresetCommand } from '../commandFactories';

// src/components/command-palette/commands/playbackCommands.ts
// Commands in the `playback` group: transport, queue, volume, Personal FM mode, ReplayGain, and
// sound presets.

export const playbackCommands: CommandPaletteCommand[] = [
    executeModeCommand,
    queueCommand,
    createToggleCommand(
        'queue-keep-open',
        'playback',
        'Keep queue palette open',
        'Toggle keeping the command palette open after choosing a queue song',
        ['stay open', 'keep queue open', '切歌不关闭', '队列保持打开'],
        context => context.playback.setQueuePaletteKeepOpen(!context.playback.queuePaletteKeepOpen),
    ),
    volumeCommand,
    fmModeCommand,
    ...heartbeatCommands,
    createReplayGainCommand('off', 'Disable ReplayGain', 'Play audio without ReplayGain adjustment', ['replaygain off', 'audio gain off', '关闭音频增益', '关闭 replaygain', 'gbyyzy']),
    createReplayGainCommand('track', 'ReplayGain: Track mode', 'Apply per-track ReplayGain adjustment', ['replaygain track', 'track gain', 'single track gain', '单曲增益', '单曲 replaygain']),
    createReplayGainCommand('album', 'ReplayGain: Album mode', 'Apply album ReplayGain adjustment', ['replaygain album', 'album gain', '专辑增益', '专辑 replaygain']),
    {
        id: 'playback-equalizer',
        // It opens the controls panel tab to reach the equalizer, so it needs the player surface.
        scope: 'player-surface',
        executeShortcut: 'e',
        group: 'playback',
        title: 'Audio effects',
        description: 'Open the equalizer and effect chain',
        keywords: ['equalizer', 'audio equalizer', 'eq', '10 band eq', 'effect chain', '均衡器', '音频均衡器', '十段均衡器', '音效', '效果器', 'jhh', 'ypjhh'],
        execute: (_input, context) => {
            context.panel.setPanelTab('controls');
            context.panel.setIsPanelOpen(true);
            context.playback.openAudioEqualizer();
            return true;
        },
    },
    createSoundPresetCommand('flat', 'Sound: Level', 'Clear the equalizer and every effect', ['flat', 'reset audio effects', '水平', '关闭音效']),
    createSoundPresetCommand('lofi', 'Sound: Lo-Fi', 'Filtered, crushed and wobbly with vinyl noise', ['lofi', 'lo-fi', 'low fidelity', '低保真']),
    createSoundPresetCommand('radio', 'Sound: Radio', 'Narrow band, nearly mono broadcast tone', ['radio', 'am radio', 'telephone', '收音机', '广播']),
    createSoundPresetCommand('hall', 'Sound: Hall', 'Wide stereo image with reverb space', ['hall', 'reverb', 'space', '大厅', '混响', '空间', 'daating']),
    createSoundPresetCommand('vocal', 'Sound: Vocal', 'Lift the voice range and tighten dynamics', ['vocal', 'voice', '人声']),
    createSoundPresetCommand('bass', 'Sound: Bass boost', 'Heavier low end with extra punch', ['bass boost', 'bass', '低音增强', '重低音']),
    createSoundPresetCommand('custom1', 'Sound: Custom 1', 'Apply the first saved custom sound', ['custom 1', 'custom sound 1', '自定义 1', '自定义音效1', 'zidingyi1', 'zdy1']),
    createSoundPresetCommand('custom2', 'Sound: Custom 2', 'Apply the second saved custom sound', ['custom 2', 'custom sound 2', '自定义 2', '自定义音效2', 'zidingyi2', 'zdy2']),
    {
        id: 'playback-play',
        group: 'playback',
        title: 'Play',
        description: 'Start playback when paused',
        keywords: ['播放'],
        icon: Play,
        execute: (_input, context) => {
            if (context.shared.playerState !== PlayerState.PLAYING) {
                context.playback.togglePlay();
            }
            return true;
        },
    },
    {
        id: 'playback-pause',
        group: 'playback',
        title: 'Pause',
        description: 'Pause current playback',
        keywords: ['暂停'],
        icon: Pause,
        execute: (_input, context) => {
            if (context.shared.playerState === PlayerState.PLAYING) {
                context.playback.togglePlay();
            }
            return true;
        },
    },
    createToggleCommand('playback-next', 'playback', 'Next track', 'Play the next track', ['next', '下一首'], context => context.playback.next(), { icon: SkipForward, executeShortcut: 'n' }),
    createToggleCommand('playback-prev', 'playback', 'Previous track', 'Play the previous track', ['prev', 'previous', '上一首'], context => context.playback.prev(), { icon: SkipBack, executeShortcut: 'b' }),
    createToggleCommand('playback-loop', 'playback', 'Toggle loop', 'Change loop mode', ['loop', '循环'], context => context.playback.toggleLoop(), { icon: Repeat, executeShortcut: 'l' }),
    createToggleCommand(
        'playback-like',
        'playback',
        'Like current song',
        'Add the current song to your favourites, or take it back out',
        ['like', 'unlike', 'favourite', 'favorite', 'star', '喜欢', '收藏', '取消收藏'],
        context => { void context.playback.toggleSongLike(); },
        {
            icon: Heart,
            // Whether it likes or unlikes is the one thing the static title cannot say.
            isAvailable: context => (context ? Boolean(context.shared.currentSong) : true),
        },
    ),
    createToggleCommand(
        'playback-add-to-playlist',
        'playback',
        'Add to a playlist',
        'Put the current song in one of your playlists',
        ['add to playlist', 'playlist', 'collect', '添加到歌单', '收藏到歌单', '加入歌单'],
        context => context.playback.openAddToPlaylist(),
        {
            icon: Star,
            isAvailable: context => (context ? context.playback.canAddCurrentSongToPlaylist : true),
        },
    ),
    createToggleCommand(
        'playback-mute',
        'playback',
        'Mute',
        'Silence playback, or bring the sound back',
        ['unmute', 'silence', '静音', '取消静音'],
        context => context.playback.toggleMute(),
        { icon: VolumeX },
    ),
    createToggleCommand('playback-shuffle', 'playback', 'Shuffle queue', 'Shuffle current play queue', ['shuffle', '打乱', '打乱队列'], context => context.playback.shuffleQueue(), { icon: Shuffle, executeShortcut: 'r', isAvailable: context => !context?.playback.isFmMode }),
    {
        id: 'playback-clear-queue',
        isAvailable: context => (context ? !context.playback.isFmMode && context.playback.queue.length > 0 : true),
        group: 'playback',
        title: 'Clear queue',
        description: 'Remove all songs from the current play queue',
        keywords: ['empty queue', 'clear playlist', 'remove all songs', '清空队列', '清空播放队列', '清除队列'],
        icon: ListX,
        execute: (_input, context) => {
            if (context.playback.queue.length === 0) {
                return false;
            }
            context.playback.clearQueue();
            return true;
        },
    },
    {
        id: 'playback-auto-match-best-lyric',
        executeShortcut: 'a',
        group: 'playback',
        title: 'Match best lyrics',
        description: 'Run automatic best lyric matching for the current song',
        keywords: ['best lyrics', 'auto match lyrics', '最佳歌词', '匹配最佳歌词', '自动匹配歌词'],
        execute: (_input, context) => context.playback.runAutoMatchBestLyric(),
    },
    {
        id: 'playback-toggle-pure-music',
        // 只对本地歌曲有意义，与两个歌词匹配窗口里的「标记为纯音乐」是同一个开关。
        isAvailable: context => (context ? context.playback.canToggleCurrentSongPureMusicMark : true),
        group: 'playback',
        title: 'Mark or unmark as instrumental',
        description: 'Mark the current local song as instrumental so its lyrics are no longer matched automatically; run again to unmark',
        keywords: ['instrumental', 'pure music', 'no lyrics', '纯音乐', '标记纯音乐', '取消纯音乐', '无歌词'],
        icon: Piano,
        execute: (_input, context) => context.playback.toggleCurrentSongPureMusicMark(),
    }
];
