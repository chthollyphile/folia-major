import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DIR, buildCover, writeSong } from '../song.mjs';
import { APP_BUILD_DIR } from './launch.mjs';

// dev/perf/app/fixtures.mjs
// The music folders the measured app imports: invented songs only, made from the rig's test song
// (dev/perf/song.mjs). Every file is computed; two runs write the same bytes.
//
//   <library>/Perf Library/                     the folder every run imports
//       Measured Nights/                        6 albums of 4 songs
//           01 Paper Lanterns.wav               96 s (the test song's audio); its tag holds the
//                                               title, artist, album, track number and a cover of
//                                               its own (512 x 512 PNG), as most real files do
//           01 Paper Lanterns.lrc               word-timed lyrics (enhanced LRC)
//           01 Paper Lanterns.t.lrc             their translation
//       ...
//   <library>/Perf Sketches/                    a second folder, imported as well for the memory runs
//       Sketchbook 01/ ... Sketchbook 30/       30 albums of 10 tracks of 2 s each, 300 in all,
//                                               each album with a cover.png in its folder
//
// The tags are ID3v2.4 with UTF-8 text, so the Chinese titles survive. Songs that follow each
// other in an album have different lyrics (the test song's two sets). Every song's lyrics begin
// with one word of its own, sung from 0.2 s to 1.2 s: the app shows a line about two seconds
// before it starts, so without it "the new song's words are on screen" would time the song (whose
// first line starts at 6 s) and not the app. The word also tells which song's words are shown.

export const LIBRARY_DIR = path.join(APP_BUILD_DIR, 'library');
/** Goes up when the files change, so that profiles prepared from the earlier files are made again. */
export const FIXTURE_VERSION = 2;
/** When every song's own first word is due, in seconds of the song: `toLrc` below writes its stamp from this. */
export const FIRST_WORD_AT_SECONDS = 0.2;

/** One for every song, in the order of the albums below: the first word of its lyrics. */
const FIRST_WORDS = ['Alba', 'Brine', 'Cinder', 'Dapple', 'Ember', 'Fathom', 'Gossamer', 'Harrow', 'Inkwell', 'Juniper', 'Kestrel', 'Lantern',
    'Marrow', 'Nettle', 'Orrery', 'Pewter', 'Quill', 'Russet', 'Sorrel', 'Tallow', 'Umber', 'Vesper', 'Willow', 'Yarrow'];

/** [album, artist, year, the three colours of its covers, its four songs] */
const ALBUMS = [
    ['Measured Nights', 'Folia Perf Rig', 2021, [[24, 60, 140], [230, 120, 60], [250, 220, 120]], ['Paper Lanterns', '清晨的站台', 'Second Window', '雨后的街']],
    ['Glass Harbour', 'Tin Lighthouse', 2019, [[30, 110, 90], [150, 60, 150], [240, 240, 250]], ['Low Tide Signal', '玻璃港', 'Rope and Salt', '灯塔以北']],
    ['Slow Machines', 'Aki Voss', 2023, [[120, 30, 50], [240, 190, 80], [255, 240, 220]], ['Idle Gear', '慢机器', 'Counterweight', '发条鸟']],
    ['纸飞机', '南岸电台', 2020, [[40, 40, 110], [90, 200, 220], [250, 250, 200]], ['纸飞机', 'Fold Along The Line', '顺风', 'Landing On Tuesday']],
    ['Orchard Static', 'Mira Halloway', 2018, [[60, 100, 30], [220, 210, 90], [250, 120, 90]], ['Windfall', '果园里的杂音', 'Ladder Song', '九月的收音机']],
    ['Night Bus Home', 'The Quiet Fares', 2024, [[15, 20, 45], [200, 80, 120], [255, 210, 150]], ['Last Stop First', '夜班车', 'Window Seat', '终点站']],
];

const SKETCH_ALBUMS = 30;
const SKETCH_TRACKS = 10;
const SKETCH_SECONDS = 2;

