import { describe, expect, it } from 'vitest';
import { SentenceLayout } from '@/utils/lyrics/sentenceLayout';

// test/unit/lyrics/sentenceLayout.test.ts
// Verifies sentence-level layout splitting with multi-level segmentation logic.

describe('SentenceLayout', () => {
    const testStr1 = '歌：はな　作曲／編曲：松本文紀　ミックス：Kensei Ogata　歌詞：すかぢ';
    const testStr2 = '你好，世界！！！这是一个测试/Hello World, that\'s a test: test-it.';
    it('returns single unit when targetCount is 0 or 1', () => {
        const result = SentenceLayout.splitIntoSentences(testStr1, 0);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe(testStr1);

        const result2 = SentenceLayout.splitIntoSentences(testStr1, 1);
        expect(result2).toHaveLength(1);
        expect(result2[0].text).toBe(testStr1);
    });

    it('splits by punctuation at level 1 (targetCount = -1)', () => {
        const result = SentenceLayout.splitIntoSentences(testStr2, -1);
        
        expect(result.length).toBeGreaterThan(1);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(testStr2);

        expect(texts.some(t => t === '你好，')).toBe(true);
        expect(texts.some(t => t === '世界！！！')).toBe(true);
        expect(texts.some(t => t === '这是一个测试/Hello World, ')).toBe(true);
        expect(texts.some(t => t === "that's a test: test-it.")).toBe(true);
    });


    it('splits Western at level 2-1 (targetCount = -2)', () => {
        const text = '『Ⅲ A Nice Derangement of Epitaphs 』エンディングテーマ';
        const result = SentenceLayout.splitIntoSentences(text, -2);
        
        expect(result.length).toBe(2);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t === '『Ⅲ A Nice Derangement of Epitaphs 』')).toBe(true);
        expect(texts.some(t => t === 'エンディングテーマ')).toBe(true);
    });

    
    it('extracts bracket content at level 2-2 (targetCount = -2)', () => {
        const text = '这是(括号内容)测试【书名号】文本';
        const result = SentenceLayout.splitIntoSentences(text, -2);
        expect(result.length).toBeGreaterThan(1);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t === '(括号内容)')).toBe(true);
        expect(texts.some(t => t === '【书名号】')).toBe(true);
    });
    
    it('splits Western at level 3-1 (targetCount = -3)', () => {
        const text = '『Ⅲ A Nice Derangement of Epitaphs 』エンディングテーマ';
        const result = SentenceLayout.splitIntoSentences(text, -3);
        
        expect(result.length).toBe(2);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t === '『Ⅲ A Nice Derangement of Epitaphs 』')).toBe(true);
        expect(texts.some(t => t === 'エンディングテーマ')).toBe(true);
    });


    it('splits by level 2 (targetCount = 2)', () => {
        const text = '『Ⅲ A Nice Derangement of Epitaphs 』エンディングテーマ';
        const result = SentenceLayout.splitIntoSentences(text, 2);
        
        expect(result.length).toBe(2);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t === '『Ⅲ A Nice Derangement of Epitaphs 』')).toBe(true);
        expect(texts.some(t => t === 'エンディングテーマ')).toBe(true);
    });
    it('splits CJK by space (targetCount = 2)', () => {
        const text = '作曲 : 阿璞';
        const result = SentenceLayout.splitIntoSentences(text, 2);
        
        expect(result.length).toBe(2);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t === '作曲 : ')).toBe(true);
        expect(texts.some(t => t === '阿璞')).toBe(true);
    });

    it('splits Western and CJK mixed text at level 3-2 (targetCount = -3)', () => {
        const result = SentenceLayout.splitIntoSentences(testStr2, -3);
        
        expect(result.length).toBeGreaterThan(1);
        
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(testStr2);
        
        expect(texts.some(t => t === '你好，')).toBe(true);
        expect(texts.some(t => t === '世界！！！')).toBe(true);
        expect(texts.some(t => t === '这是一个测试/')).toBe(true);
        expect(texts.some(t => t === 'Hello World, ')).toBe(true);
        expect(texts.some(t => t === "that's a test: test-it.")).toBe(true);
    });

    it('splits Western and CJK mixed text at level 3-3 (targetCount = -3)', () => {
        const text = 'Hello World 世界 Test 文本';
        const result = SentenceLayout.splitIntoSentences(text, -3);
        
        expect(result.length).toBeGreaterThan(1);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        
        expect(texts.some(t => t.match(/[a-zA-Z]+/))).toBe(true);
        expect(texts.some(t => t === '世界 Test 文本')).toBe(true);
    });

    it('splits CJK boundaries at level 3-4 (targetCount = -3)', () => {
        const result = SentenceLayout.splitIntoSentences(testStr1, -3);
        //   包含冒号>=2，所以 Level 3 在 西文字符的前方不分割，后方分割
        expect(result.length).toBe(2);
        const texts = result.map(r => r.text);
        expect(texts.some(t => t.includes('ミックス：Kensei Ogata'))).toBe(true);
        expect(texts.join('')).toBe(testStr1);
    });

    it('splits CJK boundaries at level 4 (targetCount = -4)', () => {
        const result = SentenceLayout.splitIntoSentences(testStr1, -4);
//   '歌：はな　作曲／編曲：松本文紀　ミックス：Kensei Ogata　歌詞：すかぢ';
      
        expect(result.length).toBeGreaterThanOrEqual(3);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(testStr1);
        expect(texts.some(t => t === '歌：はな　')).toBe(true);
        expect(texts.some(t => t === '作曲／編曲：松本文紀　')).toBe(true);
        expect(texts.some(t => t === 'ミックス：Kensei Ogata　')).toBe(true);
        expect(texts.some(t => t === '歌詞：すかぢ')).toBe(true);
    });

    it('splits by special characters at level 5 (targetCount = -5)', () => {
        const result = SentenceLayout.splitIntoSentences(testStr1, -5);
        expect(result.length).toBe(9);
        const texts = result.map(r => r.text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(testStr1);
    });
    
    it('performs secondary split when count is insufficient', () => {
        const text = '这是一个相对较长的测试字符串用于验证二次分割功能是否正常工作';
        const targetCount = 8;
        const result = SentenceLayout.splitIntoSentences(text, targetCount);
        
        expect(result.length).toBe(targetCount);
        expect(result.every(r => r.text.length > 0)).toBe(true);
    });

    it('merges sentences when count exceeds target', () => {
        const text = '第一，第二，第三，第四，第五，第六，第七，第八，第九，第十';
        const targetCount = 3;
        const result = SentenceLayout.splitIntoSentences(text, targetCount);
        
        expect(result.length).toBe(targetCount);
        expect(result.reduce((sum, r) => sum + r.text.length, 0)).toBe(text.length);

    });

    it('handles empty string input', () => {
        const result = SentenceLayout.splitIntoSentences('', 5);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('');
    });

    it('handles pure Western text without CJK splitting at level 2', () => {
        const text = 'HelloWorldTest';
        const result = SentenceLayout.splitIntoSentences(text, -2);
        
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe(text);

    });

    it('correctly splits hyphenated Western words as single units', () => {
        const text = '测试state-of-the-art技术';
        const result = SentenceLayout.splitIntoSentences(text, -2);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe(text);
    });

    it('preserves all characters during split - no character loss', () => {
        const testCases = [
            { text: '歌：はな　作曲／編曲：松本文紀　ミックス：Kensei Ogata　歌詞：すかぢ', targets: [-1, 8] },
            { text: 'Hello 世界！This is a test。', targets: [-1, -2, 5] },
            { text: '第一，第二；第三：第四｜第五～第六', targets: [-1, -5, 4] },
            { text: '测试(括号)内容【书名号】"引号"文本', targets: [-1, -3, 6] },
            { text: '空格 测试\t制表符\n换行', targets: [-1, 3] },
            { text: 'Mixed中英文123数字', targets: [-2, -4, 4] },
            { text: '...省略号！！！多个标点？？？', targets: [-1, 5] },
        ];

        for (const { text, targets } of testCases) {
            for (const targetCount of targets) {
                const result = SentenceLayout.splitIntoSentences(text, targetCount);
                const reconstructed = result.map(r => r.text).join('');
                expect(reconstructed.length).toBe(text.length);
                expect(reconstructed).toBe(text);
            }
        }
    });

    it('handles whitespace preservation correctly', () => {
        const text = '  前置空格  中间  多个   空格  ';
        const result = SentenceLayout.splitIntoSentences(text, -4);

        const texts = result.map(r => r.text);

        expect(texts.join('')).toBe(text);
        const reconstructed = texts.join('');
        expect(reconstructed).toBe(text);
        expect(texts.slice(1).every(t => !/^\s/.test(t))).toBe(true);
    });
});
