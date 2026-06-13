# apps/desktop — Phase B placeholder

This directory is an intentional empty placeholder for the **Phase B** Electron +
Steam desktop SKU (BUILD_SPEC §14). It is not built in Phase A.

When Phase B begins, this app will:

- Wrap the same `@nocturne/client` bundle in an Electron shell.
- Use `steamworks.js` for Steam auth session tickets, rich presence, friend
  invites, and achievements — all behind the `@nocturne/shared` `platform.ts`
  interface (§14), so client code never imports `steamworks` directly.
- Pin the Electron version (overlay regressions); use the in-process-GPU flag
  path; defer the macOS SKU until after Steam-Windows traction.

Nothing here is wired into the pnpm workspace build yet. Do not add Phase B
dependencies before Phase A has a living population.
