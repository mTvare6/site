---
title: "When Peap Stops Working"
date: 2026-05-11T16:07:06+05:30
description: "iwd refused to silently fall back when my campus WiFi broke. Chasing the certificate, MSCHAPv2, and the NT-hash dependency that probably caused it."
tags: ["linux", "networking", "wifi", "iwd", "eap"]
masthead_current: "blog"
draft: false
---

My WiFi broke on a Tuesday afternoon, 13:29 IST, April 22, and the
daemon I'd installed specifically for its reliability couldn't
reconnect. Chasing why pulled me through three layers of
misconfiguration: a rotated server certificate, a deprecated
authentication method, and a hash protocol that's been on
borrowed time for a decade. Permissive software would have kept me
online without ever telling me any of this had happened.

In a hostel with dense access-point coverage, roaming gets noisy. As
you walk between buildings, the *supplicant* program on your device
scans for the strongest signal and decides when to switch. Standing
between several nodes all broadcasting `iitk-sec`, a supplicant like
[`wpa_supplicant`](https://wiki.archlinux.org/title/Wpa_supplicant)
will oscillate between them on marginal signal differences and
degrade your connection. I had migrated my machine to
[`iwd`](https://wiki.archlinux.org/title/Iwd) (iNet Wireless Daemon)
to avoid exactly this, its
[newer roaming algorithm](https://www.youtube.com/watch?v=QIqT2obSPDk)
is less twitchy.

This is the divide between permissive and strict software.
`wpa_supplicant` is permissive: it tolerates unsafe states and
insecure fallbacks to keep the appearance of functionality. `iwd` is
strict, a rigid state machine that halts the moment something
doesn't match.

In simpler terms: my laptop and the campus WiFi have to agree on how
to authenticate. That day, they disagreed. Because `iwd` refuses
unsafe fallbacks, the connection just failed.

## How campus WiFi authenticates you

Enterprise WiFi like `iitk-sec` uses the
[Extensible Authentication Protocol (EAP)](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol)
for negotiation. It happens at
[layer 2](https://en.wikipedia.org/wiki/Data_link_layer), so before
you ever touch the internet your laptop has to prove its identity to
a central server. Three pieces are in play:

**The bouncer ([RADIUS](https://en.wikipedia.org/wiki/RADIUS)).** The
server that checks your credentials against an identity store such
as a [directory service](https://en.wikipedia.org/wiki/Directory_service)
like [Active Directory](https://en.wikipedia.org/wiki/Active_Directory).

**The tunnel (PEAP or TTLS).** An encrypted TLS channel between your
laptop and the RADIUS server, like HTTPS, but for the
authentication handshake.
[PEAP](https://en.wikipedia.org/wiki/Protected_Extensible_Authentication_Protocol)
and [TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS)
are the two common choices.

**The payload (the inner method).** A second protocol that runs
inside that tunnel and actually verifies your password. PEAP almost
always uses [MSCHAPv2](https://en.wikipedia.org/wiki/MS-CHAP), a
cryptographic challenge–response. TTLS is more flexible and supports
methods like
[PAP](https://en.wikipedia.org/wiki/Password_Authentication_Protocol),
which transmits the password as plaintext inside the tunnel.

## The certificate validation failure

Checking the kernel logs revealed the first issue:

```text
PEAP: Tunnel has disconnected with alert: bad_certificate
```

The CC's setup guide tells you to set the CA certificate to "Do not
validate" if the system certificate fails. `wpa_supplicant` lets you
do that. `iwd` deliberately doesn't expose the option, at least not
easily.

Certificate validation matters because skipping it leaves you open
to [evil-twin attacks](https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)):
a device faking the `iitk-sec` SSID can intercept your
authentication and walk away with your credentials. `iwd` enforces
server-side identity verification to prevent that.

The most charitable read is that the CC had rotated the
[RADIUS](https://en.wikipedia.org/wiki/RADIUS) server certificate,
and `iwd` couldn't validate the new chain against my certificate
store, so it terminated the connection.

## Extracting the certificate

I needed the new certificate. The usual move would be
`openssl s_client`, but EAP runs at layer 2, before the system has
an IP, so there's no
[TCP](https://en.wikipedia.org/wiki/Transmission_Control_Protocol)
endpoint to query. I could have pulled the cert off another device,
but `iwd` itself made it easier.

Running `iwd` with the TLS debug flag flips on certificate dumping
in its [`ell`](https://git.kernel.org/pub/scm/libs/ell/ell.git)
backend, and the rejected server certificate ends up in `/tmp`:

```bash
sudo IWD_TLS_DEBUG=1 /usr/lib/iwd/iwd -d
```

After triggering a connection attempt, the fix is three steps:

1. Move `iwd-tls-debug-server-cert.pem` from `/tmp` to
   `/etc/ssl/certs/iitk-radius.pem`.
2. Point the `iwd` profile at it explicitly.
3. Mark the file immutable with `chattr +i` so
   [NetworkManager](https://wiki.archlinux.org/title/NetworkManager)
   (which I still run on top of `iwd`) can't overwrite it.

Restart, retry, and the TLS tunnel comes up:

```text
TTLS: tls_rsa_verify:240 Peer signature verified
```

But the connection still dropped.

## The protocol shift

The real failure was deeper in the EAP negotiation:

```text
EAP server tried method 4 while client was configured for method 25
EAP completed with eapFail
```

The server rejected PEAP
([Method 25](https://www.iana.org/assignments/eap-numbers/eap-numbers.xhtml#eap-numbers-4))
and proposed EAP-MD5 (Method 4) instead. `iwd` correctly refused.
In enterprise networks, EAP-MD5 is what gets offered when nothing
better matches, a default that triggers when the server's modern
config breaks. Refusing it is the right call, EAP-MD5 has no mutual
authentication. The server can verify you, but you can't verify the
server.

But why would a server that negotiated PEAP that morning suddenly
reject it that afternoon?

I don't have access to the CC servers, so the exact cause isn't
confirmable. It could be a misconfigured policy update. But there's
a more interesting explanation in how PEAP authenticates the inside
of its tunnel. PEAP wraps MSCHAPv2, and to evaluate an MSCHAPv2
challenge the RADIUS backend has to compute the response itself,
which means it needs either the plaintext password or an
[NT-hash-equivalent credential](https://en.wikipedia.org/wiki/NTLM)
on hand.

Unsalted NT hashes are a well-known liability, and modern identity
providers and LDAP backends strongly prefer irreversible ones. There
are caching workarounds that keep MSCHAPv2 working in mixed
environments, but the most charitable read here is that the CC
tightened backend hashing and MSCHAPv2 collapsed as a side effect.
Once MSCHAPv2 is unavailable, PEAP, which has no other inner method
to fall back to, fails along with it.

## The TTLS-PAP solution

If MSCHAPv2 is gone, the only remaining option is to switch outer
methods. The CC's own guide already lists TTLS as a fallback, so I
switched to
[EAP-TTLS](https://en.wikipedia.org/wiki/Extensible_Authentication_Protocol#EAP-TTLS)
with [PAP](https://en.wikipedia.org/wiki/Password_Authentication_Protocol)
inside. PAP transmits the password as plaintext through the TLS
tunnel, which lets the server hash it on the fly and compare against
whatever the modern IdP stores.

The catch: this shifts the *entire* security burden onto the TLS
tunnel. Skip certificate validation and you're handing your password
to anyone running a fake AP. But because `iwd` had already forced me
to validate the server's identity in step one, the tradeoff was
actually safe.

Updating the `iwd` profile:

```ini
[Security]
EAP-Method=TTLS
EAP-Identity=username
EAP-TTLS-Phase2-Method=Tunneled-PAP
EAP-TTLS-Phase2-Identity=username
EAP-TTLS-Phase2-Password=password
EAP-TTLS-CACert=/etc/ssl/certs/iitk-radius.pem
```

Restart the service. The handshake completes. The interface
transitions to connected.

## Conclusion

Using `wpa_supplicant` with "Do not validate" and letting it
silently sleepwalk through insecure fallbacks would have been
easier. But permissive software obscures the underlying reality.

`wpa_supplicant` would have kept me online. `iwd` forced me to
understand *why* I wasn't.

Because `iwd` enforces a strict state machine instead of falling
back to insecure defaults, it forced me to look at the actual
exchange — and what came out was a clear picture of what had shifted
on the other end.

*Permissive software hides broken systems. Strict software forces
you to fix them.*
