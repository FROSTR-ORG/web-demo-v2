# Clock Skew Constraints (Protocol Reality)

- `bifrost-signer` enforces `max_future_skew_secs = 30` for inbound event timestamps.
- Because of this cap, **asymmetric ±120s cross-device skew** scenarios are not physically satisfiable without weakening protocol security checks.
- Validation coverage for m7 uses:
  - symmetric `+120s` skew, and
  - asymmetric `±25s` skew (within the 30s cap).

References:
- `docs/runtime-deviations-from-paper.md` (clock-skew deviation section)
- `src/e2e/multi-device/clock-skew.spec.ts`
- Contract linkage: `VAL-CROSS-019`, `VAL-CROSS-027`
