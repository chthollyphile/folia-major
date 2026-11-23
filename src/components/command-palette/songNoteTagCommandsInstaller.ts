import { Hash } from 'lucide-react';
import i18n from '../../i18n/config';
import { countSongNoteTags, listSongNoteTags, subscribeSongNotes } from '../song-notes/songNotesService';
import { openSongNoteTag } from '../song-notes/songNoteNavigation';
import type { SongNoteTag } from '../song-notes/songNotesModel';
import { defineCommand } from './commandFactories';
import { setSongNoteTagCommands } from './commandRegistry';
import type { CommandPaletteCommand } from './types';

// src/components/command-palette/songNoteTagCommandsInstaller.ts
// 命令 #标签（plan/music-notes-integration-plan.md「命令」）：每个标签一条命令，标题就是「#标签」，在命令面板里打 #夜车 就找得到；
// 执行打开速记簿「时刻」展开整页，滚到那一组。标签变了（打上、改名、删掉，本窗口或别的窗口）、换了界面语言时整批换一遍。
// 标签是用户写的字，标题不当翻译键（textSource: 'runtime'）。

let installed = false;
let sequence = 0;

/**
 * 命令 id：标签的 key 是用户写的字，不直接拼进 id（i18n 键里的点、冒号会被当成分隔符），拼它的散列。按 key 算，
 * 标签换了先后 id 不变（命令的使用频次、最近用过跟着标签走）；改了名就是另一条命令。
 */
export const songNoteTagCommandId = (tagKey: string) => {
    let hash = 5381;
    for (const char of tagKey) hash = ((hash * 33) ^ (char.codePointAt(0) ?? 0)) >>> 0;
    return `song-notes-tag-${hash.toString(36)}`;
};

/** 这些标签的命令（导出给单测）。counts：每个标签下几首。 */
export const buildSongNoteTagCommands = (tags: readonly SongNoteTag[], counts: ReadonlyMap<string, number>): CommandPaletteCommand[] => {
    // 两个标签散列撞了（极少）：后一个加个后缀，命令表里 id 不能重。
    const taken = new Set<string>();
    return tags.flatMap(tag => {
        const count = counts.get(tag.key) ?? 0;
        if (count === 0) return [];
        let id = songNoteTagCommandId(tag.key);
        while (taken.has(id)) id = `${id}-x`;
        taken.add(id);
        return [defineCommand({
            id,
            group: 'panel',
            title: `#${tag.name}`,
            description: i18n.t('songNotes.tagCommandDescription', { count }),
            textSource: 'runtime',
            keywords: [`#${tag.name}`, tag.name, tag.key, 'tag', '标签'],
            icon: Hash,
            execute: () => {
                openSongNoteTag(tag.key);
                return true;
            },
        })];
    });
};

const install = async () => {
    const mine = (sequence += 1);
    const [tags, counts] = await Promise.all([listSongNoteTags(), countSongNoteTags()]);
    // 读的途中又变了：让后一次装。
    if (mine !== sequence) return;
    setSongNoteTagCommands(buildSongNoteTagCommands(tags, counts));
};

/** 装上 #标签 命令，并跟着标签的变化、界面语言换。只在主窗口装一次。 */
export const installSongNoteTagCommands = (): void => {
    if (installed) return;
    installed = true;
    // 第一次等空闲时再读库，不和启动抢。
    const first = () => void install();
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(first, { timeout: 4000 });
    else window.setTimeout(first, 1500);
    subscribeSongNotes(() => {
        void install();
    });
    i18n.on('languageChanged', () => {
        void install();
    });
};
