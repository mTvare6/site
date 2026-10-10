#!/usr/bin/env python3
"""Generate the short probe examples embedded in the spatial-audio post."""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

import numpy as np


SAMPLE_RATE = 48_000
OUTPUT = Path(__file__).resolve().parents[1] / "static" / "audio"


def dbfs(value: float) -> float:
    return 10.0 ** (value / 20.0)


def fade(signal: np.ndarray, milliseconds: float = 8.0) -> np.ndarray:
    signal = signal.copy()
    count = min(round(SAMPLE_RATE * milliseconds / 1000.0), len(signal) // 2)
    if count:
        ramp = np.linspace(0.0, 1.0, count, endpoint=False)
        signal[:count] *= ramp
        signal[-count:] *= ramp[::-1]
    return signal


def silence(seconds: float) -> np.ndarray:
    return np.zeros((round(seconds * SAMPLE_RATE), 2))


def route(mono: np.ndarray, mode: str = "both") -> np.ndarray:
    zero = np.zeros_like(mono)
    if mode == "left":
        return np.column_stack((mono, zero))
    if mode == "right":
        return np.column_stack((zero, mono))
    if mode == "both":
        return np.column_stack((mono, mono))
    if mode == "anti":
        return np.column_stack((mono, -mono))
    raise ValueError(f"unknown channel mode: {mode}")


def join(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts, axis=0)


def log_sweep(f0: float, f1: float, seconds: float, level: float) -> np.ndarray:
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    ratio = math.log(f1 / f0)
    phase = 2.0 * np.pi * f0 * seconds / ratio * (np.exp(t * ratio / seconds) - 1.0)
    return fade(dbfs(level) * np.sin(phase), 20.0)


def tone(frequency: float, seconds: float, level: float) -> np.ndarray:
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return fade(dbfs(level) * np.sin(2.0 * np.pi * frequency * t))


def multitone(seconds: float, level: float) -> np.ndarray:
    frequencies = np.array([31.0, 71.0, 137.0, 503.0, 1009.0, 3011.0, 7001.0, 12007.0])
    phases = np.array([0.1, 1.7, 3.0, 0.7, 2.1, 4.2, 5.1, 2.8])
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    signal = np.sin(2.0 * np.pi * t[:, None] * frequencies + phases).sum(axis=1)
    signal /= np.max(np.abs(signal))
    return fade(signal * dbfs(level), 20.0)


def band_noise(low: float, high: float, seconds: float, level: float, rng: np.random.Generator) -> np.ndarray:
    count = round(seconds * SAMPLE_RATE)
    spectrum = np.fft.rfft(rng.standard_normal(count))
    frequencies = np.fft.rfftfreq(count, 1.0 / SAMPLE_RATE)
    spectrum[(frequencies < low) | (frequencies > high)] = 0.0
    signal = np.fft.irfft(spectrum, count)
    signal /= max(np.max(np.abs(signal)), 1e-12)
    return fade(signal * dbfs(level), 20.0)


def write_mp3(name: str, signal: np.ndarray) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(signal, -1.0, 1.0).astype("<f4").tobytes()
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "f32le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "2",
            "-i",
            "pipe:0",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "5",
            str(OUTPUT / name),
        ],
        input=pcm,
        check=True,
    )


def generate() -> None:
    sync = np.zeros(round(SAMPLE_RATE * 1.0))
    sync[np.arange(8) * round(SAMPLE_RATE * 0.1)] = dbfs(-12.0)
    write_mp3("probe-sync.mp3", route(sync))

    impulse_parts = []
    for level in (-30.0, -18.0, -6.0):
        for mode in ("left", "right", "both", "anti"):
            click = np.zeros(round(SAMPLE_RATE * 0.45))
            click[0] = dbfs(level)
            impulse_parts.append(route(click, mode))
    write_mp3("probe-impulses.mp3", join(*impulse_parts))

    write_mp3("probe-sweep.mp3", route(log_sweep(20.0, 20_000.0, 8.0, -18.0)))

    tone_parts = []
    for frequency in (30, 60, 90, 120, 180, 300, 500, 1000, 2000, 4000, 8000, 12000, 16000):
        tone_parts.append(route(tone(frequency, 0.28, -22.0)))
        tone_parts.append(silence(0.08))
    write_mp3("probe-tones.mp3", join(*tone_parts))

    t = np.arange(round(SAMPLE_RATE * 6.0)) / SAMPLE_RATE
    levels = np.where((np.floor(t / 0.5).astype(int) % 2) == 0, dbfs(-30.0), dbfs(-12.0))
    stepped = fade(levels * np.sin(2.0 * np.pi * 1000.0 * t))
    write_mp3("probe-stepped-tone.mp3", route(stepped))

    combined = multitone(4.0, -18.0)
    write_mp3("probe-multitone.mp3", route(combined))
    repeated = multitone(2.0, -18.0)
    write_mp3(
        "probe-repeats.mp3",
        join(route(repeated), silence(0.45), route(repeated), silence(0.45), route(repeated)),
    )

    rng = np.random.default_rng(0xB003D)
    noise_parts = []
    for low, high in ((30.0, 120.0), (120.0, 4000.0), (5000.0, 18000.0)):
        noise_parts.append(route(band_noise(low, high, 1.4, -22.0, rng)))
        noise_parts.append(silence(0.25))
    write_mp3("probe-noise.mp3", join(*noise_parts))


if __name__ == "__main__":
    generate()
