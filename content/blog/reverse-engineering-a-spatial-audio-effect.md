---
title: "Reverse engineering a spatial audio effect from a commercial audio processor"
date: 2026-10-10T05:30:23+05:30
description: "Measuring a commercial spatial audio processor, extracting its stereo impulse responses, and rebuilding the effect as a convolution filter on Linux."
tags: ["audio", "dsp", "pipewire", "reverse-engineering"]
masthead_current: "blog"
math: true
draft: false
---

Back while I was using a different OS, I used a program which processed the audio being played in real time and made it sound much better. It made the sound feel farther away and a bit lighter to hear, while carrying the relevant information. I'd always wanted a similar program which was equally simple to use for Linux, and decided to write one.

## First attempt

Since I was writing for Linux, my base stack was [PipeWire](https://pipewire.org/ "PipeWire — multimedia processing for Linux"). I had no prior audio experience, so I began by using an LLM as a sounding board while experimenting with standard audio filters and psychoacoustic techniques.

Somewhere along the way I learnt about HRTFs, which describe how sound arriving from a particular direction reaches the ears, depending on the direction and geometry of the listener. I tried the [MIT KEMAR database](https://sound.media.mit.edu/resources/KEMAR.html "MIT KEMAR head-related transfer-function measurements") first and thought it sounded awful, because it had been recorded in an anechoic chamber, so there were no room echoes, which were a desirable psychoacoustic effect here. The result sounded cheap and more inwards to the ear. Later I found the [SADIE II database](https://www.york.ac.uk/sadie-project/database.html "SADIE II spatial-audio and binaural room-response database"), which also came with room responses, and that sounded much closer to what I remembered.

But this approach soon showed its limits. The LLM began talking about things like "perceptual envelopment", "late-field decorrelation", "spectral diffusion" and "diffuse spatial energy".<sup class="sidenote-number"><a href="#sidenote-1">[1]</a></sup><span class="sidenote" id="sidenote-1"><span class="sidenote-label">[1]</span> Gemini was particularly good at this. It was also the only one with a free student program.</span> While I could hear that something was wrong, those descriptions didn't point to anything I could understand or use to improve the effect.

I left the project dead for a while with no obvious direction to proceed with.

## The second attempt

Much later, I had a different idea. Instead of trying to discover the exact parameters or techniques and algorithms the program used internally, I could study the behaviour of the filter itself.

This seems obvious in retrospect, but I did not have a copy of the program. I could only experiment on a friend's laptop, so I could not keep changing my implementation and comparing it with the reference whenever I wanted.

I began reading [Signalsmith](https://signalsmith-audio.com/writing/ "Signalsmith Audio — DSP investigations and writing") and some blogs by audio engineers to build enough intuition to know what I should measure, and soon realised that I didn't need to keep using the program to capture its impulse responses and other measurable features. I generated an audio file on Linux, got my friend's laptop for a while, played the generated file through the program and recorded the output.

## The assembly of tests

The question became what I should put into that file so it could capture the relevant details which differentiated the program without having to re-record features or filters.

The first useful thing I found was impulse-response measurement.

If I pass a file containing a single nonzero sample through the filter, everything which appears after it in the recording would've been added by the filter. Features such as the extent of its decay over time, the shape of the decay and the phase delays associated with it would be present in the output. Playing the impulse in the right channel allows extracting both outputs' responses to sound played on the right, and likewise for the left.

If the response to one impulse is $h$, then the response to an impulse at position $k$ is the same $h$ shifted to $k$ and scaled by $x[k]$. Adding all of those responses gives

$$
y[n]=\sum_k x[k]h[n-k]=(x*h)[n].
$$

This of course depends on the filter being a [linear time-invariant filter](https://en.wikipedia.org/wiki/Linear_time-invariant_system "Linear time-invariant systems").

A louder impulse should produce the same response made proportionally louder:

$$
F(ax)=aF(x).
$$

Two inputs played together should produce the sum of what each input produces separately:

$$
F(x_1+x_2)=F(x_1)+F(x_2).
$$

And playing the same input later should produce the same response later.

And given it's stereo, the full equation would be:

$$
\begin{bmatrix}
y_L\\
y_R
\end{bmatrix}
{}={}
\begin{bmatrix}
h_{LL} & h_{LR}\\
h_{RL} & h_{RR}
\end{bmatrix}
*
\begin{bmatrix}
x_L\\
x_R
\end{bmatrix}.
$$

Given I was sending one file to have it recorded through every mode, I added impulses at different amplitudes to check for level-dependent processing, and played the same impulse in both channels, then with the right channel inverted. The outputs should match the isolated responses added together in the first case and subtracted in the second, checking the conditions above. I also left enough silence between them for the response to finish before the next impulse.

{{< audio src="/audio/probe-impulses.mp3" caption="Impulses at three levels, played on the left, right, both channels and with opposite signs." >}}

While reading about this, I noticed that papers on measurement tended to use [sine sweeps rather than impulses](https://angelofarina.it/Public/Papers/134-AES00.PDF "Farina — Simultaneous Measurement of Impulse Response and Distortion with a Swept-Sine Technique").<sup class="sidenote-number"><a href="#sidenote-2">[2]</a></sup><span class="sidenote" id="sidenote-2"><span class="sidenote-label">[2]</span> An impulse already contained every frequency, but having only one sample meant there was little energy at each frequency, so a long sweep would make the response easier to distinguish from recording noise.</span>

{{< audio src="/audio/probe-sweep.mp3" caption="A shortened logarithmic sweep." >}}

$$
Y(f)=H(f)X(f),
\qquad
H(f)=\frac{Y(f)}{X(f)}.
$$

This would work for most of the range, but if $X(f)$ was close to zero, dividing recording noise by it would make a rather impressive filter which had little to do with the program. This could be avoided with a regularized version.

$$
\hat H(f)=\frac{Y(f)X^*(f)}{|X(f)|^2+\lambda}.
$$

With enough input energy this would approximately be the same division, while $\lambda$ would limit the result elsewhere. The complex values also retain the phase, which was required given sound sent to one channel could appear in the other with a delay.

The sweep gave another measurement to compare with the impulse, but it also took much longer to play, during which the program could change its behaviour. I added steady tones at different frequencies and amplitudes, and longer tones going from quiet to loud and back, to see whether the gain changed and how long it took to do so.

{{< audio src="/audio/probe-tones.mp3" caption="The steady tones, shortened and played through both channels." >}}

{{< audio src="/audio/probe-stepped-tone.mp3" caption="A 1000 Hz tone alternating between two levels." >}}

And a multitone to check if any new frequency pops up:

{{< audio src="/audio/probe-multitone.mp3" caption="The eight-frequency multitone." >}}

And repetition to check for time-invariance:

{{< audio src="/audio/probe-repeats.mp3" caption="Three identical copies of the multitone." >}}

And I kept a section of noise aside, to test whether the extracted filter could reproduce its recorded output afterwards.

{{< audio src="/audio/probe-noise.mp3" caption="Noise covering the low, middle and high frequency ranges in sequence." >}}

## Recovering the filter

Given recording and playback were started manually, the recording first needed an offset. I had put evenly spaced clicks near the start, which I initially tried finding by correlating the recording with the original clicks. Since the filter could spread each click over time, I summed the squared samples over a window $W$ to estimate the energy around it instead,

{{< audio src="/audio/probe-sync.mp3" caption="The eight synchronization clicks." >}}

$$
e[n]=\sum_{m\in W}\left(y_L[n+m]^2+y_R[n+m]^2\right),
$$

and found the offset through

$$
\hat\tau=\arg\max_\tau\sum_n e_{\text{probe}}[n]e_{\text{recording}}[n+\tau].
$$

I applied the same offset to both channels so the delay between them was retained.

## Output

For the main surround setting, the scaled impulses were nearly identical, the combined inputs matched the sum of their separate responses, and the multitone produced almost no new frequencies. To compare the reconstructed output with the recording, I used

$$
\varepsilon=\frac{\lVert y-\hat y\rVert_2}{\lVert y\rVert_2},
$$

where $y$ was the recorded output and $\hat y$ the output produced by the extracted filter. Given the identical repeated sections already differed slightly, I compared the model's error with that difference,

$$
\varepsilon_{\text{model}}\approx\varepsilon_{\text{repeat}}\ll1.
$$

The volume-reducing mode changed its gain with amplitude and took time to restore it, while another spatial mode changed between repeats, so neither could be reproduced with a fixed convolution filter.

Recording both output channels for an impulse in each input channel gave me the four filters.

Sound also appeared in the opposite channel, quieter and slightly delayed, followed by a long tail. Together these contained the out-of-head effect I had been trying to make earlier.

To decide how much of this response to keep, I tried increasingly long filters against the noise section,

$$
\varepsilon_N=
\frac{\lVert y_{\text{noise}}-h^{(N)}*x_{\text{noise}}\rVert_2}
{\lVert y_{\text{noise}}\rVert_2},
$$

and kept the full response, which predicted the noise more accurately than the shorter versions. The response extracted from the sweep also agreed over the range where it had enough input energy.

Loading the four responses into [Saq](https://github.com/mTvare6/saqol "Saq — a real-time audio enhancer for Linux") gave me the placement I had been trying to reproduce by hand. You can try the web version [here](https://mtvare6.github.io/saqol/ "Saq — web version")

## Bibliography
