// 夹具：装进 deps 归档的依赖。像网易云、QQ 的上游库那样依赖真实的文件布局：扫自己的 module/ 目录逐个 require，
// 读包里的 JSON，再 require 闭包里的另一个包。
'use strict';
const fs = require('fs');
const path = require('path');
const leaf = require('fixture-asar-leaf');

const modules = fs.readdirSync(path.join(__dirname, 'module')).filter((name) => name.endsWith('.cjs')).sort()
    .map((name) => require(path.join(__dirname, 'module', name)));
const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

exports.loadedFrom = __filename;
exports.catalog = () => modules.map((entry) => `${entry.name}@${info.version}+${leaf.mark}`);
