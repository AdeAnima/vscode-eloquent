# Test Suite Review V2 — Combined Findings (2026-02-20)

## Documents Merged

- `a1b2c3-test-suite-review.md`
- `test-suite-review-2026-02-20-a7k3p9.md`

## Executive Summary

The test suite is already strong and well-structured, with high coverage and stable green runs. The highest-value improvements are not broad rewrites, but targeted hardening in four areas: CI quality gates, assertion precision, slow timeout-path tests, and selected uncovered orchestration/platform branches.

## Current State Snapshot

- Test files: 16
- Tests: 245
- Status: 245/245 passing
- Runtime: ~5.5s
- Coverage:
  - Statements: 95.64%
  - Branches: 87.12%
  - Functions: 93.79%
  - Lines: 97.05%

## Consolidated Strengths

- Clear module-based test organization (commands, setup, provider, chunker, backends).
- Good mix of unit and integration-style tests.
- Existing coverage of cancellation/error behavior in critical paths.
- Extension workflow behaviors are exercised via VS Code mocks.

## Consolidated Gaps

### 1) CI Gate Incomplete (Process Risk)

- CI currently runs tests/build/typecheck but does not enforce coverage thresholds via coverage run.
- Impact: coverage regressions can merge undetected.

### 2) Assertion Strictness (Quality Risk)

- Some tests rely on permissive assertions (for example: broad “called” checks, `>= 1` chunk expectations).
- Impact: behavior regressions may pass despite changing semantics.

### 3) Timeout Test Cost (Speed/Flake Risk)

- `customBackend` timeout-path tests consume several seconds due to real timeout waits.
- Impact: slower feedback loops and greater CI variability.

### 4) Targeted Branch Gaps (Coverage Quality Risk)

- Remaining uncovered lines are concentrated in orchestration/platform and edge handling branches.
- High-value targets:
  - `src/commands.ts` wrapper/error branches
  - `src/setup.ts` URL validation / custom endpoint path
  - `src/extension.ts` runtime reconfiguration branches
  - `src/player.ts` and `src/installer.ts` platform-specific branches
  - `src/chunker.ts` buffer-full/backpressure wait branch
  - `src/backends/kokoro.ts` abort-after-generation branch

### 5) Mock Fidelity and Real Host Validation (Confidence Risk)

- Mock-driven integration tests are good but cannot fully replicate Extension Host behavior.
- Child process and filesystem behavior can be tested with higher-fidelity simulation.

## Final Prioritized Plan

## P0 — Immediate

1. Enforce coverage in CI
- Add `npm run test:coverage` to CI workflow for PR gating.

2. Harden permissive assertions in high-risk tests
- Focus first on:
  - `test/chunker.test.ts`
  - `test/extensionIntegration.test.ts`
  - `test/commands.test.ts`

## P1 — Next

3. Optimize timeout-path tests
- Prefer injectable short timeout values in tests for determinism.
- Optional: fake timers only where request/response behavior remains deterministic.
- Target: no single timeout-path unit test > ~250ms.

4. Close highest-value branch gaps
- Add focused tests for specific uncovered orchestration/platform branches listed above.

5. Improve mock fidelity where behavior matters
- Expand process lifecycle simulation (`SIGSTOP`/`SIGCONT`) and filesystem interaction checks in backend flow tests.

## P2 — Maturity

6. Add true VS Code E2E smoke tests
- Introduce `@vscode/test-electron` (Insiders-targeted) for minimal smoke coverage:
  - activation
  - command registration
  - status bar visibility
  - walkthrough open behavior

7. Pilot mutation testing on critical modules
- Scope first pass to small set (`chunker`, `commands`, `speechProvider`) and track mutation score trend.

## Recommended Implementation Sequence (Low-Risk, High-ROI)

1. CI coverage gate
2. Assertion hardening pass
3. Timeout-path speedup
4. Branch-gap closure pass
5. E2E smoke introduction
6. Mutation pilot

## Success Criteria

- Coverage thresholds enforced in CI for pull requests.
- Reduced suite runtime and no multi-second single-test bottlenecks in routine local runs.
- Measurable branch coverage increase in orchestration/platform modules.
- Fewer permissive assertions in critical-path tests.
- Basic real Extension Host E2E smoke tests passing.

## Sources

1. Vitest Coverage Guide (official): https://vitest.dev/guide/coverage.html  
   Credibility: 10/10 (official, current, directly applicable)

2. VS Code Extension Testing Guide (official): https://code.visualstudio.com/api/working-with-extensions/testing-extension  
   Credibility: 10/10 (official Microsoft guidance, current)

3. Stryker Mutation Testing Docs (official): https://stryker-mutator.io/docs/  
   Credibility: 8/10 (official tool docs, valuable for mutation strategy)