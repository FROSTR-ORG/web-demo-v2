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
4. `demo-scenario-guide.md` - how `/demo/:scenarioId` fixtures, Paper
   references, variants, and the demo-to-product bridge work.
5. `outside-runtime-flow-invariants.md` - security and phase-gating rules for
   create/import/onboard/rotate/replace/recover/backup flows.
6. `runtime-deviations-from-paper.md` - deviation ledger for places where the
   live runtime cannot exactly match the Paper design or validation wording.
7. `allowed-console-warnings.md` - console policy and the lightweight
   lint/format contract.
8. `followup-paper-parity-report.md` - focused audit notes for the
   create-profile/distribute/complete follow-up parity pass.

## What To Read For Common Tasks

| Task | Start with | Also read |
| --- | --- | --- |
| Make a UI/screen change | `web-demo-architecture.md` | `runtime-deviations-from-paper.md`, sibling `../igloo-paper/screens/...` |
| Add or audit a `/demo` scenario | `demo-scenario-guide.md` | `src/demo/scenarios.ts`, `src/demo/__tests__/scenarios.test.tsx` |
| Change setup-flow behavior | `outside-runtime-flow-invariants.md` | `web-demo-architecture.md` |
| Work on runtime status, policies, approvals, or relay behavior | `web-demo-architecture.md` | `agent-runbook.md`, relevant deviation entries |
| Update docs only | `agent-runbook.md` | `allowed-console-warnings.md` for validation command choices |
| Validate Paper parity | `demo-scenario-guide.md` | `agent-runbook.md`, `runtime-deviations-from-paper.md`, `src/demo/scenarios.ts` |
| Investigate multi-device e2e | `agent-runbook.md` | `.factory/library/user-testing.md` for detailed validator notes |

## Validation By Change Type

| Change type | Focused validation |
| --- | --- |
| Docs-only | `rg -n 'T[O]DO\|T[B]D\|F[I]XME' README.md docs/*.md`; `git diff --stat`; targeted link/source checks from `agent-runbook.md`. |
| Demo fixture or Paper-reference change | `npm run paper:sync`; `npm run paper:drift -- --threshold=0.02`; `npx vitest run src/demo/__tests__/scenarios.test.tsx src/demo/__tests__/crossAreaFinalGate.test.tsx --config vitest.config.ts`. |
| Paper parity UI split | Focused screen tests for the product/demo boundary; `npm run paper:drift:live` for a ranked live-DOM queue; raw `npm run paper:drift -- --threshold=0.02` after any Paper sync. |
| TypeScript UI/refactor change | `npx tsc --noEmit -p tsconfig.json --pretty false`; `npx vitest run --config vitest.config.ts` or narrower related tests. |
| Multi-device/runtime change | Relevant `src/e2e/multi-device/*.spec.ts` with `--project=desktop --workers 1`, plus the local relay notes in `agent-runbook.md`. |
| Dashboard real-peer workability | `npm run test:e2e:dashboard-real-peers`; this starts `bifrost-devtools` on `ws://127.0.0.1:8194` and verifies dashboard states, event logs, policies, sign/ECDH/ping, and permission feedback against real peers. |

## Canonical Sources

- **Routes**: `src/app/CoreRoutes.tsx`; mock gallery scenarios live in
  `src/demo/scenarios.ts`.
- **Runtime architecture**: `src/app/AppStateProvider.tsx`,
  `src/lib/bifrost/runtimeClient.ts`, and `src/lib/relay/runtimeRelayPump.ts`.
- **Public app-state API**: import from `src/app/AppState.tsx` at app edges;
  type definitions live in `src/app/AppStateTypes.ts`.
- **Design reference**: sibling `../igloo-paper/` is the source of truth for
  Paper screens and screenshots. Read it by default; modify and export it only
  when the active task explicitly names Paper as the fix source.
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
- When adding a new durable workflow note, place it in the broadest useful doc:
  architecture for ownership/data flow, scenario guide for `/demo`, invariants
  for security boundaries, and deviation ledger only for intentional
  runtime-vs-Paper differences.
