"""Prepare this specific, locally supplied wallpaper for the Folia API 2 renderer."""
import argparse
import base64
import json
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
LAYERS = {
    'sky': '星空', 'city': '建筑', 'railing': '栏杆',
    'girl': 'Rella 部件', 'curtainRight': '右窗帘2', 'chair': '右椅子', 'bag': '包',
}


def read_package(file):
    data = file.read_bytes()
    offset = 0

    def number():
        nonlocal offset
        value = struct.unpack_from('<I', data, offset)[0]
        offset += 4
        return value

    def string():
        nonlocal offset
        size = number()
        value = data[offset:offset + size].decode('utf8')
        offset += size
        return value

    if string() != 'PKGV0022':
        raise ValueError('This preparation script expects the supplied PKGV0022 scene')
    entries = [(string(), number(), number()) for _ in range(number())]
    result = {}
    for name, start, size in entries:
        if offset + start + size > len(data):
            raise ValueError('Invalid package bounds')
        result[name] = memoryview(data)[offset + start:offset + start + size]
    return result


def mesh_data(data):
    # MDLV0023: material C string + 28 padding bytes, then an 80-byte vertex stream.
    if data[:9] != b'MDLV0023\0':
        raise ValueError('Unsupported puppet format')
    block = data.index(b'\0', 21) + 1 + 28
    tag, size = struct.unpack_from('<II', data, block)
    if tag != 0x0180000F or size % 80:
        raise ValueError('Invalid puppet vertex block')
    start = block + 8
    vertices = []
    for offset in range(start, start + size, 80):
        x, y = struct.unpack_from('<2f', data, offset)
        u, v = struct.unpack_from('<2f', data, offset + 72)
        bone = struct.unpack_from('<I', data, offset + 40)[0]
        vertices.extend([round(x, 5), round(y, 5), round(u, 7), round(v, 7), bone])
    end = start + size
    count = struct.unpack_from('<I', data, end)[0] // 2
    indices = list(struct.unpack_from('<' + 'H' * count, data, end + 4))
    if count % 3 or max(indices) >= len(vertices) // 5:
        raise ValueError('Invalid puppet triangles')
    return {'vertices': vertices, 'indices': indices}


def metadata():
    return {
        'format': 'folia-style', 'schemaVersion': 2, 'id': 'local.nightingale',
        'name': '夜莺 · 窗边轻哼', 'version': '1.3.0', 'author': 'Folia custom / artwork Rella / wallpaper 夜莺Night',
        'description': '基于本地壁纸3448877775重制。字词在窗边微光中浮现组句，留在生成附近轻浮，到下下句出现时渐隐。',
        'palette': {'background': '#071422', 'primary': '#FFF3D6', 'secondary': '#A4CAD6', 'accent': '#E5C992'},
        'settings': {'motion': 1, 'showTranslation': True, 'showTitle': True, 'lyricMode': 'auto', 'artStyle': 'atmospheric-light'},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wallpaper', nargs='?', type=Path)
    parser.add_argument('--repkg', type=Path)
    parser.add_argument('--reuse-assets', action='store_true', help='Reuse locally prepared assets and update the generated manifest')
    args = parser.parse_args()
    if args.reuse_assets:
        previous = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
        manifest = {**metadata(), 'assets': previous['assets']}
        (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
        print('Updated metadata with', len(manifest['assets']), 'existing local assets')
        return
    if not args.wallpaper or not args.repkg:
        parser.error('wallpaper and --repkg are required unless --reuse-assets is supplied')
    entries = read_package(args.wallpaper / 'scene.pkg')
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='folia-nightingale-') as temporary:
        temp = Path(temporary)
        selected = temp / 'selected'
        selected.mkdir()
        for name in LAYERS.values():
            (selected / (name + '.tex')).write_bytes(entries['materials/' + name + '.tex'])
        converted = temp / 'converted'
        subprocess.run([str(args.repkg.resolve()), 'extract', '-t', '-s', '-o', str(converted), str(selected)], check=True)
        for key, name in LAYERS.items():
            image = Image.open(converted / (name + '.png'))
            image.thumbnail((1920, 1600), Image.Resampling.LANCZOS)
            image.save(assets / (key + '.webp'), quality=90, method=6)
        # The left curtain is an embedded video with a cyan key in the supplied scene.
        video = bytes(entries['materials/透明4.tex'])
        video = video[video.index(b'ftyp') - 4:]
        (temp / 'curtain.mp4').write_bytes(video)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(temp / 'curtain.mp4'), '-vf',
                        'colorkey=0x00FBFF:0.32:0.12', '-frames:v', '1', str(temp / 'curtain.png')], check=True)
        Image.open(temp / 'curtain.png').save(assets / 'curtainLeft.webp', quality=90, method=6)
    mesh = mesh_data(bytes(entries['models/Rella 部件_puppet.mdl']))
    (ROOT / 'puppetData.js').write_text('// Generated by prepare.py from the supplied local MDL.\nexport default ' + json.dumps(mesh, separators=(',', ':')) + ';\n', encoding='utf8')
    manifest = {
        **metadata(),
        'assets': [{'id': file.stem.lower(), 'mime': 'image/webp', 'data': base64.b64encode(file.read_bytes()).decode('ascii')}
                   for file in sorted(assets.glob('*.webp'))],
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
    print('Prepared', len(manifest['assets']), 'assets and', len(mesh['vertices']) // 5, 'puppet vertices')


if __name__ == '__main__':
    main()
