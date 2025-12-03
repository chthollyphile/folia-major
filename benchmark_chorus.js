
const detectChorusLines = (lrcString) => {
    const lines = lrcString.split('\n');
    const lineCounts = new Map();
    const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;

    lines.forEach(line => {
        const text = line.replace(timeRegex, '').trim();
        if (!text || text.length < 2) return;
        const count = lineCounts.get(text) || 0;
        lineCounts.set(text, count + 1);
    });

    let maxCount = 0;
    lineCounts.forEach(count => {
        if (count > maxCount) maxCount = count;
    });

    const chorusLines = new Set();
    if (maxCount <= 1) return chorusLines;

    lineCounts.forEach((count, text) => {
        if (count === maxCount) {
            chorusLines.add(text);
        }
    });
    return chorusLines;
};

const detectChorusLinesOptimized = (lrcString) => {
    const lines = lrcString.split('\n');
    const lineCounts = new Map();

    lines.forEach(line => {
        const lastBracketIndex = line.lastIndexOf(']');
        let text = "";
        if (lastBracketIndex !== -1) {
            text = line.substring(lastBracketIndex + 1).trim();
        } else {
            text = line.trim();
        }

        if (!text || text.length < 2) return;
        const count = lineCounts.get(text) || 0;
        lineCounts.set(text, count + 1);
    });

    let maxCount = 0;
    lineCounts.forEach(count => {
        if (count > maxCount) maxCount = count;
    });

    const chorusLines = new Set();
    if (maxCount <= 1) return chorusLines;

    lineCounts.forEach((count, text) => {
        if (count === maxCount) {
            chorusLines.add(text);
        }
    });
    return chorusLines;
};

const generateLRC = (linesCount) => {
    let lrc = '';
    for (let i = 0; i < linesCount; i++) {
        const min = Math.floor(i / 60).toString().padStart(2, '0');
        const sec = (i % 60).toString().padStart(2, '0');
        lrc += `[${min}:${sec}.00] Line text number ${i % 10}\n`;
    }
    return lrc;
};

const runBenchmark = () => {
    const lrc = generateLRC(100000); // 50,000 lines
    console.log("Generated LRC with 50,000 lines.");

    const start1 = performance.now();
    detectChorusLines(lrc);
    const end1 = performance.now();
    console.log(`Original Execution time: ${(end1 - start1).toFixed(2)} ms`);

    const start2 = performance.now();
    detectChorusLinesOptimized(lrc);
    const end2 = performance.now();
    console.log(`Optimized Execution time: ${(end2 - start2).toFixed(2)} ms`);
};

runBenchmark();
