"""dev/stemSplit/compare.py
把原型分出来的人声/伴奏和官方伴奏（inst）比：官方 inst 当伴奏的标准答案，原曲减官方 inst 当人声的标准答案。

    python dev/stemSplit/compare.py <原曲> <官方inst> <原型输出目录>

先用互相关找原曲和 inst 的偏移、用最小二乘找增益（不同母带时会不是 1），再算 SDR / SI-SDR
（整首，与 1 秒窗的中位数，同 museval 的做法），和“不分离，直接拿原曲当伴奏”的基线比。
在输出目录写 ref_vocals.wav（原曲 - 官方inst）和 inst_error.wav（分出的伴奏 - 官方inst，即漏进伴奏的人声与被吃掉的伴奏），
并列出误差最大的几段，方便去听。
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

RATE = 44100


def decode(file):
    """ffmpeg 解成 44.1kHz 双声道 float32，[2, n]。文件从标准输入喂：扩展名前带空格的文件名 Windows 上 ffmpeg 打不开。"""
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-vn', '-f', 'f32le', '-ac', '2', '-ar', str(RATE), 'pipe:1'],
        check=True, capture_output=True, input=Path(file).read_bytes(),
    ).stdout
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).T.astype(np.float64)


def read_wav(file):
    with wave.open(str(file), 'rb') as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, 2).T
    return data.astype(np.float64) / 32767


def write_wav(file, x):
    pcm = np.clip(np.round(x.T * 32767), -32768, 32767).astype('<i2')
    with wave.open(str(file), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def lag_of(a, b, max_lag=RATE):
    """b 相对 a 的偏移（采样），用中间 30 秒单声道做 FFT 互相关。"""
    mid = a.shape[1] // 2
    seg_a = a[:, mid - 15 * RATE: mid + 15 * RATE].mean(0)
    seg_b = b[:, mid - 15 * RATE - max_lag: mid + 15 * RATE + max_lag].mean(0)
    n = 1 << int(np.ceil(np.log2(len(seg_a) + len(seg_b))))
    corr = np.fft.irfft(np.fft.rfft(seg_b, n) * np.conj(np.fft.rfft(seg_a, n)), n)
    best = int(np.argmax(corr[: 2 * max_lag + 1]))
    return best - max_lag


def sdr(ref, est):
    return 10 * np.log10(np.sum(ref ** 2) / max(np.sum((ref - est) ** 2), 1e-20))


def si_sdr(ref, est):
    r, e = ref.ravel(), est.ravel()
    target = (e @ r) / (r @ r) * r
    return 10 * np.log10((target @ target) / max(((e - target) @ (e - target)), 1e-20))


def windowed_sdr(ref, est, seconds=1.0):
    """1 秒窗的 SDR 中位数，参考几乎无声的窗不计。"""
    w = int(seconds * RATE)
    vals = []
    for at in range(0, ref.shape[1] - w + 1, w):
        r, e = ref[:, at:at + w], est[:, at:at + w]
        if np.mean(r ** 2) < 1e-7:
            continue
        vals.append(sdr(r, e))
    return float(np.median(vals)) if vals else float('nan'), len(vals)


def db(x):
    return 10 * np.log10(max(np.mean(x ** 2), 1e-20))


def main():
    mix_file, inst_file, out_dir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    mix = decode(mix_file)
    inst_ref = decode(inst_file)
    lag = lag_of(mix, inst_ref)
    if lag > 0:
        inst_ref = inst_ref[:, lag:]
    elif lag < 0:
        inst_ref = np.pad(inst_ref, ((0, 0), (-lag, 0)))
    n = min(mix.shape[1], inst_ref.shape[1])
    mix, inst_ref = mix[:, :n], inst_ref[:, :n]
    gain = float(np.sum(mix * inst_ref) / np.sum(inst_ref ** 2))
    print(f'对齐：官方 inst 相对原曲偏移 {lag} 采样，最小二乘增益 {gain:.4f}（{20 * np.log10(gain):+.2f} dB）')

    vocals_ref = mix - inst_ref
    # 人声参考干不干净：两首母带一致时，无人声段原曲 - inst 应接近静音。
    frame = RATE // 10
    energies = np.array([db(vocals_ref[:, i:i + frame]) for i in range(0, n - frame, frame)])
    print(f'参考人声（原曲 - 官方inst）：整体 {db(vocals_ref):.1f} dB；最安静的 10% 段 {np.percentile(energies, 10):.1f} dB'
          f'（越低说明两版母带越一致，参考越可信）')

    vocals_est = read_wav(out_dir / 'vocals.wav')[:, :n]
    inst_est = read_wav(out_dir / 'instrumental.wav')[:, :n]
    m = min(n, vocals_est.shape[1])
    mix, inst_ref, vocals_ref, vocals_est, inst_est = (x[:, :m] for x in (mix, inst_ref, vocals_ref, vocals_est, inst_est))

    rows = [
        ('伴奏：分离结果 vs 官方inst', inst_ref, inst_est),
        ('伴奏：基线（直接拿原曲当伴奏）', inst_ref, mix),
        ('人声：分离结果 vs 原曲-官方inst', vocals_ref, vocals_est),
    ]
    print(f'\n{"":34s}{"SDR":>9s}{"SI-SDR":>9s}{"1s窗SDR中位":>14s}')
    for name, ref, est in rows:
        med, count = windowed_sdr(ref, est)
        print(f'{name:28s}{sdr(ref, est):9.2f}{si_sdr(ref, est):9.2f}{med:12.2f}  ({count} 窗)')

    err = inst_est - inst_ref
    print(f'\n伴奏误差（分出伴奏 - 官方inst）整体 {db(err):.1f} dB，官方inst {db(inst_ref):.1f} dB，参考人声 {db(vocals_ref):.1f} dB')
    # 误差里有多少是漏进来的人声：误差投影到参考人声上的那部分。
    leak = (err.ravel() @ vocals_ref.ravel()) / (vocals_ref.ravel() @ vocals_ref.ravel())
    print(f'误差里与参考人声同相的分量：{leak * 100:.1f}% 的人声留在了伴奏里（负数为多减）')

    w = 5 * RATE
    windows = []
    for at in range(0, m - w + 1, w):
        windows.append((db(err[:, at:at + w]) - db(inst_ref[:, at:at + w]), db(vocals_ref[:, at:at + w]), at / RATE))
    print('\n每 5 秒：伴奏误差相对官方inst（dB，越低越好）/ 该段参考人声电平')
    for rel, vdb, t in windows:
        bar = '#' * max(0, int((rel + 40) / 2))
        print(f'  {int(t // 60)}:{int(t % 60):02d}  {rel:6.1f}  人声 {vdb:6.1f}  {bar}')
    worst = sorted(windows, reverse=True)[:5]
    print('误差最大的几段：' + '，'.join(f'{int(t // 60)}:{int(t % 60):02d}（{rel:.1f} dB）' for rel, _, t in worst))

    write_wav(out_dir / 'ref_vocals.wav', vocals_ref)
    write_wav(out_dir / 'inst_error.wav', err)
    print(f'\n已写 {out_dir / "ref_vocals.wav"} 和 {out_dir / "inst_error.wav"}')


if __name__ == '__main__':
    main()
