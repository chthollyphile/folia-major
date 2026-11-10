import { expect, test } from './fixtures';

// test/component/samePicture.spec.ts
// Whether two pictures look the same (src/library/suites/grid/transitions/samePicture.ts), put to
// real pictures: the screenshots and covers the repository has. Each stands for one artwork, and
// is made into the files a provider serves of one artwork: several sizes, formats and qualities.
//
// Why in a browser: the reading of a picture is the browser's (decoding, scaling, a canvas), and
// what has to hold is that the files of one artwork come out alike and two artworks do not.

const ARTWORKS = [
    '/assets/placeholder_cover.jpg', '/assets/placeholder_cover-2.jpg', '/img/preview-cappella.jpg', '/img/preview-diorama.png',
    '/img/preview-fume.png', '/img/preview-lumi.png', '/img/preview-pat.png', '/img/preview-pendolo.png', '/img/preview-tilt.png',
    '/img/visualizer.png', '/mods/k3panel/preview.jpg', '/mods/more-progress-buttons/preview.jpg', '/mods/sample-aurora-visualizer/preview.jpg',
    '/mods/sample-progress-bar/preview.jpg', '/mods/sample-rickroll/preview.jpg', '/mods/visualizer52hz/preview.jpg',
];

type Hooks = { __picturesLookAlike: (first: string, second: string) => Promise<boolean> };

test('the files of one artwork look the same, and two artworks do not', async ({ mount, page }) => {
    await mount('gridEntrancePerf');
    const seen = await page.evaluate(async (artworks) => {
        const picturesLookAlike = (window as unknown as Hooks).__picturesLookAlike;
        // One artwork as a provider serves it: its middle square at a size, in a format, at a quality.
        const filesOf = async (url: string) => {
            const picture = new Image();
            picture.src = url;
            await picture.decode();
            const square = Math.min(picture.naturalWidth, picture.naturalHeight);
            const file = (size: number, type: string, quality: number) => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext('2d')!;
                context.imageSmoothingQuality = 'high';
                context.drawImage(picture, (picture.naturalWidth - square) / 2, (picture.naturalHeight - square) / 2, square, square, 0, 0, size, size);
                return canvas.toDataURL(type, quality);
            };
            return [file(544, 'image/jpeg', 0.92), file(226, 'image/jpeg', 0.7), file(120, 'image/jpeg', 0.5), file(300, 'image/webp', 0.75), file(60, 'image/jpeg', 0.6)];
        };
        const files: string[][] = [];
        for (const artwork of artworks) files.push(await filesOf(artwork));

        const unlikeFilesOfOne: string[] = [];
        const alikeArtworks: string[] = [];
        let pairsOfOne = 0;
        let pairsOfTwo = 0;
        for (let artwork = 0; artwork < files.length; artwork += 1) {
            for (let left = 0; left < files[artwork].length; left += 1) {
                for (let right = left + 1; right < files[artwork].length; right += 1) {
                    pairsOfOne += 1;
                    if (!await picturesLookAlike(files[artwork][left], files[artwork][right])) unlikeFilesOfOne.push(`${artworks[artwork]} files ${left} and ${right}`);
                }
            }
            for (let other = artwork + 1; other < files.length; other += 1) {
                // A large file of one against a small file of the other: what a card and a stand-in show.
                pairsOfTwo += 1;
                if (await picturesLookAlike(files[artwork][0], files[other][2])) alikeArtworks.push(`${artworks[artwork]} and ${artworks[other]}`);
            }
        }
        return {
            pairsOfOne, pairsOfTwo, unlikeFilesOfOne, alikeArtworks,
            // '/img/preview-fume.png', nearly twice as wide as it is high.
            whole: await picturesLookAlike(artworks[4], files[4][1]),
            squashed: await picturesLookAlike(files[4][0], await (async () => {
                const picture = new Image();
                picture.src = artworks[4];
                await picture.decode();
                const canvas = document.createElement('canvas');
                canvas.width = 226;
                canvas.height = 226;
                canvas.getContext('2d')!.drawImage(picture, 0, 0, 226, 226);
                return canvas.toDataURL('image/jpeg', 0.7);
            })()),
            missing: await picturesLookAlike(files[0][0], '/__no_such_picture__.jpg'),
        };
    }, ARTWORKS);

    expect(seen.pairsOfOne).toBe(160);
    expect(seen.pairsOfTwo).toBe(120);
    expect(seen.unlikeFilesOfOne).toEqual([]);
    expect(seen.alikeArtworks).toEqual([]);
    // A picture that is not square is compared by its middle square, as a card shows it: the
    // whole wide picture is the square file cut from its middle, and not the whole of it squashed
    // into a square.
    expect(seen.whole).toBe(true);
    expect(seen.squashed).toBe(false);
    // A picture that does not load looks like no other.
    expect(seen.missing).toBe(false);
});
