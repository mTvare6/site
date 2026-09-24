---
title: "A WiFi outage and its relation to a DEF CON 20 talk"
date: 2026-05-11T16:07:06+05:30
description: "iwd refused to silently fall back when my campus WiFi broke. Chasing the certificate, MSCHAPv2, and the NT-hash dependency that probably caused it."
tags: ["linux", "networking", "wifi", "iwd", "eap"]
masthead_current: "blog"
draft: false
---

On April 22, Tuesday, 13:29 IST, my WiFi broke. </br>
This was unexpected since I had switched from my older
[`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant) setup to
[`iwd`](https://wiki.archlinux.org/title/Iwd) in the to avoid the frequent
disconnection that happens. I live in a hostel with a lot of access points and
the supplicant program decides when to switch as one moves around. A supplicant
like [`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant)
oscillates between points on marginal signal differences and leaves me
disconnected for some time . I migrated to
[`iwd`](https://wiki.archlinux.org/title/Iwd) to avoid this given its [better
roaming algorithm](https://www.youtube.com/watch?v=QIqT2obSPDk) which is less
twitchy.

## How enterprise WiFi authentication works

Enterprise WiFi like iitk-sec uses the [Extensible Authentication
Protocol](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol)
(EAP) for negotiation. It happens at [layer
2](https://en.wikipedia.org/wiki/Data_link_layer), and thus the laptop has to
prove its identity to the server before it connects with the general internet
Then there is the bouncer ([RADIUS](https://en.wikipedia.org/wiki/RADIUS))
checking credentials against a [directory
service](https://en.wikipedia.org/wiki/Directory_service) like [Active
Directory](https://en.wikipedia.org/wiki/Active_Directory) and the tunnel
([PEAP](https://en.wikipedia.org/wiki/Protected_Extensible_Authentication_Protocol)
or
[TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS))
creating an encrypted TLS channel between the laptop and the RADIUS server. And
the there is the payload, the inner method actually verifying the password.
PEAP almost always forces [MSCHAPv2](https://en.wikipedia.org/wiki/MS-CHAP) as
it's used in my school. TTLS is flexible enough to allow protocols like
[PAP](https://en.wikipedia.org/wiki/Password_Authentication_Protocol) to pass
plaintext straight down the tunnel.

## Certificate issues

To check why I wasn't connecting, the first thing I ran was `dmesg`, then
`journalctl -u iwd`. The logs had some answer in it, which I missed earlier.

```text
PEAP: Tunnel has disconnected with alert: bad_certificate
```

My school's Computer Center's (the CC, which manages infra) setup guide states
to set the CA certificate to "Do not validate" if the system certificate fails.
`wpa_supplicant` lets you do that but `iwd` deliberately doesn't expose the
option, at least not easily. I didn't want to skip certificate validation as
that would leave me susceptible to [evil-twin
attacks](https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)) which is
when a device faking the iitk-sec SSID intercepts authentication and walks away
with the credentials. `iwd` is safer in this regard, enforcing server-side
identity verification. So what cound be the problem here? Among other things, I
guessed that the CC had changed the RADIUS server certificate, because of which
'iwd' couldn't validate my connection as before.

I needed the new certificate then. I had some options at my hand, running
`openssl s_client`, but that didn't work as EAP runs at layer 2 which is before
the system has an IP, so there's no
[TCP](https://en.wikipedia.org/wiki/Transmission_Control_Protocol) endpoint to
query. Or I could have pulled the cert off another device, but `iwd` itself
made it easier. 

Running `iwd` with the TLS debug flag enables certificate dumping due to its
[`ell`](https://git.kernel.org/pub/scm/libs/ell/ell.git) backend, which I got
to know reading the source, and the rejected server certificate ends up in
`/tmp`.

```bash
sudo IWD_TLS_DEBUG=1 /usr/lib/iwd/iwd -d
```

The fix involved moving `iwd-tls-debug-server-cert.pem` from `/tmp` to
`/etc/ssl/certs/iitk-radius.pem` and pointing the `iwd` profile at it
explicitly. Though
[NetworkManager](https://wiki.archlinux.org/title/NetworkManager) kept
overwriting it which stopped once I marked the file immutable with `chattr +i`.
I restarted, and the TLS tunnel came up 

```text
TTLS: tls_rsa_verify:240 Peer signature verified
```

## Protocols switcheroo

I looked deeper and found more issues. Now with the EAP negotiation.

```text
EAP server tried method 4 while client was configured for method 25 EAP
completed with eapFail
```

The server was rejecting PEAP ([Method
25](https://www.iana.org/assignments/eap-numbers/eap-numbers.xhtml#eap-numbers-4))
and proposing EAP-MD5 (Method 4) instead. `iwd` refused it, as it isn't
particularly safe. (EAP-MD5 gets offered when nothing better is available)

The server was negotiating PEAP early morning. I don't have access to the CC
servers, so the exact cause isn't confirmable. However, I found a detail in
PEAP authentication that might have been causing the issue.

The RADIUS backend has to compute the response for the MSCHAPv2 challenge,
which means it requires either the plaintext password or an [NT-hash-equivalent
credential](https://en.wikipedia.org/wiki/NTLM) on hand. MSCHAPv2 challenges
are two one, and the device solves a challenge sending both the answer and
password. And since this can't work with one-way passwords, the RADIUS server
had to have stored plaintext or unsalted NT-hashed passwords. The CC probably
tightened backend hashing, unsalted NT hashes are a well-known liability. This
could have led to MSCHAPv2, and thus PEAP being disallowed. More details on how
MSCHAPv2 was broken can be found in this
[DEF CON 20 talk](https://www.youtube.com/watch?v=gkPvZDcrLFk).

## Resolve

So, MSCHAPv2 had to be scrapped, and PEAP with it. The CC guide lists TTLS as a
fallback, so I switched to
[EAP-TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS)
with PAP. PAP also skips certificate validation, as it work by transmitting the
password as plaintext along the TLS tunnel, but since `iwd` already forces the
validation of the server's identity in the first step, it's should be fine.

Profile update

```ini
[Security]
EAP-Method=TTLS EAP-Identity=username
EAP-TTLS-Phase2-Method=Tunneled-PAP EAP-TTLS-Phase2-Identity=username
EAP-TTLS-Phase2-Password=password
EAP-TTLS-CACert=/etc/ssl/certs/iitk-radius.pem
```

After updating the profile and restarting the service, the handshake finished
and the interface connected.

Surely, it would have been easier to use `wpa_supplicant` with "Do not
validate" and ignore the insecure fallbacks. But then I wouldn't have gotten to
deepdive into network fundamentals. `iwd` forced me to fix and understand the
broken system by being less permisive.
