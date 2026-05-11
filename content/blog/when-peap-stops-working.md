---
title: "A WiFi outage that traced back to a 2012 cryptography conf"
date: 2026-05-11T16:07:06+05:30
description: "iwd refused to silently fall back when my campus WiFi broke. Chasing the certificate, MSCHAPv2, and the NT-hash dependency that probably caused it."
tags: ["linux", "networking", "wifi", "iwd", "eap"]
masthead_current: "blog"
draft: false
---

"Permissive fallback" is a supposed feature where standard network managers
silently downgrade your security to keep you online. Some tool like
[`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant) ignores a
rotated certificate or a deprecated hash setup without throwing a single error.
The standard assumption is that developers prioritize the appearance of
functionality over actual security.

Okay, so my WiFi broke on a Tuesday afternoon, 13:29 IST, April 22, and the
daemon I had installed specifically for its reliability couldn't reconnect.
Chasing why pulled me through multiple layers of misconfiguration involving a
rotated server certificate, a deprecated authentication method, and a hash
protocol running on borrowed time for a decade.

In a hostel with dense access-point coverage, roaming gets noisy. As you walk
between buildings, the supplicant program on your device scans for the
strongest signal and decides when to switch. Standing between several nodes all
broadcasting iitk-sec, a supplicant like
[`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant) will
oscillate between them on marginal signal differences and degrade your
connection. I had migrated my machine to
[`iwd`](https://wiki.archlinux.org/title/Iwd) (iNet Wireless Daemon) to avoid
exactly this given its [newer roaming
algorithm](https://www.youtube.com/watch?v=QIqT2obSPDk) is less twitchy.

This is the divide between permissive and strict software.
[`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant) is
permissive in that it tolerates unsafe states and insecure fallbacks to keep
the appearance of functionality. My laptop and the campus WiFi have to agree on
how to authenticate. That day, they disagreed. Because
[`iwd`](https://wiki.archlinux.org/title/Iwd) refuses unsafe fallbacks, the
connection just failed.

## Authentication

Enterprise WiFi like iitk-sec uses the [Extensible Authentication
Protocol](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol)
(EAP) for negotiation. It happens at [layer
2](https://en.wikipedia.org/wiki/Data_link_layer), so before you ever touch the
internet your laptop has to prove its identity to a central server. You have
the bouncer ([RADIUS](https://en.wikipedia.org/wiki/RADIUS)) checking
credentials against a [directory
service](https://en.wikipedia.org/wiki/Directory_service) like [Active
Directory](https://en.wikipedia.org/wiki/Active_Directory) and the tunnel
([PEAP](https://en.wikipedia.org/wiki/Protected_Extensible_Authentication_Protocol)
or
[TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS))
creating an encrypted TLS channel between your laptop and the RADIUS server.
And you have the payload, the inner method actually verifying your password.
PEAP almost always forces [MSCHAPv2](https://en.wikipedia.org/wiki/MS-CHAP).
TTLS is flexible enough to allow protocols like
[PAP](https://en.wikipedia.org/wiki/Password_Authentication_Protocol) to pass
plaintext straight down the tunnel.

## Certificate Validation

First thing I ran was `dmesg`, then `journalctl -u iwd`. The logs had the
answer in it, which I missed it the first time.

```text
PEAP: Tunnel has disconnected with alert: bad_certificate
```

My university's Computer Center's (the CC, which manages IT infra) setup guide
tells you to set the CA certificate to "Do not validate" if the system
certificate fails. `wpa_supplicant` lets you do that. `iwd` deliberately
doesn't expose the option, at least not easily. Certificate validation matters
because skipping it leaves you open to [evil-twin
attacks](https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)) where a
device faking the iitk-sec SSID can intercept your authentication and walk away
with your credentials. `iwd` enforces server-side identity verification to
prevent that. The most charitable read is that the CC had rotated the RADIUS
server certificate, and `iwd` couldn't validate the new chain against my
certificate store, so it terminated the connection.

I needed the new certificate. The usual move would be `openssl s_client`, but
EAP runs at layer 2 before the system has an IP, so there's no
[TCP](https://en.wikipedia.org/wiki/Transmission_Control_Protocol) endpoint to
query. I could have pulled the cert off another device, but `iwd` itself made
it easier. Running `iwd` with the TLS debug flag flips on certificate dumping
in its [`ell`](https://git.kernel.org/pub/scm/libs/ell/ell.git) backend, which
I got to know reading the source, and the rejected server certificate ends up
in `/tmp`.

```bash
sudo IWD_TLS_DEBUG=1 /usr/lib/iwd/iwd -d
```

After triggering a connection attempt, the fix involves moving
`iwd-tls-debug-server-cert.pem` from `/tmp` to `/etc/ssl/certs/iitk-radius.pem`
and pointing the `iwd` profile at it explicitly. Then
[NetworkManager](https://wiki.archlinux.org/title/NetworkManager) will keep
overwriting it because it's modifiable still. Once you mark the file immutable
with `chattr +i`, NetworkManager stops trying.

Restart, and the TLS tunnel comes up:

```text
TTLS: tls_rsa_verify:240 Peer signature verified
```

But the connection still dropped.

## The Protocol Shift

The real failure was deeper in the EAP negotiation:

```text
EAP server tried method 4 while client was configured for method 25 EAP completed with eapFail
```

The server rejected PEAP ([Method
25](https://www.iana.org/assignments/eap-numbers/eap-numbers.xhtml#eap-numbers-4))
and proposed EAP-MD5 (Method 4) instead. `iwd` correctly refused. In enterprise
networks, EAP-MD5 is what gets offered when nothing better matches, a default
that triggers when the server's modern config breaks. Refusing it is the right
call given EAP-MD5 has no mutual authentication. It's not particularly safe
when the server demands verification from you, and you don't get the same
right.

But why would a server that negotiated PEAP that morning suddenly reject it
that afternoon? I don't have access to the CC servers, so the exact cause isn't
confirmable. It could be a misconfigured policy update. But there is a more
interesting explanation in how PEAP authenticates the inside of its tunnel.
PEAP wraps MSCHAPv2, and to evaluate an MSCHAPv2 challenge the RADIUS backend
has to compute the response itself, which means it needs either the plaintext
password or an [NT-hash-equivalent
credential](https://en.wikipedia.org/wiki/NTLM) on hand.

Unsalted NT hashes are a well-known liability, and modern identity providers
and LDAP backends strongly prefer irreversible ones. There are caching
workarounds that keep MSCHAPv2 working in mixed environments, but the most
charitable read here is that the CC tightened backend hashing and MSCHAPv2
collapsed as a side effect. Once MSCHAPv2 is unavailable, PEAP, which has no
other inner method to fall back to, fails along with it.

## Resolution

Without MSCHAPv2, the outer method has to change. The CC guide lists TTLS as a
fallback, so I switched to
[EAP-TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS)
with PAP. PAP transmits the password as plaintext through the TLS tunnel, which
allows the server to hash it dynamically against the modern identity provider.

This shifts the security burden to the TLS tunnel. Skipping certificate
validation here hands the password to anyone running a fake AP. Since `iwd`
already forced the validation of the server's identity in the first step, the
tradeoff is safe.

Profile update:

```ini
[Security] EAP-Method=TTLS EAP-Identity=username
EAP-TTLS-Phase2-Method=Tunneled-PAP
EAP-TTLS-Phase2-Identity=username
EAP-TTLS-Phase2-Password=password
EAP-TTLS-CACert=/etc/ssl/certs/iitk-radius.pem
```

After updating the profile and restarting the service, the handshake finished
and the interface connected.

Using `wpa_supplicant` with "Do not validate" and ignoring insecure fallbacks
would have been easier. But permissive software obscures the underlying state.
`iwd` forced an evaluation of why the network dropped. Permissive software
hides broken systems, and strict software forces you to fix them.
