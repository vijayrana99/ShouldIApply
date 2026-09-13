# Build Spec — "Does This Job Fit Me?" Reframe

**Status:** Ready to hand to the coding agent as Phase 4, building on the already-agreed Phase 1–3 work (structured job extraction, hand-written CSS render, structured CV fit). This document is self-contained — it does not require re-reading prior conversation threads.

---

## 1. Why this reframe

The current product asks the user to read a summary and then optionally click "Compare to my CV" to find out if a job is worth applying to. That's a passive tool. The repositioned product answers the actual question a job seeker has the moment they land on a posting: **"should I bother applying?"** The fit assessment becomes the primary output of the panel on job pages — not a secondary action buried after a summary.

---

## 2. Scope of this change

- This is a **render and flow change**, not a rebuild of the extraction logic. The existing structured schemas (job extraction fields — `role`, `compensation`, `requirements[]`, `flags[]`, `eligibility[]`, `responsibilities[]`, `benefits[]`, `process`; and the CV-fit shape — `fitScore`, `matched[]`, `missing[]`) stay as they are.
- **Generic (non-job) pages are unaffected.** They keep the existing free-text summarizer exactly as-is. No CV prompt, no fit UI, nothing changes here.
- **Job pages change significantly** — see layout and flow below.

---

## 3. CV becomes a first-run requirement for job pages

| Condition | Behavior |
|---|---|
| Job page detected, **no CV saved** | Show a compact "Add your CV to see if this job fits you" prompt as the panel's **primary content**. Do NOT show the full requirements breakdown behind this — the ask is CV-first. Include an inline CV upload/paste action directly in this prompt. |
| Job page detected, **CV saved** | Panel defaults straight into **fit-first mode** automatically. Do not require a second click ("Compare to my CV") to see the fit score. Fetch job extraction and CV fit together as the default flow (in parallel or immediate sequence) — fit is now the primary ask, not an optional add-on. |
| Generic (non-job) page | No CV requirement, no CV-fit prompt at all, regardless of whether a CV is saved. |

---

## 4. New panel layout for job pages (fit-first)

Rendered top to bottom, in this exact order:

### 4.1 Header bar
Unchanged: drag handle, logo, "Job detected" pill, minimize/close controls.

### 4.2 Fit verdict hero (new primary section — replaces today's salary/title-first block as the top content)

- **Large fit score** (e.g. "82%") with a **verdict band label**, not a bare number. See §6 for exact bucketing thresholds.
- **One-line plain-English reason** tied to actual gaps, e.g. *"Missing 2 of 6 core requirements."* Reuse `matchedCount`/`gapCount`-style fields from the existing CV-fit schema — don't ask the model to author this sentence freeform if it can be templated from counts already returned.
- **Role title + company + salary** as a compact subline directly beneath the verdict — not as a separate large block above it (this demotes what was previously the top-of-panel header content).

### 4.3 "Why this score" (expanded by default)
The matched/missing requirement breakdown, reusing the existing CV-fit rendering pattern:
- Checkmarks for matched requirements
- Muted "missing" tags for gaps
- Each row shows the requirement text **and** the CV evidence/reason already returned by the structured CV-fit call (don't re-derive this — it's already in the schema).

### 4.4 Flags callout
Unchanged in content, shown if `flags[]` is non-empty (e.g. visa/eligibility warnings). **Keep this highly visible** — it stays above or equal in prominence to the fit score section conceptually, since a 90% skill-fit score is meaningless if the user isn't eligible to work there at all. Flags should never be buried below the fold.

