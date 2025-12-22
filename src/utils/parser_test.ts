import { parseLRC } from './lrcParser';
import { parseYRC } from './yrcParser';
import { detectChorusLines } from './chorusDetector';

const lrcData = `[00:04.00]Line 1
[00:06.00]Line 2
[00:10.00]Line 3
`;

console.log("--- LRC Test ---");
const parsedLRC = parseLRC(lrcData);
parsedLRC.lines.forEach((l: any) => {
    console.log(`[${l.startTime.toFixed(2)} - ${l.endTime.toFixed(2)}] ${l.fullText}`);
    if (l.fullText === "......") {
        l.words.forEach((w: any) => console.log(`  dot: [${w.startTime.toFixed(2)} - ${w.endTime.toFixed(2)}] ${w.text}`));
    }
});

const yrcData = `[100,2000](100,1000,0)Line (1100,1000,0)1
[10000,2000](10000,1000,0)Line (11000,1000,0)3
`;

console.log("\n--- YRC Test ---");
const parsedYRC = parseYRC(yrcData);
parsedYRC.lines.forEach((l: any) => {
    console.log(`[${l.startTime.toFixed(2)} - ${l.endTime.toFixed(2)}] ${l.fullText}`);
    if (l.fullText === "......") {
        l.words.forEach((w: any) => console.log(`  dot: [${w.startTime.toFixed(2)} - ${w.endTime.toFixed(2)}] ${w.text}`));
    }
});

console.log("\n--- Chorus Detection Test ---");
const chorus = detectChorusLines(lrcData);
console.log("Chorus detected:", Array.from(chorus));
