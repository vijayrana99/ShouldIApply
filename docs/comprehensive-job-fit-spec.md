# Should I Apply? — Comprehensive Job-Fit Specification

**Status:** Implementation-ready

**Purpose:** Define the job-page experience for the Summa/Quick Summarize browser panel. This consolidates the product requirements in `does-this-job-fit-me-build-spec.md` with the useful interaction and visual patterns illustrated by `design-sample.html`.

## 1. Product outcome

On a detected job posting, answer the user's immediate question: **“Should I bother applying?”** The panel must make a CV-based assessment the primary outcome, rather than making the user read a summary and manually request a comparison.

The assessment informs the user; it must not present a low score as an error or a directive not to apply. Eligibility and other high-impact warnings remain prominent because skill fit alone does not establish whether a role is viable.

## 2. Scope and non-goals

### In scope

- Job-page detection and fit-first rendering.
- A CV-required first-run state for job pages.
- Automatic structured job extraction and CV-fit analysis when a CV exists.
- Structured fit verdict, evidence, flags, collapsed job details, caching, and defined fallbacks.
- Client-side fit-score verdict bucketing.

### Out of scope

- Changes to the extraction or CV-fit data contracts.
- Any change to generic/non-job summarisation.
- New remote libraries, build tooling, or external market/company-data lookups.
- A final product rename. “Is this a fit?” may be used as a job-mode label, but the current product branding remains unchanged pending a separate decision.

## 3. Existing data contracts

Use the existing schemas without changing them.

### Structured job extraction

`contentType`, `confidence`, `role { title, company, location, workArrangement }`, `compensation { min, max, currency, period, extras, employerPensionContribution }`, `employmentType`, `flags[] { severity, text }`, `requirements[] { tier, text }`, `responsibilities[]`, `process { stageCount, stages[], assessmentAreas[], decisionTimeline }`, `benefits[]`, `eligibility[]`, and `applicationDeadline`.

### CV-fit result

`fitScore`, model-provided `verdict`, `matchedCount`, `gapCount`, and either `breakdown[] { requirement, status, evidence }` or the established `matched[]` / `missing[]` representation.

The model-provided `verdict` is supporting information only. The displayed score band is computed in the client from `fitScore` so its terminology is consistent.

## 4. Page classification and primary flows

| Page and CV state | Required behaviour |
| --- | --- |
| Non-job page, with or without a CV | Preserve the existing free-text summariser exactly. Do not show a CV prompt, fit score, or fit UI. |
| Job page, no saved CV | Render the CV-prompt view as primary content. Do not expose the full job-breakdown view behind it. Provide an inline upload/paste action. |
| Job page, saved CV | Start structured extraction and CV-fit analysis automatically, in parallel or in immediate sequence. Do not require a “Compare to my CV” click. |
| CV cleared while the panel is open | Replace any refresh action with the CV upload/paste action and use the no-CV state on the next analysis. |

## 5. Job-page UI

### 5.1 Persistent panel chrome

Keep the current panel chrome: drag handle, product logo/name, **Job detected** pill, and minimise/close controls. The visual reference's compact top bar, restrained system-like typography, rounded panels, and compact spacing are appropriate patterns; implementation must use hand-written CSS and the existing system font stack rather than its remote Tailwind, Google Font, or icon dependencies.

### 5.2 No-CV prompt

For a job page without a saved CV, render a compact, focused prompt:

- Headline: “Add your CV to see if this job fits you.”
- Inline controls to upload or paste a CV.
- Brief explanation that the CV enables an automatic requirements comparison.

Do not render job requirements, a generic summary, a score, or a misleading empty-state assessment below this prompt.

### 5.3 Fit-first view

When extraction and CV fit are available, render sections in this order.

1. **Fit verdict hero.** Show a large numeric score and the client-computed verdict label. Add a one-line count-based explanation, for example “Missing 2 of 6 core requirements.” Build this from returned counts rather than asking the model to write a sentence. Under it, show role title, company, and compensation compactly. Location and work arrangement may appear in this metadata only when structured data is present.
2. **Flags callout.** When `flags[]` is non-empty, show it at least as prominently as the fit hero and above the fold. Use severity to communicate urgency. Do not bury visa or eligibility risk beneath expandable details.
3. **Why this score.** Expanded by default. List the matched and missing requirements, with a checkmark for a match and a muted missing tag for a gap. Each row includes the requirement and the existing CV evidence/reason. This is the concise fit explanation, not a second copy of every job detail.
4. **Full job details.** Collapsed by default. This is a single secondary section containing the accordions below.
   - Key Requirements: the complete list, distinct from the matched/gap explanation.
   - Responsibilities.
   - Benefits.
   - Eligibility.
   - Process & timeline.
