---
name: ui-builder
description: Builds React screen components from Paper design references with navigation wiring and CSS styling
---

# UI Builder

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for any feature that involves creating new screen components, modifying existing screens, adding routes, creating UI components, or wiring navigation. This covers all features in the Igloo Web Demo V2 UI mission.

## Validation Context (IMPORTANT)

All fidelity assertions in this mission are validated against the **DemoGallery** at `http://127.0.0.1:5173/demo/{scenario-id}` — NOT the main app. Every screen you build or modify must be reachable through a scenario entry in `web-demo-v2/src/demo/scenarios.ts`. If a feature asks you to adapt screens that don't yet have scenarios (e.g. the rotate-keyset adaptation scenarios), you must also add those entries to `scenarios.ts` so validators can navigate to them.

Expected copy in the validation contract is quoted directly from `igloo-paper/screens/{flow}/{screen}/screen.html`. Match that copy character-for-character for headings, labels, CTAs, help text, and error messages. Structural fidelity (sections, order, visual hierarchy) is required; pixel-perfect fidelity is not.

**Provider boundary warning (demo → real-app navigation).** DemoGallery scenarios mount under `MockAppStateProvider`, but real-app routes (`/dashboard/{id}`, `/create`, `/rotate-keyset`, etc.) mount under the real `AppStateProvider`. Click-throughs that cross this boundary drop the mock state unless the app-state bridge is used to hand off state between providers (see `.factory/library/app-state-bridge.md`). If a feature wires a CTA from `/demo/*` into a real-app route, verify the destination renders the expected unlocked/runtime state — NOT a redirect back to `/`. A "click goes to the right URL" check is NOT sufficient; the destination must be functional.

**Non-UI feature scope.** Some mission features are architecture/state/provider work (e.g. app-state bridge, route plumbing) rather than screen rendering. These are valid ui-builder features. When working on one, place tests under `src/app/__tests__/` or next to the module being changed, and focus on provider/hook/helper unit tests rather than Paper-copy assertions.

## Required Skills

- `agent-browser` — Used for manual visual verification of built screens. Invoke after implementation to navigate the app and confirm screens render correctly and navigation works.

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Identify:
- Which screens need to be created or modified
- Which Paper reference files to consult
- Which routes need to be added/changed
- Which existing components to reuse

### 2. Study Paper References

For each screen you're building, read from the igloo-paper repo:
- `igloo-paper/screens/{flow}/{screen}/README.md` — describes the screen purpose, elements, and context
- `igloo-paper/screens/{flow}/{screen}/screen.html` — the HTML reference for layout and content
- `igloo-paper/screens/{flow}/{screen}/screenshot.png` — visual reference

Also consult:
- `igloo-paper/design-system/` for component patterns
- `igloo-paper/screens/_shared/` for header/footer reference

Use the Paper HTML as **guidance** for layout and content, not a pixel-perfect template. Match the general structure, text content, and visual hierarchy.

### 3. Write Tests First (TDD)

For each new screen component, write a vitest test BEFORE implementing:

```typescript
// src/screens/__tests__/NewScreen.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewScreen } from "../NewScreen";

describe("NewScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <NewScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Expected Heading")).toBeInTheDocument();
    // Test key interactive elements exist
  });
});
```

Run `npx vitest run --config vitest.config.ts` to verify tests FAIL before implementation.

### 4. Implement Screen Components

Create new screen files in `src/screens/`. Follow existing patterns:
- Use the `AppShell` component for layout (imported from `../components/shell`)
- Use existing UI components from `../components/ui` (Button, TextField, PasswordField, etc.)
- Use CSS class names matching existing conventions in `src/styles/global.css`
- Do NOT use Tailwind utility classes — use custom CSS classes

For new CSS classes:
- Add them to `src/styles/global.css`
- Follow existing naming conventions (lowercase-hyphenated, e.g., `.import-form`, `.error-panel`)
- Use CSS custom properties from `src/styles/paper-tokens.css` for colors and typography

### 5. Add Routes and Demo Scenarios

