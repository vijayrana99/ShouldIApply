"""
test_fit_logic.py

Exercises the DETERMINISTIC layer of the Option-A fit fix by mirroring the exact
logic in popup.js (fitVerdict / templatedFitReason / renderGaps gating) and
popup.js visaClarity. It runs against two scenarios:
  A) a Barclays-like posting that SHOULD no longer read as "92% Strong Match",
  B) a genuinely strong posting that SHOULD stay "Strong Match / no gaps".

NOTE: this runs the mirrored deterministic logic ONLY. It does NOT call the
model (no API key / network here) and does NOT execute the JS render code, so
the model-produced fitScore / gaps[] are simulated inputs below. See summary.
"""
import re


# ---------------- Mirrors of popup.js (kept in sync by construction) ---------

def verdict_band(score):
    if not isinstance(score, (int, float)) or score is None or score < 0 or score > 100:
        return None
    if score >= 80: return ("Strong Match", "strong")
    if score >= 55: return ("Partial Match", "partial")
    return ("Weak Match", "weak")


def fit_gaps(fit):
    if not fit: return []
    return [g for g in (fit.get("gaps") or []) if isinstance(g, dict)]


def fit_verdict(fit):
    if not fit: fit = {}
    base = verdict_band(fit.get("fitScore")) or ("No fit score", "none")
    base_label, base_tone = base
    gaps = fit_gaps(fit)
    blockers = sum(1 for g in gaps if g.get("severity") == "blocker")
    risks = sum(1 for g in gaps if g.get("severity") == "risk")
    if blockers > 0:
        return {"band": ("Needs verification", "partial"), "blockerCount": blockers,
                "riskCount": risks, "capped": True}
    return {"band": (base_label, base_tone), "blockerCount": 0,
            "riskCount": risks, "capped": False}


def templated_fit_reason(fit):
    if not fit: fit = {}
    gaps = fit_gaps(fit)
    blockers = sum(1 for g in gaps if g.get("severity") == "blocker")
    risks = sum(1 for g in gaps if g.get("severity") == "risk")
    if blockers > 0:
        return f"{blockers} blocker{'s' if blockers != 1 else ''} to verify before applying."
    if risks > 0:
        return f"{risks} potential risk{'s' if risks != 1 else ''} to review below."
    matched = len(fit.get("matched") or [])
    missing = len(fit.get("missing") or [])
    total = matched + missing
    if total == 0: return "No core requirements were extracted for this posting."
    if missing == 0: return f"You meet all {total} core requirement{'s' if total != 1 else ''}."
    return f"Missing {missing} of {total} core requirement{'s' if total != 1 else ''}."


def would_render_no_gaps(fit):
    # renderGaps shows the "no gaps" message only when BOTH missing[] and gaps[] are empty.
    if not fit: return True
    missing = fit.get("missing") or []
    hard = [g for g in (fit.get("gaps") or []) if isinstance(g, dict)]
    return len(missing) == 0 and len(hard) == 0


def visa_clarity(job):
    if not job: job = {}
    elig = [str(s).lower() for s in (job.get("eligibility") or []) if s]
    raw_flags = job.get("flags") or []
    fl = [str((f.get("text") if isinstance(f, dict) else f) or "").lower() for f in raw_flags]
    hay = " ".join(elig + [f for f in fl if f])
    limited = re.compile(
        r'no\s*(visa\s*)?sponsor|no[\w\s-]*sponsorship|does ?not.*sponsor|'
        r'without.*sponsor|own (legal )?right to work|must have.*(right to work|visa)|'
        r'require.*(sponsor|right to work)|unless.*sponsor|cannot.*sponsor|not able.*sponsor'
    )
    if limited.search(hay): return "conditional"
    pos = re.compile(
        r'visa\s*(sponsorship|sponsor(ed)?|support)\b|sponsorship\s+(is\s+)?available\b|'
        r'will\s+(sponsor|support).*\bvisa\b'
    )
    if pos.search(hay): return "supported"
    if re.search(r'right to work|work\s*(authorization|eligibility)|citizenship|nationality', hay):
        return "conditional"
    return "unclear"

# ---------------- Fixtures -----------------------------------------

