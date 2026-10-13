import { describe, expect, it } from 'vitest';
import { normalizeCommentText } from '@/services/onlineMusic/commentText';

// test/unit/onlineMusic/commentText.test.ts
// 评论正文清洗的判据全来自实测残留（2026-10-08 晴天/酷狗样本）：字面量 \n、\/ 的双重转义
// 会原样显示成 "/加n"；QQ 表情是 [em]eXXXXXX[/em] 标记。真 emoji 与 [图片] 占位必须原样保留。

describe('normalizeCommentText', () => {
    it('turns literal backslash escapes back into real characters', () => {
        // 上游 JSON 双重转义的残留：正文里是字面的 反斜杠+n / 反斜杠+/
        expect(normalizeCommentText('第一行\\n第二行')).toBe('第一行\n第二行');
        expect(normalizeCommentText('歌名\\/人名')).toBe('歌名/人名');
        expect(normalizeCommentText('他说\\"挺好\\"')).toBe('他说"挺好"');
    });

    it('strips QQ [em] face markers but keeps real emoji and image placeholders', () => {
        expect(normalizeCommentText('太好听了[em]e401328[/em][em]e401328[/em]')).toBe('太好听了');
        expect(normalizeCommentText('青春🎵[图片]')).toBe('青春🎵[图片]');
    });

    it('returns empty for nullish or marker-only content', () => {
        expect(normalizeCommentText(undefined)).toBe('');
        expect(normalizeCommentText('[em]e400834[/em]')).toBe('');
    });

    it('leaves ordinary prose untouched (only trims)', () => {
        expect(normalizeCommentText('  从前从前，有个人爱你很久  ')).toBe('从前从前，有个人爱你很久');
    });
});
