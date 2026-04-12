# Troubleshooting

This document captures debugging notes for issues that are easy to rediscover
and expensive to re-derive under time pressure.

## Desktop startup times out at `http://127.0.0.1:3773`

Symptom in the desktop popup:

```text
T3 Code failed to start
Stage: bootstrap
Timed out waiting for backend readiness at http://127.0.0.1:3773.
```

Typical matching log lines:

```text
[desktop] backend exited unexpectedly (code=1 signal=null); restarting in 500ms
[desktop] fatal startup error (bootstrap) Error: Timed out waiting for backend readiness at http://127.0.0.1:3773.
```

### What this usually means

The timeout is usually a secondary failure, not the root cause.

The desktop app starts the backend as a child process and waits for the backend
HTTP server to answer at `http://127.0.0.1:3773/api/auth/session`. If the
backend crashes before it starts listening, desktop bootstrap eventually times
out and shows the popup above.

Relevant code:

- `apps/desktop/src/main.ts`
- `apps/desktop/src/backendReadiness.ts`

## `node-pty` native module missing on Linux

One concrete cause we hit was `node-pty` failing to load its native addon:

```text
Error: Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64
```

In this repo the server imports `node-pty` from:

- `apps/server/src/terminal/Layers/NodePTY.ts`

When `node-pty` cannot load `pty.node`, the backend exits during startup. That
backend crash is what causes the later desktop timeout at `127.0.0.1:3773`.

### Why Linux needs a local build

For `node-pty@1.1.0`, the package install script is effectively:

```text
node scripts/prebuild.js || node-gyp rebuild
```

On Linux, this package version does not include `prebuilds/linux-x64`, so the
prebuild check fails and the package falls back to compiling locally with
`node-gyp`.

That means Linux installs depend on a working native build environment, even if
macOS or Windows may use shipped prebuilds.

### Required tools

The minimum prerequisites we confirmed for a successful local rebuild were:

- `python3`
- `make`
- `g++`
- `node-gyp`

If `node-gyp` is missing from `PATH`, Bun install can fail like this:

```text
> Rebuilding because directory .../prebuilds/linux-x64 does not exist
/usr/bin/bash: line 1: node-gyp: command not found
error: install script from "node-pty" exited with 127
```

### Recovery steps

From the repo root:

```bash
npm install -g node-gyp
bun install --force --filter=t3
bun run start:desktop
```

### How to verify the rebuild worked

The rebuild should produce:

```text
node_modules/.bun/node-pty@1.1.0/node_modules/node-pty/build/Release/pty.node
```

Once that file exists, desktop startup should get past the readiness timeout and
the backend should log:

```text
Listening on http://127.0.0.1:3773
```

### Notes from this incident

- `node-pty` is the correct dependency for this repo. The problem was not the
  package choice; it was an incomplete native install.
- The repo already marks `node-pty` as trusted in the root `package.json`, but
  trusted lifecycle scripts still need the required native build tools to exist.
- The DBus warning and the Wayland/Vulkan warning were not the root cause for
  this incident. They still appeared on a successful run.
- The most useful debugging move was to treat the popup timeout as a downstream
  symptom and inspect the backend crash immediately before it.