Register new routes in `src/app/CoreRoutes.tsx`:
- Import the new screen component
- Add a `<Route path="/..." element={<NewScreen />} />` inside the existing `<Routes>` block
- Follow the existing route naming pattern (lowercase, hyphenated)

Register new demo scenarios in `src/demo/scenarios.ts` for EVERY new screen or screen variant:
- Add a `DemoScenario` entry with `id`, `flow`, `pathname`, `title`, `paperRef`, `expectedText`, and optional `appState` preset.
- Set `canonical: false` for variants that should not appear in the gallery index (e.g. error sub-states).
- Validators will navigate to `/demo/{id}` to test the screen; without a scenario entry, validation cannot proceed.

### 6. Wire Navigation

- Enable any disabled buttons that should now navigate to the new screens
- Add `onClick={() => navigate("/new-route")}` or `<Link to="/new-route">` as appropriate
- Add `BackLink` components that navigate to the correct parent screen
- Ensure forward navigation (Continue/Submit buttons) goes to the next screen in the flow

### 7. Run Tests and Typecheck

```bash
npx vitest run --config vitest.config.ts
npx tsc -b
```

Fix any failures before proceeding.

### 8. Manual Verification with agent-browser

Invoke `agent-browser` skill to:
1. Start the dev server if not running: `cd /Users/plebdev/Desktop/igloo-web-v2-prototype/web-demo-v2 && npx vite --host 127.0.0.1 --port 5173`
2. Navigate to each new/modified screen
3. Verify the screen renders with correct heading, content, and layout
4. Test navigation (forward buttons, back links)
5. Test interactive elements (inputs accept text, buttons respond)
6. Check browser console for errors

Record each check in the handoff's `interactiveChecks` array.

### 9. Stop Dev Server

After verification, stop the dev server:
```bash
lsof -ti :5173 | xargs kill 2>/dev/null
```

## Example Handoff

```json
{
  "salientSummary": "Built the Import flow (4 screens: Load Backup, Decrypt Backup, Review & Save, Error). Added /import/* routes, enabled the Welcome Import button, wired all navigation. Ran vitest (4 new tests passing) and verified all 4 screens render correctly via agent-browser.",
  "whatWasImplemented": "Created ImportLoadBackupScreen, ImportDecryptScreen, ImportReviewSaveScreen, ImportErrorScreen components. Added routes /import, /import/decrypt, /import/review, /import/error to App.tsx. Added CSS classes .import-form, .import-error-panel, .review-card to global.css. Enabled 'Import Device Profile' button on WelcomeScreen. Wired BackLink navigation on all Import screens.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npx vitest run --config vitest.config.ts", "exitCode": 0, "observation": "6 tests passing (2 existing + 4 new Import screen tests)" },
      { "command": "npx tsc -b", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "Navigate to / and click 'Import Device Profile'", "observed": "Navigated to /import. Load Backup screen renders with heading, backup input, upload button, and continue button." },
      { "action": "Type 'bfprofile1test' in backup input and click Continue", "observed": "Navigated to /import/decrypt. Decrypt Backup screen renders with loaded backup display, password input, and decrypt button." },
      { "action": "Click Back on Decrypt screen", "observed": "Returned to /import. Load Backup screen renders with previous input preserved." },
      { "action": "Navigate through to Review & Save, then Error screen", "observed": "All 4 screens render correctly. Error screen shows amber warning styling with retry button." },
      { "action": "Check console for errors across all Import screens", "observed": "No console errors on any Import screen." }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/screens/__tests__/ImportScreens.test.tsx",
        "cases": [
          { "name": "LoadBackupScreen renders heading and input", "verifies": "VAL-IMP-001" },
          { "name": "DecryptBackupScreen renders password input", "verifies": "VAL-IMP-002" },
          { "name": "ReviewSaveScreen renders profile cards", "verifies": "VAL-IMP-003" },
          { "name": "ImportErrorScreen renders error styling", "verifies": "VAL-IMP-004" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A Paper design reference file is missing or unclear about a screen's expected content
- An existing component or CSS pattern doesn't support what the design requires and creating a new one would significantly change shared code
- The WASM build is broken or missing and a screen requires WASM-backed data
- A route conflict exists with an existing route
- The feature depends on state management changes that would affect other screens
