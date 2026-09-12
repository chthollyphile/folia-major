import { describe, expect, it } from 'vitest';
import { buildImportedMetadataSnapshot } from '@/utils/localSongMetadata';

// test/unit/utils/localSongMetadata.test.ts
// Covers canonical imported metadata snapshots built from embedded audio tags.

describe('buildImportedMetadataSnapshot', () => {
  it('preserves every artist from repeated embedded artist tags', () => {
    const metadata = buildImportedMetadataSnapshot({
      fileName: '伊藤彩沙,生田輝 - Fly Me to the Star #6.mp3',
      embeddedTitle: 'Fly Me to the Star #6',
      embeddedArtist: '伊藤彩沙',
      embeddedArtists: ['伊藤彩沙', '生田輝'],
      embeddedAlbum: 'ラ レヴュー ド マチネ',
    });

    expect(metadata.artistNames).toEqual(['伊藤彩沙', '生田輝']);
  });

  it('keeps a well-formed embedded ISRC and drops malformed ones', () => {
    expect(buildImportedMetadataSnapshot({ fileName: 'a.mp3', embeddedIsrc: ' us-um7-17-03861 ' }).isrc).toBe('USUM71703861');
    expect(buildImportedMetadataSnapshot({ fileName: 'a.mp3', embeddedIsrc: 'not an isrc' })).not.toHaveProperty('isrc');
    expect(buildImportedMetadataSnapshot({ fileName: 'a.mp3' })).not.toHaveProperty('isrc');
  });

  it('falls back to the singular artist field when no artist array is available', () => {
    const metadata = buildImportedMetadataSnapshot({
      fileName: 'duet.mp3',
      embeddedArtist: '伊藤彩沙; 生田輝',
    });

    expect(metadata.artistNames).toEqual(['伊藤彩沙', '生田輝']);
  });
});
