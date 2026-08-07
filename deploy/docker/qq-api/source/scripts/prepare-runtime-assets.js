const fs = require('node:fs');
const path = require('node:path');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const distPublicDir = path.join(distDir, 'public');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  `${JSON.stringify({ version: pkg.version }, null, 2)}\n`,
  'utf8',
);

if (fs.existsSync(publicDir)) {
  fs.rmSync(distPublicDir, { recursive: true, force: true });
  fs.cpSync(publicDir, distPublicDir, { recursive: true });
}
