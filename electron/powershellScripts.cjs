const path = require('node:path');

// electron/powershellScripts.cjs
// The PowerShell Folia runs is a file of the repository, never a script made up and handed over on a
// command line. Windows security software reads a base64 -EncodedCommand (or a script passed as
// -Command text) as an attempt to run code nobody can inspect, and flags it; a .ps1 handed over as
// -File is the same work spelled the way every other program is started.
//
// The scripts are packed outside app.asar, because PowerShell opens the path itself and an archive is
// not a file system to anything but Node and Electron. A path inside the archive is answered with the
// unpacked tree beside it, which is where electron-builder puts the same files.

// The segment an archive shows up as once Electron packed the app.
const ARCHIVE = 'app.asar';
const UNPACKED = 'app.asar.unpacked';

/**
 * The path a script really has, given the folder the module that runs it lives in and the script's
 * name: a folder inside app.asar becomes the unpacked folder beside it, and every other folder is
 * taken as it is (the repository in development, or a build whose files are not packed).
 */
function powershellScriptPath(folder, name) {
    const parts = path.resolve(folder).split(path.sep);
    const at = parts.lastIndexOf(ARCHIVE);
    if (at >= 0) parts[at] = UNPACKED;
    return path.join(parts.join(path.sep), name);
}

/**
 * The arguments one PowerShell is started with to run a script file: no profile, no window, and the
 * script's own named parameters after it. A parameter that is missing (null, undefined) is left out,
 * so a script keeps its default.
 */
function powershellFileArguments(scriptPath, parameters = {}) {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    for (const [name, value] of Object.entries(parameters)) {
        if (value === undefined || value === null) continue;
        args.push('-' + name, String(value));
    }
    return args;
}

// The PIDs a start found running, as one parameter value: comma separated, no space anywhere, so a
// single argument reaches PowerShell whichever way the operating system wrote the command line.
const skipPidsArgument = pids => (Array.isArray(pids) ? pids.filter(pid => Number.isInteger(pid)) : []).join(',');

module.exports = { powershellFileArguments, powershellScriptPath, skipPidsArgument };
