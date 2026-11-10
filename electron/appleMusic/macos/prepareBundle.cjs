'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Compile per target architecture so multi-arch packaging never reuses the host architecture's binary.
function prepareMacCompanion({ arch, projectRoot, run = execFileSync }) {
    const target = { x64: 'x86_64', arm64: 'arm64' }[arch];
    if (!target) throw new Error(`Unsupported Apple Music companion architecture: ${arch}`);
    const bundle = path.join(projectRoot, 'build/apple-music-native/darwin-' + arch, 'FoliaAppleMusicCompanion.app');
    run('sh', [path.join(projectRoot, 'electron/appleMusic/macos/buildCompanion.sh'), bundle, 'org.folia.AppleMusicCompanion', target], { stdio: 'inherit' });
    return bundle;
}

module.exports = { prepareMacCompanion };

// Fail packaging when the native executable or bundle metadata did not reach Resources.
async function verifyMacCompanion(resourcesDir) {
    const fs = require('node:fs/promises');
    const bundle = path.join(resourcesDir, 'apple-music/FoliaAppleMusicCompanion.app/Contents');
    await fs.access(path.join(bundle, 'MacOS/FoliaAppleMusicCompanion'), require('node:fs').constants.X_OK);
    await fs.access(path.join(bundle, 'Info.plist'));
}
module.exports.verifyMacCompanion = verifyMacCompanion;