const two = value => String(value).padStart(2, '0');
const stamp = (seconds) => {
    const hundredths = Math.round(seconds * 100);
    return `${two(Math.floor(hundredths / 6000))}:${two(Math.floor(hundredths / 100) % 60)}.${two(hundredths % 100)}`;
};

/** Enhanced LRC: a line's start in brackets, then every word behind the time it starts at. */
const toLrc = (lines, firstWord) => `[${stamp(FIRST_WORD_AT_SECONDS)}]<${stamp(FIRST_WORD_AT_SECONDS)}>${firstWord}<${stamp(FIRST_WORD_AT_SECONDS + 1)}>\n${lines.map(line => `[${stamp(line.startTime)}]${line.words.map(word => `<${stamp(word.startTime)}>${word.text}`).join('')}<${stamp(line.endTime)}>`).join('\n')}\n`;
const toTranslationLrc = lines => `${lines.filter(line => line.translation).map(line => `[${stamp(line.startTime)}]${line.translation}`).join('\n')}\n`;

const syncSafe = (value) => {
    const bytes = Buffer.alloc(4);
    bytes[0] = (value >> 21) & 0x7f;
    bytes[1] = (value >> 14) & 0x7f;
    bytes[2] = (value >> 7) & 0x7f;
    bytes[3] = value & 0x7f;
    return bytes;
};

const id3Frame = (id, body) => Buffer.concat([Buffer.from(id, 'latin1'), syncSafe(body.length), Buffer.from([0, 0]), body]);

/** An ID3v2.4 tag: UTF-8 text frames and, with `cover`, a front-cover picture (PNG). */
const id3Tag = (fields, cover = null) => {
    const frames = Object.entries(fields).map(([id, text]) => id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(String(text), 'utf8')])));
    if (cover) {
        // Text encoding 0, the MIME type, picture type 3 (front cover), an empty description, the picture.
        frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), cover])));
    }
    const body = Buffer.concat(frames);
    return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0]), syncSafe(body.length), body]);
};

const riffChunk = (id, body) => {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
};

/** A WAV file: the format of the test song, some of its samples, and a tag. */
const wavFile = (format, samples, tag) => {
    const chunks = Buffer.concat([riffChunk('fmt ', format), riffChunk('id3 ', tag), riffChunk('data', samples)]);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(chunks.length + 4, 4);
    header.write('WAVE', 8, 'latin1');
    return Buffer.concat([header, chunks]);
};