# Scenario A: Barclays-like. Representative wording for the conditional-sponsorship
# nuance (bug #5) plus a summer-availability conflict (blocker).
job_a = {
    "role": {"title": "Technology Developer Summer Internship", "company": "Barclays", "location": "Glasgow", "workArrangement": "Hybrid"},
    "requirements": [
        {"tier": "must-have", "text": "Genuine interest in technology"},
        {"tier": "must-have", "text": "Strong problem-solving skills"},
        {"tier": "must-have", "text": "Drive to deliver innovative solutions"},
    ],
    "eligibility": [
        "Candidates without Skilled Worker visa sponsorship must have their own legal right to work in the UK"
    ],
    "flags": [
        {"severity": "warning", "text": "Work eligibility required from June to August 2027; internship spans the summer."}
    ],
    "applicationDeadline": None,
    "compensation": {"min": None, "max": None},
}
fit_a = {
    "fitScore": 92,
    "verdict": "Skills align but the summer availability window is a blocker.",
    "matched": [
        {"requirement": "Genuine interest in technology", "why": "Shown in projects"},
        {"requirement": "Strong problem-solving skills", "why": "Shown in achievable work"},
        {"requirement": "Drive to deliver innovative solutions", "why": "Evident"},
    ],
    "missing": [],
    "gaps": [
        {"area": "Availability", "severity": "blocker", "text": "CV says available from October 2027; internship is June-August 2027."},
        {"area": "Visa", "severity": "risk", "text": "Confirm right to work for the full June-August window."},
    ],
    "reason": "Skills align but the summer availability window is a blocker.",
}
# Old-shaped cached fit (backward-compat): NO gaps[]/reason.
fit_old = {"fitScore": 80, "verdict": "x", "matched": [{"requirement": "A", "why": ""}], "missing": [{"requirement": "B", "why": ""}]}

# Scenario B: genuinely strong posting that should stay high.
job_b = {
    "role": {"title": "Senior Backend Engineer", "company": "Acme", "location": "London", "workArrangement": "Hybrid"},
    "requirements": [
        {"tier": "must-have", "text": "Java"},
        {"tier": "must-have", "text": "Python"},
        {"tier": "must-have", "text": "SQL"},
        {"tier": "must-have", "text": "Cloud (AWS)"},
    ],
    "eligibility": ["We provide visa sponsorship for all roles."],
    "flags": [],
    "applicationDeadline": "2027-03-01",
    "compensation": {"min": 90000, "max": 120000},
}
fit_b = {
    "fitScore": 91,
    "verdict": "Strong requirements match with no blockers.",
    "matched": [{"requirement": r, "why": "Listed and evidenced in CV"} for r in ["Java", "Python", "SQL", "Cloud (AWS)"]],
    "missing": [],
    "gaps": [],
    "reason": "All stated requirements map to the CV and no hard gates block the application.",
}
failures = []
def check(label, cond, detail=""):
    if cond:
        print(f"PASS  {label}")
    else:
        print(f"FAIL  {label}  {detail}")
        failures.append(label)

# ---- Scenario A: Barclays-like must NOT read as Strong Match / no gaps ----
vd = fit_verdict(fit_a)
check("A: capped verdict when a blocker exists", vd["capped"] is True)
check("A: band label becomes 'Needs verification'", vd["band"][0] == "Needs verification")
check("A: band tone is partial (not strong)", vd["band"][1] == "partial")
check("A: blockerCount is surfaced next to the ring", vd["blockerCount"] == 1)
check("A: reason mentions the blocker", "blocker" in templated_fit_reason(fit_a))
check("A: 'no gaps' is NOT rendered when gaps[] is non-empty", would_render_no_gaps(fit_a) is False)
check("A: visa nuance no longer collapses to 'Sponsorship available'",
      visa_clarity(job_a) == "conditional", f"got {visa_clarity(job_a)!r}")

# ---- Scenario B: genuinely strong posting must stay strong ----
vd_b = fit_verdict(fit_b)
check("B: stays a Strong Match", vd_b["band"][0] == "Strong Match")
check("B: not capped", vd_b["capped"] is False)
check("B: blocker count is 0", vd_b["blockerCount"] == 0)
check("B: renders the 'no gaps' message", would_render_no_gaps(fit_b) is True)
check("B: explicit sponsorship still reads as supported",
      visa_clarity(job_b) == "supported", f"got {visa_clarity(job_b)!r}")

# ---- Backward compatibility (old cached fit, no gaps[]/reason) ----
vd_old = fit_verdict(fit_old)
check("Compat: old-shaped fit is not capped", vd_old["capped"] is False)
check("Compat: old-shaped fit keeps its base band", vd_old["band"][0] == "Strong Match")
check("Compat: reason falls back to counts", "Missing 1 of 2" in templated_fit_reason(fit_old))

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    raise SystemExit(1)
print("ALL deterministic-logic checks passed.")