# ADR 0022: Loam identities per calendar, and invite tickets

Status: **Accepted** (2026-10-05). Builds on loam-keycard ADR 0001 (one root, unlinkable identities) and ADR 0019 (roles).

## Context

- **Calendar identities.** Loam now holds one root per person and derives a separate identity per (app, space) plus one shared "main" identity. Scala should sign each calendar's events with one of those, so that unrelated calendars can't be linked, while a family calendar can use the identity your family knows.
- **Roles.** Giving someone a role today needs their address, and with per-calendar identities nobody knows that address in advance.

## Decision

### 1. Which identity a calendar uses

- When you create or join a calendar and Loam has a root, Scala asks: **"Appear as: a new identity just for this calendar"** (the default) **or "my main identity"**.
  - The choice is stored as the calendar's binding: `loam:ctx` uses Loam identity (app `scala`, context = calendar id); `loam:main` uses the main identity.
  - Signing goes to Loam: `loamSign(contextId, digest)` on Android, `loam_core.hdSign("scala", contextId, digest)` on Basecamp.
- **Existing calendars keep the identity they were bound to.** Switching would cost your role there.
- **Without a Loam root**, nothing changes: the device / soft / Keycard identities work as before.

### 2. Invite tickets

An invite link is the normal join link plus `inv=<ticket private key, 64 hex>`. The ticket is a one-time secp256k1 key made for this invite.

| Event | Payload | Admitted when |
|---|---|---|
| `member.invite` | `{ticket, role}`<br>`ticket` = address of the ticket key<br>`role` = `editor` \| `viewer` \| `revoke` | The author is the owner or an editor (same rule as `member.set`), and the ticket is not yet redeemed. |
| `member.claim` | `{ticket, ticketPub, member, ticketSig}` | All of:<br>• `member` == the signed author<br>• `member` ≠ owner<br>• the ticket is pending and unredeemed<br>• `address(ticketPub)` == `ticket`<br>• `ticketSig` is a **low-S** secp256k1 signature by `ticketPub` over `sha256("scala-invite-claim-v1|" + calId + "|" + ticket + "|" + member)` |

Rules:

- **The first valid claim in HLC order wins.** The member gets the offered role and the ticket is redeemed; later claims are ignored.
- **Revoking an already-redeemed ticket does nothing.** Use `member.set {role: "remove"}` instead.
- **Folded state** gains `invites: {ticket → role}` for pending tickets, so owners can see and revoke them.

**Why a ticket signature:** `member.invite` is visible to every member, because the log is shared. Only someone holding the ticket's private key, i.e. the link, can claim it.

**Why low-S:** the phone's verifier rejects the high-S twin of a signature and OpenSSL accepts it, so the desktop enforces low-S explicitly. Without that, a crafted claim would count on one platform and not the other.

**Why the joiner never has to send you their address:** they claim under whatever identity they chose for this calendar.

### 3. Adding someone by identity

Besides tickets, the owner or an editor can paste a person's identity link (`loam://id?pub=<66 hex>`), or a plain address. The address is computed from the key, so a typo cannot grant a role to nobody. The app then posts the existing `member.set`.

## Consequences

- Both folds (`mobile/src/lib/engine.ts`, `src/scala_engine.hpp`) implement the rules identically.
- `mobile/test/invites-fold.sh` checks:
  - parity between the two engines;
  - 17 outcome checks: valid claims, double claims, a wrong ticket key, claiming for someone else, revoked tickets, an outsider's invite, high-S, and a claim that arrives before its invite;
  - convergence under 300 shuffled and duplicated arrival orders.
- **Older clients** ignore the two new event types (the folds skip unknown types). On such a client, someone who joined by ticket shows up without a role until the client is updated.
- **An invite link is a bearer secret:** whoever opens it first gets the role. Share it like the calendar link, and revoke tickets that went unused.
