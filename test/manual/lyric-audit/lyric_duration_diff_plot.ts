import fs from 'node:fs';
import path from 'node:path';

// test/manual/lyric-audit/lyric_duration_diff_plot.ts

type DurationDiffRow = {
    index: number;
    text: string;
    neteaseDur: number;
    qqDur: number;
    diff: number;
    neteaseStart: number;
    qqStart: number;
    startDiff: number;
    neteaseEnd: number;
    qqEnd: number;
    endDiff: number;
};

/**
 * 根据歌词比对报告的 JSON 数据，生成终端 Markdown 差异表格并输出交互式 ECharts HTML 仪表盘。
 * @param songId 歌曲 ID 字符串
 * @param customJsonPath 自定义 JSON 报告路径
 */
export function runPlot(songId: string, customJsonPath?: string) {
    let finalPath = customJsonPath
        ? path.resolve(process.cwd(), customJsonPath)
        : path.resolve(process.cwd(), `test/manual/lyric-audit-output/${songId}.json`);
    let finalSongId = songId;

    if (!fs.existsSync(finalPath)) {
        const fallbackPath = path.resolve(process.cwd(), `test/manual/lyric-audit-output/${songId}.json`);
        if (fs.existsSync(fallbackPath)) {
            finalPath = fallbackPath;
        } else {
            const cliJsonPath = path.resolve(process.cwd(), `test/manual/lyric-audit-output/${songId}-cli.json`);
            if (!fs.existsSync(cliJsonPath)) {
                console.error(`Error: Report file for ${songId} not found.`);
                return;
            }
            finalPath = cliJsonPath;
            finalSongId = `${songId}-cli`;
        }
    }

    const report = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
    const songTitle = report.song.title;
    const matchedLines = report.matchedLines || [];
    const sourceAudits = report.sourceAudits || [];
    const pairwise = report.pairwise || [];
    const durationCalibration = report.durationCalibration || [];

    // Filter lines that have both netease and qq/kugou lyrics
    const commonLines = matchedLines.filter((l: any) => l.netease && l.qq);

    if (commonLines.length === 0) {
        console.log(`No common matched lines found for song ${songId}.`);
        return;
    }

    // Map matched lines details
    const data: DurationDiffRow[] = commonLines.map((l: any, idx: number) => {
        const neteaseDur = l.netease.duration;
        const qqDur = l.qq.duration;
        const diff = qqDur - neteaseDur;
        
        const startDiff = l.qq.startTime - l.netease.startTime;
        const endDiff = l.qq.endTime - l.netease.endTime;

        return {
            index: idx + 1,
            text: l.text,
            neteaseDur,
            qqDur,
            diff: Number(diff.toFixed(3)),
            neteaseStart: l.netease.startTime,
            qqStart: l.qq.startTime,
            startDiff: Number(startDiff.toFixed(3)),
            neteaseEnd: l.netease.endTime,
            qqEnd: l.qq.endTime,
            endDiff: Number(endDiff.toFixed(3)),
        };
    });

    // Generate markdown table and text bar chart for duration difference
    let markdownTable = `### Duration Comparison for: ${songTitle} (ID: ${songId})\n\n`;
    markdownTable += `| # | Line Text | NetEase (s) | QQ (s) | Diff (s) | Chart (Green = QQ longer, Red = NetEase longer) |\n|---|-----------|-------------|--------|----------|-----------------------------------------------|\n`;
    
    for (const item of data) {
        const diffVal = item.diff;
        const absVal = Math.abs(diffVal);
        const barLength = Math.min(20, Math.round(absVal * 15)); // 1 char per ~0.067s, max 20 chars
        const barChars = '█'.repeat(barLength || 1);
        
        let chartCell = '';
        if (diffVal > 0) {
            chartCell = `+${diffVal.toFixed(2)}s | ${barChars}`;
        } else if (diffVal < 0) {
            chartCell = `-${absVal.toFixed(2)}s | ${barChars}`;
        } else {
            chartCell = `0.00s | -`;
        }

        markdownTable += `| ${item.index} | ${item.text} | ${item.neteaseDur.toFixed(2)} | ${item.qqDur.toFixed(2)} | ${diffVal > 0 ? '+' : ''}${diffVal.toFixed(3)} | ${chartCell} |\n`;
    }

    console.log(markdownTable);

    // Generate markdown table for Start/End Time differences
    let markdownTable2 = `### Start/End Time Differences (QQ - NetEase) for: ${songTitle}\n\n`;
    markdownTable2 += `| # | Line Text | NE Start (s) | QQ Start (s) | Start Diff (s) | NE End (s) | QQ End (s) | End Diff (s) |\n|---|-----------|--------------|--------------|----------------|------------|------------|--------------|\n`;
    
    for (const item of data) {
        markdownTable2 += `| ${item.index} | ${item.text} | ${item.neteaseStart.toFixed(2)} | ${item.qqStart.toFixed(2)} | ${item.startDiff > 0 ? '+' : ''}${item.startDiff.toFixed(3)} | ${item.neteaseEnd.toFixed(2)} | ${item.qqEnd.toFixed(2)} | ${item.endDiff > 0 ? '+' : ''}${item.endDiff.toFixed(3)} |\n`;
    }

    console.log(markdownTable2);

    // Generate a beautiful HTML file with ECharts
    const htmlPath = path.resolve(process.cwd(), `test/manual/lyric-audit-output/lyric_duration_chart_${songId}.html`);
    const labels = data.map((item: any) => `Line ${item.index}`);
    const chartData = data.map((item: any) => item.diff);
    const lineTexts = data.map((item: any) => item.text);

    // Prepare K-line data format: [open, close, lowest, highest]
    const kLineData = data.map((item: any) => [
        item.startDiff,
        item.endDiff,
        Math.min(item.startDiff, item.endDiff),
        Math.max(item.startDiff, item.endDiff)
    ]);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Lyric Timeline K-Line & Duration Chart - ${songTitle}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            margin: 0;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            width: 95%;
            max-width: 1300px;
            background-color: #1e293b;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
            margin-bottom: 24px;
        }
        h1 {
            font-size: 26px;
            margin-top: 0;
            margin-bottom: 8px;
            color: #f1f5f9;
            text-align: center;
        }
        h2 {
            font-size: 18px;
            color: #e2e8f0;
            border-left: 4px solid #38bdf8;
            padding-left: 10px;
            margin-top: 0;
            margin-bottom: 16px;
        }
        .subtitle {
            color: #94a3b8;
            font-size: 14px;
            margin-bottom: 24px;
            text-align: center;
        }
        .chart-box {
            width: 100%;
            height: 480px;
            margin-bottom: 24px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            font-size: 13px;
        }
        th, td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid #334155;
        }
        th {
            background-color: #0f172a;
            color: #94a3b8;
            font-weight: 600;
        }
        tr:hover {
            background-color: #334155;
        }
        .diff-pos {
            color: #10b981;
            font-weight: 600;
        }
        .diff-neg {
            color: #ef4444;
            font-weight: 600;
        }
        .diff-zero {
            color: #64748b;
        }
        .legend-info {
            display: flex;
            gap: 20px;
            justify-content: center;
            margin-bottom: 16px;
            font-size: 13px;
            color: #94a3b8;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .color-box {
            width: 14px;
            height: 14px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Lyric Timeline K-Line & Duration Dashboard</h1>
        <div class="subtitle">Song: <strong>${songTitle}</strong> (ID: ${songId})</div>

        <h2>Lyric Source Statistics Summary</h2>
        <table style="margin-bottom: 24px;">
            <thead>
                <tr>
                    <th>Source</th>
                    <th>Candidate Details</th>
                    <th>Match Score</th>
                    <th>Available?</th>
                    <th>Format</th>
                    <th>Line Count</th>
                    <th>Matched Lines</th>
                    <th>Word Count</th>
                    <th>First Start</th>
                    <th>Last End</th>
                    <th>Timeline Span</th>
                </tr>
            </thead>
            <tbody>
                ${sourceAudits.map((item: any) => `
                <tr>
                    <td><strong style="color: #38bdf8">${item.source.toUpperCase()}</strong></td>
                    <td>
                        <div style="font-weight: 600;">${item.candidate.title}</div>
                        <div style="font-size: 11px; color: #94a3b8;">${item.candidate.artist} | ${item.candidate.album}</div>
                        <div style="font-size: 11px; color: #64748b;">Duration: ${(item.candidate.durationMs / 1000).toFixed(2)}s | ID: ${item.candidate.id}</div>
                    </td>
                    <td>${item.candidate.score}%</td>
                    <td>${item.lyrics.available ? '✅ Yes' : '❌ No'}</td>
                    <td>${item.lyrics.isWordByWord ? '⚡ Word-by-word' : '📝 Line-by-line'}</td>
                    <td>${item.lyrics.lineCount}</td>
                    <td>${item.lyrics.matchedLineCount}</td>
                    <td>${item.lyrics.wordCount}</td>
                    <td>${item.lyrics.firstLineStartSec !== null ? item.lyrics.firstLineStartSec.toFixed(2) + 's' : '-'}</td>
                    <td>${item.lyrics.lastLineEndSec !== null ? item.lyrics.lastLineEndSec.toFixed(2) + 's' : '-'}</td>
                    <td>${item.lyrics.timelineSpanSec !== null ? item.lyrics.timelineSpanSec.toFixed(2) + 's' : '-'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <h2>Pairwise Offset Statistics</h2>
        <table>
            <thead>
                <tr>
                    <th>Pair</th>
                    <th>Matched Keys</th>
                    <th>Median Offset</th>
                    <th>Offset Range (Min / Max)</th>
                    <th>Timeline Drift</th>
                    <th>Duration Delta</th>
                    <th>Can Explain Offset?</th>
                </tr>
            </thead>
            <tbody>
                ${pairwise.map((pair: any, idx: number) => {
                    const cal = durationCalibration[idx] || {};
                    return `
                    <tr>
                        <td><strong>${pair.from.toUpperCase()} &rarr; ${pair.to.toUpperCase()}</strong></td>
                        <td>${pair.matchedKeys} lines</td>
                        <td class="${pair.startDeltaSec?.median !== 0 ? 'diff-pos' : 'diff-zero'}">
                            ${pair.startDeltaSec?.median > 0 ? '+' : ''}${pair.startDeltaSec?.median?.toFixed(3)}s
                        </td>
                        <td>
                            ${pair.startDeltaSec?.min?.toFixed(3)}s ~ ${pair.startDeltaSec?.max?.toFixed(3)}s
                        </td>
                        <td class="${pair.driftSec !== 0 ? 'diff-neg' : 'diff-zero'}">
                            ${pair.driftSec > 0 ? '+' : ''}${pair.driftSec?.toFixed(3)}s
                        </td>
                        <td>
                            ${cal.candidateDurationDeltaSec !== null ? (cal.candidateDurationDeltaSec > 0 ? '+' : '') + cal.candidateDurationDeltaSec.toFixed(2) + 's' : '-'}
                        </td>
                        <td>
                            ${cal.durationCanExplainOffset ? '✅ Yes' : '❌ No'}
                        </td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    </div>

    <div class="container">
        <h2>1. Timeline Offset K-Line Chart (QQ - NetEase)</h2>
        <div class="legend-info">
            <div class="legend-item">
                <div class="color-box" style="background-color: #10b981;"></div>
                <span><strong>Green Candle (Bullish)</strong>: QQ line is longer (Start Diff &lt; End Diff)</span>
            </div>
            <div class="legend-item">
                <div class="color-box" style="background-color: #ef4444;"></div>
                <span><strong>Red Candle (Bearish)</strong>: QQ line is shorter (Start Diff &gt; End Diff)</span>
            </div>
            <div class="legend-item">
                <span><strong>Candle Extents</strong>: Bottom = Start Diff, Top = End Diff (or vice versa)</span>
            </div>
        </div>
        <div id="chartKLine" class="chart-box"></div>
        
        <hr style="border: 0; border-top: 1px solid #334155; margin: 32px 0;">
        
        <h2>2. Lyric Duration Difference (QQ - NetEase)</h2>
        <div class="subtitle" style="text-align: left; margin-bottom: 12px;">Positive values mean QQ lines are longer than NetEase.</div>
        <div id="chartDuration" class="chart-box"></div>
    </div>

    <div class="container" style="overflow-x: auto;">
        <h2>Detailed Data Table</h2>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Text</th>
                    <th>NE Start</th>
                    <th>QQ Start</th>
                    <th>Start Diff</th>
                    <th>NE End</th>
                    <th>QQ End</th>
                    <th>End Diff</th>
                    <th>NE Duration</th>
                    <th>QQ Duration</th>
                    <th>Duration Diff</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(item => `
                <tr>
                    <td>${item.index}</td>
                    <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.text}</td>
                    <td>${item.neteaseStart.toFixed(2)}s</td>
                    <td>${item.qqStart.toFixed(2)}s</td>
                    <td class="${item.startDiff > 0 ? 'diff-pos' : item.startDiff < 0 ? 'diff-neg' : 'diff-zero'}">
                        ${item.startDiff > 0 ? '+' : ''}${item.startDiff.toFixed(3)}s
                    </td>
                    <td>${item.neteaseEnd.toFixed(2)}s</td>
                    <td>${item.qqEnd.toFixed(2)}s</td>
                    <td class="${item.endDiff > 0 ? 'diff-pos' : item.endDiff < 0 ? 'diff-neg' : 'diff-zero'}">
                        ${item.endDiff > 0 ? '+' : ''}${item.endDiff.toFixed(3)}s
                    </td>
                    <td>${item.neteaseDur.toFixed(2)}s</td>
                    <td>${item.qqDur.toFixed(2)}s</td>
                    <td class="${item.diff > 0 ? 'diff-pos' : item.diff < 0 ? 'diff-neg' : 'diff-zero'}">
                        ${item.diff > 0 ? '+' : ''}${item.diff.toFixed(3)}s
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        // Data sources
        const labels = ${JSON.stringify(labels)};
        const chartData = ${JSON.stringify(chartData)};
        const kLineData = ${JSON.stringify(kLineData)};
        const lineTexts = ${JSON.stringify(lineTexts)};

        // 1. Chart K-Line: Candlestick Offset comparison
        const chartKDom = document.getElementById('chartKLine');
        const myChartK = echarts.init(chartKDom, 'dark');
        const optionK = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line' },
                formatter: function (params) {
                    const param = params[0];
                    const text = lineTexts[param.dataIndex];
                    const val = param.value; // [index, open, close, lowest, highest]
                    const open = val[1];
                    const close = val[2];
                    const diff = close - open;
                    
                    return '<strong>Line ' + param.name + '</strong><br/>' +
                           'Text: ' + text + '<br/>' +
                           'Start Diff (Open): <span style="color:#38bdf8">' + (open >= 0 ? '+' : '') + open.toFixed(3) + 's</span><br/>' +
                           'End Diff (Close): <span style="color:#fb7185">' + (close >= 0 ? '+' : '') + close.toFixed(3) + 's</span><br/>' +
                           'Duration Change: <span style="color:' + (diff >= 0 ? '#10b981' : '#ef4444') + '">' +
                           (diff >= 0 ? '+' : '') + diff.toFixed(3) + 's</span>';
                }
            },
            grid: { top: 30, bottom: 80, left: 50, right: 30 },
            xAxis: {
                type: 'category',
                data: labels,
                axisLabel: { interval: 0, rotate: 45, color: '#94a3b8' }
            },
            yAxis: {
                type: 'value',
                name: 'Offset Delta (QQ - NetEase) / seconds',
                nameTextStyle: { color: '#94a3b8', padding: [0, 0, 10, 0] },
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: '#334155' } }
            },
            series: [{
                type: 'candlestick',
                data: kLineData,
                itemStyle: {
                    color: '#10b981',       // Up color (Green) -> QQ is longer
                    color0: '#ef4444',      // Down color (Red) -> QQ is shorter
                    borderColor: '#10b981',
                    borderColor0: '#ef4444'
                }
            }]
        };
        myChartK.setOption(optionK);

        // 2. Chart 2: Duration Diff
        const chart1Dom = document.getElementById('chartDuration');
        const myChart1 = echarts.init(chart1Dom, 'dark');
        const option1 = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    const param = params[0];
                    const text = lineTexts[param.dataIndex];
                    return '<strong>Line ' + param.name + '</strong><br/>' +
                           'Text: ' + text + '<br/>' +
                           'Duration Diff: ' +
                           '<span style="color:' + (param.value >= 0 ? '#10b981' : '#ef4444') + '">' +
                           (param.value >= 0 ? '+' : '') + param.value.toFixed(3) + 's</span>';
                }
            },
            grid: { top: 20, bottom: 80, left: 50, right: 30 },
            xAxis: {
                type: 'category',
                data: labels,
                axisLabel: { interval: 0, rotate: 45, color: '#94a3b8' }
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: '#334155' } }
            },
            series: [{
                data: chartData,
                type: 'bar',
                itemStyle: {
                    color: function(params) {
                        return params.value >= 0 ? '#10b981' : '#ef4444';
                    }
                }
            }]
        };
        myChart1.setOption(option1);

        window.addEventListener('resize', function() {
            myChartK.resize();
            myChart1.resize();
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log(`\nSuccessfully wrote interactive HTML chart to: ${htmlPath}`);
}
