# Web Demo Docs

This directory is the public documentation entry point for agents working in
`web-demo-v2`. The README at the repo root explains what the demo is; these
docs explain how to change, validate, and reason about it without tripping over
the runtime, Paper parity, or local relay constraints.

## Recommended Read Order

1. `../README.md` - product summary, implemented flows, setup commands, and
   the boundary between real routes and the mock demo gallery.
2. `agent-runbook.md` - first inspection pass, safe edit boundaries, route
   orientation, local relay caveats, and docs-only validation commands.
3. `web-demo-architecture.md` - layered runtime model, app-state boundaries,
   data flows, persistence rules, dashboard derivation, and test surfaces.
4. `outside-runtime-flow-invariants.md` - security and phase-gating rules for
   create/import/onboard/rotate/replace/recover/backup flows.
5. `runtime-deviations-from-paper.md` - deviation ledger for places where the
   live runtime cannot exactly match the Paper design or validation wording.
6. `allowed-console-warnings.md` - console policy and the lightweight
   lint/format contract.
7. `followup-paper-parity-report.md` - focused audit notes for the
   create-profile/distribute/complete follow-up parity pass.

## What To Read For Common Tasks

| Task | Start with | Also read |
| --- | --- | --- |
| Make a UI/screen change | `web-demo-architecture.md` | `runtime-deviations-from-paper.md`, sibling `../igloo-paper/screens/...` |
| Change setup-flow behavior | `outside-runtime-flow-invariants.md` | `web-demo-architecture.md` |
| Work on runtime status, policies, approvals, or relay behavior | `web-demo-architecture.md` | `agent-runbook.md`, relevant deviation entries |
| Update docs only | `agent-runbook.md` | `allowed-console-warnings.md` for validation command choices |
| Validate Paper parity | `followup-paper-parity-report.md` | `runtime-deviations-from-paper.md`, `src/demo/scenarios.ts` |
| Investigate multi-device e2e | `agent-runbook.md` | `.factory/library/user-testing.md` for detailed validator notes |

## Canonical Sources

- **Routes**: `src/app/CoreRoutes.tsx`; mock gallery scenarios live in
  `src/demo/scenarios.ts`.
- **Runtime architecture**: `src/app/AppStateProvider.tsx`,
  `src/lib/bifrost/runtimeClient.ts`, and `src/lib/relay/runtimeRelayPump.ts`.
- **Public app-state API**: import from `src/app/AppState.tsx` at app edges;
  type definitions live in `src/app/AppStateTypes.ts`.
- **Design reference**: sibling `../igloo-paper/` is the source of truth for
  Paper screens and screenshots. Treat it as read-only from this workspace.
- **Protocol reference**: sibling `../bifrost-rs/` is the source of truth for
  Rust/WASM runtime behavior. Treat it as read-only unless the task explicitly
  asks for protocol work.
- **Vendored WASM**: `src/vendor/bifrost-bridge-wasm/` is refreshed only via
  `npm run wasm:build`; never hand-edit generated files there.
- **Internal validator notes**: `.factory/library/` contains useful mission and
  validation context. Promote only durable, broadly useful guidance into
  `docs/` when updating public docs.

## Agent Guardrails

- Keep docs-only tasks limited to `README.md` and `docs/*.md` unless the user
  explicitly expands the scope.
- Do not store raw shares, passwords, recovered `nsec` values, decoded setup
  payloads, or private-key material in docs examples, storage, router state, or
  logs.
- Prefer verification commands that do not rebuild vendored WASM for docs and
  refactor-only work.
- If a claim depends on current route names, scripts, scenario ids, or runtime
  source shape, verify it from the repo before documenting it.