5. **Footer.** Preserve the inline “Ask a follow-up” interaction. Replace the old “Compare to my CV” action with “Refresh with updated CV.” If there is no CV at render time, show the upload/paste action instead.

### 5.4 Score bands

| `fitScore` | Label | Presentation |
| --- | --- | --- |
| 80–100 | Strong Match | Confident green/emerald styling. |
| 55–79 | Partial Match | Amber styling and an invitation to read the gaps. |
| 0–54 | Weak Match | Neutral slate/gray styling; never error red. |

If `fitScore` is absent, malformed, or only an unstructured comparison is available, omit both the numeric hero score and band label. Do not infer either from free text.

## 6. Content and visual guidance from the prototype

The prototype usefully demonstrates compact cards, a prominent score treatment, warning callouts, information chips, expandable sections, and simple feedback after copying an action. These are optional presentation patterns, subject to the required section order above.

The following prototype elements are **not requirements** and must not be implemented unless separately approved:

- “Missing Data Mode,” missing-field scanner counts, and data-quality notices.
- Invented or assumed values, including assumed full-time status and unverified company details.
- Market salary estimates, compensation benchmarks, or external company-footprint claims.
- Recruiter-question checklists, copy-gap-prompts actions, and modal flows.
- A distinct “skills compatibility” model, “ambiguous” skill state, or extra data quality schema.

Only present information that the existing job extraction or CV-fit schemas support. Omit unsupported fields rather than showing placeholders that could be mistaken for evidence.

## 7. Loading, validation, fallback, and caching

### 7.1 Normal path

For a job page with a saved CV:

1. Start structured job extraction.
2. Start CV fit as soon as extraction can supply it; parallelise where the existing architecture permits.
3. Render the fit-first view only from validated structured results.
4. Store the validated job extraction and CV-fit result together in the existing per-tab `summaSessions` cache under one `sourceUrl` key.

Revisiting a tab with a valid cached pair must not repeat either model call.

### 7.2 Structured extraction recovery

Preserve the existing lenient-recovery order exactly:

1. Direct `JSON.parse`.
2. Regex extraction of a JSON block.
3. One retry prompt.
4. Existing generic-summary fallback.

If structured job extraction ultimately fails validation, fall back to the existing generic summariser for the page. This is the exception to the job-page fit-first experience because the required structured input is unavailable.

### 7.3 CV-fit failure

If job extraction succeeds but the CV-fit result fails validation, render the existing free-text CV comparison as the fit fallback and still expose the valid full job-details section. Do not display a fabricated structured score, score band, matched count, or gap count.

## 8. Implementation rules

- Reuse existing extraction and fit schemas; do not expand the contract to satisfy visual ideas from the prototype.
- Implement the verdict-bucketing helper on the client.
- Template the hero explanation from `matchedCount`, `gapCount`, and the total assessable requirement count when available. Prefer a concise count statement; omit or degrade gracefully when exact counts cannot be established.
- Keep non-job rendering isolated from job-mode logic so a saved CV never changes generic pages.
- Preserve the existing session-cache semantics and cache both successful structured outputs together.
- Use hand-written CSS and the existing system-font approach. Do not introduce Tailwind, externally hosted fonts, or remote icon libraries for this change.
- Ensure accordion controls are keyboard accessible and expose their expanded/collapsed state.

## 9. Acceptance checklist

- [ ] A detected job page without a CV opens on the CV upload/paste prompt only.
- [ ] A detected job page with a CV automatically initiates extraction and CV fit without a comparison button.
- [ ] The fit-first view orders content as hero, visible flags, expanded score explanation, collapsed job details, then footer.
- [ ] Score bands use 80/55 thresholds and Weak Match is not red.
- [ ] Requirement rows show existing fit evidence and do not re-derive it.
- [ ] Full job details contain requirements, responsibilities, benefits, eligibility, and process/timeline as collapsible secondary content.
- [ ] Generic pages remain unchanged whether or not a CV exists.
- [ ] Extraction recovery follows parse, JSON-block extraction, one retry, then generic-summary fallback.
- [ ] CV-fit validation failure preserves job details and uses the existing free-text comparison without a score band.
- [ ] `summaSessions[sourceUrl]` retains both validated structured results and prevents redundant calls on revisit.
- [ ] No prototype-only data claims, external market data, or remote UI dependencies are introduced.

## 10. Source precedence

This document is the consolidated implementation source. The original written build spec is authoritative for product behaviour and fallback rules. `design-sample.html` is a visual exploration only; it may inform styling and interaction affordances, but it does not establish new data requirements or override the flows above.
