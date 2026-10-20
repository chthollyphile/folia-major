const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Temporarily auto-hide KDE dodge panels while a wallpaper is outside Plasma's task model.
const MARKER_NAME = '.wallpaper-kde-panels.json';

function parsePanelIds(text) {
    const ids = JSON.parse(text);
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 0)) {
        throw new Error('Invalid KDE wallpaper panel ids');
    }
    return [...new Set(ids)];
}

// Both qdbus and gdbus print the script's JSON array; gdbus adds a GVariant string tuple.
function evaluatePanelScript(script, run) {
    const commands = [
        ['gdbus', ['call', '--session', '--dest', 'org.kde.plasmashell', '--object-path',
            '/PlasmaShell', '--method', 'org.kde.PlasmaShell.evaluateScript', script]],
        ['qdbus6', ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', script]],
        ['qdbus', ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', script]],
    ];
    for (const [command, args] of commands) {
        try {
            const output = String(run(command, args, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' })).trim();
            return parsePanelIds(output.startsWith("('") && output.endsWith("',)") ? output.slice(2, -3) : output);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    throw new Error('No Plasma D-Bus client is available');
}

function panelTransitionScript(ids, from, to) {
    return `var pending = [];
        ${JSON.stringify(ids)}.forEach(function (id) {
            var panel = panelById(id);
            if (panel && panel.hiding === '${from}') {
                panel.hiding = '${to}';
                if (panel.hiding !== '${to}') pending.push(id);
            }
        });
        print(JSON.stringify(pending));`;
}

function createKdeWallpaperPanels(options = {}) {
    const {
        platform = process.platform,
        env = process.env,
        userDataPath,
        fsModule = fs,
        run = execFileSync,
        logInfo = (...args) => console.info(...args),
        logWarn = (...args) => console.warn(...args),
    } = options;
    const enabled = platform === 'linux'
        && (env.XDG_CURRENT_DESKTOP || '').split(':').some(desktop => desktop.toLowerCase() === 'kde');
    let ownedIds = [];
    let markerPath;

    function getMarkerPath() {
        if (!markerPath) markerPath = path.join(userDataPath(), MARKER_NAME);
        return markerPath;
    }

    // Restore only panels still in our temporary mode; a user's later preference takes priority.
    function restore() {
        if (!enabled || !ownedIds.length) return true;
        try {
            const pending = evaluatePanelScript(panelTransitionScript(ownedIds, 'autohide', 'dodgewindows'), run);
            if (pending.length) throw new Error(`KDE panel restore did not apply: ${pending.join(', ')}`);
            fsModule.rmSync(getMarkerPath(), { force: true });
            logInfo('[WallpaperKde] restored dodge panels', ownedIds);
            ownedIds = [];
            return true;
        } catch (error) {
            logWarn('[WallpaperKde] panel restore failed; keeping recovery marker', error);
            return false;
        }
    }

    // Run only after acquiring the single-instance lock, before a new wallpaper can hide panels.
    function recover() {
        if (!enabled) return true;
        try {
            if (!fsModule.existsSync(getMarkerPath())) return true;
            ownedIds = parsePanelIds(fsModule.readFileSync(getMarkerPath(), 'utf8'));
            if (!ownedIds.length) fsModule.rmSync(getMarkerPath(), { force: true });
            return restore();
        } catch (error) {
            logWarn('[WallpaperKde] could not recover wallpaper panels', error);
            return false;
        }
    }

    // Persist recovery BEFORE changing Plasma: a failed D-Bus reply can follow a partial change.
    function hide() {
        if (!enabled || ownedIds.length) return;
        try {
            if (fsModule.existsSync(getMarkerPath())) return;
            const ids = evaluatePanelScript(`print(JSON.stringify(panels().filter(function (panel) {
                return panel.hiding === 'dodgewindows';
            }).map(function (panel) { return panel.id; })));`, run);
            if (!ids.length) return;
            const tempPath = `${getMarkerPath()}.tmp`;
            fsModule.writeFileSync(tempPath, JSON.stringify(ids), { mode: 0o600 });
            fsModule.renameSync(tempPath, getMarkerPath());
            ownedIds = ids;
            const pending = evaluatePanelScript(panelTransitionScript(ids, 'dodgewindows', 'autohide'), run);
            if (pending.length) throw new Error(`KDE panel auto-hide did not apply: ${pending.join(', ')}`);
            logInfo('[WallpaperKde] auto-hiding dodge panels during wallpaper mode', ids);
        } catch (error) {
            logWarn('[WallpaperKde] could not auto-hide wallpaper panels', error);
            restore();
        }
    }

    return { hide, restore, recover };
}

module.exports = { createKdeWallpaperPanels };
