import type { Word } from '../../src/types';

// test/manual/kugou_test.ts
// Hack to force requestKugou to make direct URLs instead of relative proxy URLs
(globalThis as any).window = { electron: true };

async function main() {
  const { searchKugouLyrics, fetchKugouLyrics } = await import('../../src/utils/lyrics/providers/kugouLyricProvider');

  const keyword = '米津玄师 Lemon';
  console.log(`Searching Kugou for "${keyword}"...`);
  const songs = await searchKugouLyrics(keyword);
  if (songs.length === 0) {
    console.log('No songs found.');
    return;
  }

  const song = songs[0];
  console.log(`Found song: ${song.name} - ${song.artists.map(a => a.name).join(', ')} (Hash: ${song.kgHash})`);

  console.log('Fetching and decrypting lyrics...');
  const result = await fetchKugouLyrics(song);
  console.log('Finished fetching lyric. Result parsed lines count:', result?.lines?.length || 0);

  if (result && result.lines && result.lines.length > 0) {
    console.log('\n--- FIRST 5 LYRIC LINES WITH TIMINGS & TRANSLATION ---');
    for (let i = 0; i < Math.min(5, result.lines.length); i++) {
      const line = result.lines[i];
      console.log(`Line ${i}: [${line.startTime.toFixed(3)} --> ${line.endTime.toFixed(3)}]`);
      console.log(`  Original:    "${line.fullText}"`);
      if (line.translation) {
        console.log(`  Translation: "${line.translation}"`);
      } else {
        console.log('  Translation: (none)');
      }
      console.log('  Words:');
      line.words.forEach((w: Word, wIdx: number) => {
        console.log(`    Word ${wIdx}: "${w.text}" [${w.startTime.toFixed(3)} --> ${w.endTime.toFixed(3)}]`);
      });
    }
  }
}

main().catch(console.error);