### 4.5 Full job details (collapsed by default — this is the key layout change)
Contains the existing accordions, now demoted to secondary/optional reading:
- Key Requirements (full list, not just gaps — this is the complete picture, distinct from §4.3's gap-focused view)
- Responsibilities
- Benefits
- Eligibility
- Process & timeline

This entire section defaults to **collapsed**, inverting today's behavior where Key Requirements is expanded by default.

### 4.6 Footer
- Keep "Ask a follow-up" inline chat as-is.
- Replace "Compare to my CV" button — it's no longer needed since fit is now automatic on load. Replace with:
  - "Refresh with updated CV" if a CV is already on file, OR
  - The CV upload action (matching §3's no-CV prompt) if somehow reached this state without a CV yet (e.g. CV was cleared mid-session).

---

## 5. Fallback logic (must be preserved)

| Scenario | Behavior |
|---|---|
| Job page, no CV saved | Show CV-prompt view (§3), not the generic summary. |
| Job page, CV saved, structured job extraction fails validation | Fall back to the existing generic summarizer for that page (per the already-agreed Phase 1 lenient-recovery plan: direct parse → regex-extract JSON block → one retry prompt → fall back to generic summary). |
| Job page, CV saved, extraction succeeds but CV-fit call fails validation | Fall back to the existing free-text CV comparison — but still show the full job details section (§4.5) since that data is independently valid and unaffected by the CV-fit failure. |
| Non-job page | Unchanged — existing generic summarizer, no fit UI at all. |

---

## 6. Fit-score-to-verdict-label bucketing

Compute this **client-side** from the numeric `fitScore` already returned by the model — do not ask the model to also classify the band, to keep the labeling consistent and independent of model phrasing variance.

| Score range | Verdict label | Suggested tone/color |
|---|---|---|
| 80–100 | **Strong Match** | Green/emerald — confident, low-friction |
| 55–79 | **Partial Match** | Amber — worth reading the gaps before deciding |
| 0–54 | **Weak Match** | Slate/gray — neutral, not alarming (avoid red; this isn't a failure state, just a data point) |

Notes:
- These thresholds are a starting point — flag to the product owner if real usage suggests they should shift (e.g. if most postings cluster in one band, the buckets aren't discriminating usefully).
- Do not use red/error styling for "Weak Match" — a low score is information, not a failure, and alarming color choices could discourage a user from applying to something they'd otherwise have a shot at (some roles undervalue certain skill gaps in practice).
- If `fitScore` is missing or the CV-fit call fell back to free-text (per §5), skip the banded label entirely rather than guessing a band from unstructured text.

---

## 7. Constraints carried over from existing plan

- No new remote libraries, no build step — hand-written CSS, system font stack, consistent with the current codebase's approach.
- Reuse existing structured schemas as-is. This is a render/flow change, not a new data contract — the only client-side addition is the verdict-bucketing helper in §6.
- Keep existing per-tab session caching (`summaSessions`). Cache **both** the job extraction and the CV-fit result together under one `sourceUrl` key so revisiting a tab doesn't re-trigger either model call.

---

## 8. Naming note (flag only — do not block this build on it)

The product is currently branded "Quick Summarize" / "Summa," which frames it as a summarizer. If this fit-first reframe is the long-term direction, consider whether the panel's job-page mode label should shift toward something fit-oriented (e.g. "Is this a fit?" as a mode label, even if the extension's overall name stays unchanged for now). This is a follow-up decision, not part of this build.

---

## 9. Deliverables checklist

- [ ] Updated panel render logic implementing the §4 section order for job pages.
- [ ] New onboarding/empty-CV state specific to job pages (separate from any existing generic no-CV state).
- [ ] Default flow updated so job pages fetch extraction + CV fit together, not gated behind a click.
- [ ] Verdict-bucketing helper implemented client-side per §6.
- [ ] Confirm caching still works for both extraction and fit results under one `sourceUrl` key.
- [ ] All fallback paths from §5 preserved and manually verified.
- [ ] Short written summary of what changed vs. the current implementation, including any schema fields found missing and how they were handled (e.g. if a templated gap-summary sentence needed a new field rather than being computed client-side).

---

## 10. Reference — existing schemas this build depends on

This spec assumes the following are already implemented and unchanged:

- **Job extraction schema** — `contentType`, `confidence`, `role {title, company, location, workArrangement}`, `compensation {min, max, currency, period, extras, employerPensionContribution}`, `employmentType`, `flags[] {severity, text}`, `requirements[] {tier, text}`, `responsibilities[]`, `process {stageCount, stages[], assessmentAreas[], decisionTimeline}`, `benefits[]`, `eligibility[]`, `applicationDeadline`.
- **CV-fit schema** — `fitScore`, `verdict` (free-text from model, now superseded by the client-side band label in §6 for display purposes, though the model's own text may still be shown as supporting detail), `matchedCount`, `gapCount`, `breakdown[] {requirement, status, evidence}` (or `matched[]`/`missing[]` per the Phase 3 agreed shape).
- **Lenient recovery order** (Phase 1, unchanged): direct `JSON.parse` → regex-extract JSON block → one retry prompt → fall back to generic summary.