const writeIfChanged = (file, bytes) => {
    if (fs.existsSync(file) && fs.statSync(file).size === bytes.length && fs.readFileSync(file).equals(bytes)) {
        return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
};

/**
 * Writes the two folders (a file that is there with the same bytes is left alone, so its date stays
 * and the app sees an unchanged folder) and returns what is in them.
 */
export const writeLibrary = () => {
    writeSong({ onlyIfMissing: true });
    const song = fs.readFileSync(path.join(PUBLIC_DIR, 'song.wav'));
    const lyrics = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'lyrics.json'), 'utf8'));
    // song.mjs writes a 44-byte header: 'fmt ' is 16 bytes at 20, the samples start at 44.
    const format = song.subarray(20, 36);
    const samples = song.subarray(44);
    const bytesPerSecond = format.readUInt32LE(8);
    const sketchSamples = samples.subarray(40 * bytesPerSecond, (40 + SKETCH_SECONDS) * bytesPerSecond);
    const sets = { a: lyrics.songs.a.lines, b: lyrics.songs.b.lines };

    const albums = ALBUMS.map(([album, artist, year, colours, titles], albumIndex) => ({
        album,
        artist,
        year,
        folder: album,
        tracks: titles.map((title, index) => ({
            title,
            number: index + 1,
            file: `${two(index + 1)} ${title}.wav`,
            seconds: lyrics.durationSeconds,
            lyricSet: (albumIndex + index) % 2 === 0 ? 'a' : 'b',
            firstWord: FIRST_WORDS[albumIndex * titles.length + index],
            cover: buildCover(101 + albumIndex * 7 + index * 31, colours),
        })),
    }));
    const sketches = Array.from({ length: SKETCH_ALBUMS }, (_, albumIndex) => ({
        album: `Sketchbook ${two(albumIndex + 1)}`,
        artist: `Perf Sketches ${1 + (albumIndex % 6)}`,
        year: 2000 + (albumIndex % 24),
        folder: `Sketchbook ${two(albumIndex + 1)}`,
        folderCover: buildCover(1000 + albumIndex * 3, [
            [(albumIndex * 37) % 200, (albumIndex * 71) % 180, 60 + ((albumIndex * 23) % 160)],
            [200 - ((albumIndex * 29) % 150), 90 + ((albumIndex * 53) % 150), (albumIndex * 97) % 220],
            [250, 250 - ((albumIndex * 13) % 90), 200 - ((albumIndex * 41) % 120)],
        ]),
        tracks: Array.from({ length: SKETCH_TRACKS }, (_, index) => {
            const title = `Sketch ${String(albumIndex * SKETCH_TRACKS + index + 1).padStart(3, '0')}`;
            return { title, number: index + 1, file: `${two(index + 1)} ${title}.wav`, seconds: SKETCH_SECONDS, lyricSet: null, cover: null };
        }),
    }));

    const writeAlbum = (root, entry) => {
        const folder = path.join(root, entry.folder);
        if (entry.folderCover) {
            writeIfChanged(path.join(folder, 'cover.png'), entry.folderCover);
        }
        entry.tracks.forEach((track) => {
            const tag = id3Tag({ TIT2: track.title, TPE1: entry.artist, TALB: entry.album, TRCK: `${track.number}/${entry.tracks.length}`, TDRC: entry.year }, track.cover);
            const base = path.join(folder, track.file.replace(/\.wav$/, ''));
            writeIfChanged(`${base}.wav`, wavFile(format, track.lyricSet ? samples : sketchSamples, tag));
            if (track.lyricSet) {
                writeIfChanged(`${base}.lrc`, Buffer.from(toLrc(sets[track.lyricSet], track.firstWord), 'utf8'));
                writeIfChanged(`${base}.t.lrc`, Buffer.from(toTranslationLrc(sets[track.lyricSet]), 'utf8'));
            } else {
                writeIfChanged(`${base}.lrc`, Buffer.from(`[00:00.10]${track.title}\n[00:01.00]two seconds of the test song\n`, 'utf8'));
            }
        });
    };
    const songsFolder = path.join(LIBRARY_DIR, 'Perf Library');
    const sketchesFolder = path.join(LIBRARY_DIR, 'Perf Sketches');
    // A cover.png left from an earlier layout of this folder would take the place of the songs' own covers.
    albums.forEach(entry => fs.rmSync(path.join(songsFolder, entry.folder, 'cover.png'), { force: true }));
    albums.forEach(entry => writeAlbum(songsFolder, entry));
    sketches.forEach(entry => writeAlbum(sketchesFolder, entry));

    const describe = (folder, list) => ({
        folder,
        name: path.basename(folder),
        albums: list.map(entry => ({
            album: entry.album,
            artist: entry.artist,
            folder: entry.folder,
            tracks: entry.tracks.map(({ cover: _cover, ...track }) => track),
        })),
        tracks: list.reduce((sum, entry) => sum + entry.tracks.length, 0),
    });
    return {
        songs: describe(songsFolder, albums),
        sketches: describe(sketchesFolder, sketches),
    };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const library = writeLibrary();
    console.log(`[perf] library written to ${LIBRARY_DIR}: ${library.songs.tracks} songs in ${library.songs.albums.length} albums, and ${library.sketches.tracks} short tracks in ${library.sketches.albums.length} albums`);
}
