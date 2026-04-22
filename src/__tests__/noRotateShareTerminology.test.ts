/*
 * VAL-CROSS-009 — Terminology migration: "Rotate Share" → "Replace Share".
 *
 * Guard test against regressions of the mission rename sweep. Scans the
 * key surfaces (CSS, the ReplaceShare flow screens, the Welcome entry
 * card, and the dashboard settings sidebar) and asserts that none of the
 * banned tokens appear. User-facing copy, CSS class names, code
 * identifiers, and comments should all use "Replace Share" / "replace-share"
 * / "ReplaceShare".
 *
 * Any legitimate reference that must still contain the legacy token must
 * include an inline comment with the word "intentional" (or "VAL-CROSS-009")
 * on the same line so reviewers can audit each exception explicitly.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_SRC = resolve(__dirname, "..");

/** Token patterns that may NOT appear in src/ surfaces post-rename. */
const BANNED_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "rotate-share (CSS class / URL fragment)", re: /rotate-share/ },
  { label: "rotate_share (snake_case identifier)", re: /rotate_share/ },
  { label: "RotateShare (PascalCase identifier)", re: /RotateShare/ },
  { label: "rotateShare (camelCase identifier)", re: /rotateShare/ },
  { label: "'Rotate Share' (user-facing copy)", re: /Rotate Share/ },
  { label: "'ROTATE SHARE' (uppercase banner / comment)", re: /ROTATE SHARE/ },
];

/** Target files to audit. Relative to src/. */
const TARGETS: ReadonlyArray<string> = [
  "styles/global.css",
  "screens/ReplaceShareScreens.tsx",
  "screens/WelcomeScreen.tsx",
  "screens/DashboardScreen/sidebar/SettingsSidebar.tsx",
];

/** Lines matching this exemption marker are explicitly allowed. */
const EXEMPTION_MARKER = /intentional|VAL-CROSS-009/i;

describe("VAL-CROSS-009 — 'Rotate Share' → 'Replace Share' terminology sweep", () => {
  for (const relative of TARGETS) {
    it(`${relative} contains no banned 'Rotate Share' tokens`, () => {
      const absolute = join(REPO_SRC, relative);
      const source = readFileSync(absolute, "utf8");
      const offenders: Array<{ line: number; text: string; pattern: string }> =
        [];
      source.split(/\r?\n/).forEach((line, i) => {
        if (EXEMPTION_MARKER.test(line)) return;
        for (const { label, re } of BANNED_PATTERNS) {
          if (re.test(line)) {
            offenders.push({ line: i + 1, text: line, pattern: label });
          }
        }
      });
      expect(offenders).toEqual([]);
    });
  }
});
