---
title: "Using my reMarkable as a drawing tab for my laptop"
date: 2026-10-29T20:53:00+05:30
description: "Turning a reMarkable into a low-latency drawing tab on Linux, then following the input and display queues until it became usable."
tags: ["linux", "remarkable", "vnc", "latency"]
masthead_current: "blog"
math: true
draft: false
---

I had always wanted to use my [reMarkable](https://remarkable.com/ "reMarkable — paper tablets") as a second monitor on Linux, but had always procrastinated given my other monitor. Recently I had another idea, to do the same with the pen working in [GIMP](https://www.gimp.org/ "GIMP — GNU Image Manipulation Program"), that is use it as a touch-screen, like I used my iPad with a Mac some eight years back, also like it did with the native drawing client (xochitl /ksoχɪtl/?) so I can save my notes directly on my laptop when possible. Given that writing in its native editor felt almost immediate, and the connection would be over USB, I expected drawing on it to feel fairly similar so I began hacking.

## Fixing the setup

I started with [VNSee](https://github.com/matteodelabre/vnsee/ "VNSee — a VNC client for reMarkable"), which runs a [VNC](https://www.rfc-editor.org/rfc/rfc6143 "RFC 6143 — The Remote Framebuffer Protocol") client on the tablet. On the laptop, [x11vnc](https://github.com/LibVNC/x11vnc "x11vnc — VNC server for real X displays") sends its contents of an extra X11 monitor, and pen input travels back as different mouse events.

The existing [rm2fb](https://github.com/ddvk/remarkable2-framebuffer "remarkable2-framebuffer") setup did not work with my tablet's firmware, so the client was adapted to use the native [SWTCON implementation](https://github.com/timower/rM2-stuff/tree/451577081b9eaa3d582e50bbca8c4adfd4911b53/libs/swtcon "SWTCON implementation in rM2-stuff") from [rM2-stuff](https://github.com/timower/rM2-stuff "rM2-stuff").

After fixing issues with default vnc setup like rotation, monitor placement and missing cursor, I could move a window onto it through [dwm](https://dwm.suckless.org/ "dwm — dynamic window manager") with the pen contact being held stand for the left mouse button for drawing, while fingers could tap without moving the pointer.<sup class="sidenote-number"><a href="#sidenote-1">[1]</a></sup><span class="sidenote" id="sidenote-1"><span class="sidenote-label">[1]</span> The pen being held slightly over the monitor still was still detected, in ways my hand wasn't.</span>

When I finally held the pen down to draw, the line took roughly a second to appear. So I started looking for places to optimise.

## Measuring it

I decided to profile it manually through timestamps adding them across the input, VNC, application and display layers.

The first test used a temporary X11 window which drew black dots as soon as it received input. Given GIMP could also spend time processing the brush, this let me test the display path without it. Some strokes and short taps were sent through the tablet's actual [input device](https://www.kernel.org/doc/html/latest/input/event-codes.html "Linux input event codes"), at about $50$ reports per second.

The [SSH tunnel](https://man.openbsd.org/ssh#R "OpenSSH remote port forwarding") loopback latency was about $0.8\,\mathrm{ms}$. Input management was relatively cheap, so it wasn't really a bottleneck either.

The client did, however, wait $50\,\mathrm{ms}$ between drawing refreshes and $400\,\mathrm{ms}$ between normal updates. Lifting the pen immediately restored normal mode, so even the pixels from a short tap could return after it had switched to the slower interval.

Similarly, the display backend was not using the driver's `FastDraw` flag. The [native rendering pipeline docs](https://github.com/timower/rM2-stuff/blob/451577081b9eaa3d582e50bbca8c4adfd4911b53/doc/RENDERING_PIPELINE.md) described a pen path using it, which allowed overlapping asynchronous updates to avoid waiting for an earlier waveform to finish. The backend was changed to use it, with an $8\,\mathrm{ms}$ drawing interval, and cleanup left until the pen was away and interaction had been idle for $800\,\mathrm{ms}$, much like the native rendering de-bouncing on xochitl.

The USB SSH listener also had `NoDelay=no`, allowing batching of [packets](https://datatracker.ietf.org/doc/html/rfc896 "RFC 896 — Congestion Control in IP/TCP Internetworks"). I'd also managed to reduce some further overhead enabling damage tracking through [XDamage](https://www.x.org/releases/current/doc/damageproto/damageproto.txt "X Damage Extension Protocol") and have separate threads for input and output. Surprising using lossless compression when sending also helped with the latency.

Median input delay:

```text
Before: ~21 ms
After:   ~3 ms
```

Longest wait after drawing submission (leaving the rendering on rM2 out):

```text
Before: 193 ms
After:   14 ms
```

## And now lines

This reduced the inherent latency and rendering optimization work I expected, but lines were still slower for some reason.

I had the test changed to send $960$ drag-draw event over $4$ seconds, while holding the button down throughout. Repeating it after the server changes and then the client changes would let me compare their effects.

This time, the input reached the host sometimes about $350\,\mathrm{ms}$ late, and only $11$ drawing updates were submitted over the stroke and the following some seconds. Given the mouse events were forwarded to X11 by [x11vnc's pointer handler](https://github.com/LibVNC/x11vnc/blob/master/src/pointer.c), I tried looking up for it's [configuration around dragging](https://github.com/LibVNC/x11vnc/blob/master/src/help.c) and found that it had heuristics for dragging windows and copying scrolled regions, which, along with its input scheduling, got in the way of capturing changes while the button was held down. Disabling them with

```bash
-nowireframe -noscrollcopyrect -noxrecord -input_skip 1
```

brought the count to $315$ drawing submissions for the same stroke.

## Following the queue

The tablet client read only one queued pen report before returning to display work ([pen handler](https://github.com/matteodelabre/vnsee/blob/6ed9593769471133d9602108ce6855dd53d54931/src/app/pen.cpp#L22-L26) and [input reader](https://github.com/matteodelabre/vnsee/blob/6ed9593769471133d9602108ce6855dd53d54931/src/rmioc/input.cpp#L163-L169)), so reports could build up while it was busy with an update. It was changed to read them in bounded batches by looping over `device.process_events()` in `app::pen::process_events()`, stopping when the queue was empty or after $128$ reports (given $128>960/11$) or about $8\,\mathrm{ms}$.

There was a similar problem with [`LibVNCClient`](https://github.com/LibVNC/libvncserver "LibVNCServer and LibVNCClient").

Its [socket reader](https://github.com/LibVNC/libvncserver/blob/2aa20dad4c23c18948d3f63b33f9dfec1f837729/libvncclient/sockets.c#L126-L183) could already have read bytes from the next framebuffer update message into its own buffer, when VNSee's loop only checked whether the socket was readable. Given these bytes had already been read from the socket into LibVNCClient's buffer, the client would only be able to process the first screen update and wait for more network data to come through before it's run again and catch up.

And I changed it to check `vnc_client->buffered` too, so it could process already-received updates without waiting for more network traffic. Along with reading pen reports in batches, this gave

Count of submissions over the stroke and some time afterward to pad:

```text
Before: 315 submissions
After:  386 submissions
```

Comparing a larger region took more time too, as the code extended the damaged rectangle for every changed pixel. Finding the first and last changed pixel in each row was enough to extend it once per row instead.

The earlier input delays scaled to a stroke across the whole screen:

```text
E[Before]: 94 ms
E[After]:  44 ms
```

which is more given the damage tracking work done.

## Output

Trying it on the tablet again, I could finally draw normally in GIMP without waiting for the line to catch up, including when I kept the pen held down.
A recording of the buffer rendered by the buffer before and after can be found side-by-side.

{{< video-comparison before="/videos/remarkable-before.mp4" after="/videos/remarkable-after.mp4" >}}

## Bibliography
