# Spatial audio demo provenance

## Music comparison

- Recording: Bacao Rhythm & Steel Band, "P.I.M.P."
- Official release: https://bacaorhythmandsteelband.bandcamp.com/track/p-i-m-p
- Local source: `/home/epestr/Bacao Rhythm & Steel Band - PIMP [MQ6J4xHuMgc].mp3`
- Source SHA-256: `0db915487d6ac1181bc45b6f92c3f13f142c701b75ef70ce76be25833fe6d58b`
- Source passage: `00:45.000` through `00:55.000`
- Permission to publish the excerpt: unconfirmed. The official release is marked all rights reserved.

The source was decoded to stereo float audio at 48 kHz. Saqol was pinned to commit
`2cc5aec3c3ca68e91275f1bd49dfb6590fe63042`. Processing used its
`SurroundEngine` with surround enabled, its subwoofer parameter at 100%, EQ off,
volume at 100%, and no other processing modes. The complete source from its
beginning was processed before the excerpt was cropped, preserving 45 seconds
of filter history.

Cross-correlation over the chosen passage measured 723 samples of processing
latency at 48 kHz. The processed crop starts 723 samples later to place the same
musical moments at the same point in both files.

One constant gain was applied to each version. The original received -10.0 dB
and the processed version -12.2 dB. After MP3 encoding, their measured
integrated loudness was -18.2 and -18.3 LUFS. Their true peaks were -8.9 and
-2.9 dBFS, respectively. Neither file clips.

## Embedded Saqol

The browser app and WASM come from the same pinned commit. The WASM was built
locally with `crates/saq-web/build.sh`, not downloaded as a moving artifact. Its
SHA-256 is `e3905b4c1cc803358e5904dc39f80314479c050604d9d55b9a6b092993f3fee2`.

The deployed copy is under `static/demos/saqol/`. `index.html` was modified to
remove the remote font request, require a user gesture before creating the audio
engine, show a blocking error when the browser does not provide 48 kHz audio,
coordinate playback with the article comparison, and link the exact source and
MPL-2.0 license. The modified source is the served `index.html` itself. The
other JavaScript source files are unmodified copies from upstream.
