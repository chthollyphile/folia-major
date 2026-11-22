import { describe, expect, it } from 'vitest';
import { abbreviateSeamTabLabel, abbreviateSeamTabLabels } from '@/library/suites/bravais/bravaisSeamTabLabels';

// test/unit/library/bravais/bravaisSeamTabLabels.test.ts
// fb2：首页窄缝页签放不下全名时的「一个字」短形——从已翻译的全名推，三份 locale 的页签都分得开。

describe('abbreviateSeamTabLabels', () => {
    it('takes the first character of each Chinese tab', () => {
        expect(abbreviateSeamTabLabels(['歌单', '电台', '专辑', '本地', 'Navi'])).toEqual(['歌', '电', '专', '本', 'N']);
    });

    it('takes an upper-case initial for English and Indonesian tabs', () => {
        expect(abbreviateSeamTabLabels(['Playlists', 'Radio', 'Albums', 'Folder', 'Navi'])).toEqual(['P', 'R', 'A', 'F', 'N']);
        expect(abbreviateSeamTabLabels(['Playlist', 'Radio', 'Album', 'Folder', 'Navi'])).toEqual(['P', 'R', 'A', 'F', 'N']);
        expect(abbreviateSeamTabLabel('  navidrome ')).toBe('N');
    });

    it('keeps graphemes whole and falls back to two of them when initials collide', () => {
        expect(abbreviateSeamTabLabel('👩‍🎤 Stage')).toBe('👩‍🎤');
        expect(abbreviateSeamTabLabels(['Albums', 'Artists', 'Radio'])).toEqual(['Al', 'Ar', 'R']);
        expect(abbreviateSeamTabLabels(['专辑', '专栏'])).toEqual(['专辑', '专栏']);
    });

    it('looks further along when the first letters are the same too, so two tabs never read alike', () => {
        // 首页两级页签的一级：Folia 和英文的「本地」（Folder）前三个字母相同。
        expect(abbreviateSeamTabLabels(['Folia', 'NetEase', 'Folder', 'Navi'])).toEqual(['Fi', 'Ne', 'Fd', 'Na']);
        expect(abbreviateSeamTabLabels(['Folia', 'Probe', 'Folder'])).toEqual(['Fi', 'P', 'Fd']);
        // 一个是另一个的开头：短的那个只剩首字，仍然分得开。
        expect(abbreviateSeamTabLabels(['Fol', 'Folder'])).toEqual(['F', 'Fd']);
        // 全名相同时分不开，各取前两个字。
        expect(abbreviateSeamTabLabels(['Folia', 'Folia'])).toEqual(['Fo', 'Fo']);
    });
});
