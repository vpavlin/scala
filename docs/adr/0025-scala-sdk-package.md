# 25. The mobile engine is a separate package: scala-sdk

- **Status:** accepted
- **Date:** 2026-10-10

## Context

[`docs/sdk.md`](../sdk.md) presents Scala as an SDK, but its TypeScript half lived in the app at
`mobile/src/lib`, so another app (Frequencies first) could only use it by copying files. Copies drift,
and the fold must stay byte-identical to the C++ one.

## Decision

- The contents of `mobile/src/lib` move, with their history, to
  [`vpavlin/scala-sdk`](https://github.com/vpavlin/scala-sdk). loam-transport becomes the SDK's own
  submodule.
- The Scala app mounts the SDK as a git submodule **at the same path** (`mobile/src/lib`), so its
  imports, tests, and the Expo plugin path don't change. Clones need `--recursive`.
- App-specific code stays in the app: notifications and the home-screen widget move to `mobile/src/app/`.
- Other apps mount the SDK the same way and list its `peerDependencies`.
- The parity tests stay here: they compile this repo's C++ fold against the SDK's `engine.ts`. A fold
  change is made in both repos in one go: the SDK commit first, then the Scala commit that bumps the
  submodule and passes `npm test`.

## Consequences

- One copy of the engine for every app; a fix lands everywhere by bumping the submodule.
- Changing the library now takes two commits (SDK, then the submodule bump in each app).
- The desktop half is unchanged: the `scala` Basecamp core module.
