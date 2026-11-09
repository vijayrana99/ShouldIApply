"use strict";

// Shared by Settings, the panel, and the service worker. All dates use calendar
// days in UTC; suitability is kept separate from the AI's skills estimate.
(() => {
  const defaults = Object.freeze({
    enabled: false, earliestStart: "", latestStart: "", minWeeks: 30, maxWeeks: 34,
    hoursPerWeek: 28, hoursRule: "unconfirmed", termTimeOnly: true, termTimePercent: null, remainingTimeConfirmed: false,
    latestEndDate: "", returnToStudy: true, dissertationAlternative: true,
    computingProjectRequired: true, projectArea: "Computer Science",
  });
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value ? value : "";
  const number = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  function normalize(raw = {}) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: raw.enabled === true,
      earliestStart: date(raw.earliestStart), latestStart: date(raw.latestStart),
      minWeeks: number(raw.minWeeks, defaults.minWeeks), maxWeeks: number(raw.maxWeeks, defaults.maxWeeks),
      hoursPerWeek: number(raw.hoursPerWeek, defaults.hoursPerWeek),
      hoursRule: ["minimum", "maximum", "fixed"].includes(raw.hoursRule) ? raw.hoursRule : "unconfirmed",
      termTimeOnly: raw.termTimeOnly !== false, termTimePercent: number(raw.termTimePercent, null), remainingTimeConfirmed: raw.remainingTimeConfirmed === true, latestEndDate: date(raw.latestEndDate),
      returnToStudy: raw.returnToStudy !== false, dissertationAlternative: raw.dissertationAlternative !== false,
      computingProjectRequired: raw.computingProjectRequired !== false,
      projectArea: typeof raw.projectArea === "string" && raw.projectArea.trim() ? raw.projectArea.trim().slice(0, 100) : defaults.projectArea,
    };
  }
  function errors(raw = {}) {
    raw = raw && typeof raw === "object" ? raw : {};
    const p = normalize(raw);
    const issues = [];
    for (const key of ["earliestStart", "latestStart", "latestEndDate"]) {
      if (raw[key] && !date(raw[key])) issues.push("Enter a valid calendar date.");
    }
    if (p.earliestStart && p.latestStart && p.earliestStart > p.latestStart) issues.push("The earliest start must be on or before the latest start.");
    if (!Number.isInteger(p.minWeeks) || !Number.isInteger(p.maxWeeks) || p.minWeeks < 1 || p.maxWeeks > 104 || p.minWeeks > p.maxWeeks) issues.push("Use a duration between 1 and 104 weeks, with the minimum no greater than the maximum.");
    if (p.latestEndDate && p.earliestStart && p.latestEndDate < p.earliestStart) issues.push("The latest end date must not be before the earliest start.");
    if (p.termTimePercent != null && (p.termTimePercent <= 0 || p.termTimePercent > 100)) issues.push("The term-time percentage must be greater than 0 and no greater than 100, or left blank.");
    if (p.hoursPerWeek <= 0 || p.hoursPerWeek > 80) issues.push("Weekly hours must be greater than 0 and no greater than 80.");
    return issues;
  }
  function fingerprint(raw) {
    const p = normalize(raw);
    if (!p.enabled) return "disabled";
    const text = JSON.stringify(p);
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
    return String(hash);
  }
  function evaluate(raw, facts = {}) {
    const p = normalize(raw);
    if (!p.enabled) return null;
    const issues = errors(raw);
    if (issues.length) return { status: "clarify", profile: p, checks: [{ key: "settings", label: "Placement profile", status: "clarify", message: "Update your placement settings: " + issues.join(" "), jobQuote: null }] };
    const checks = [];
    const add = (key, label, status, message, quote = null) => checks.push({ key, label, status, message, jobQuote: quote });
    const conflict = fixed => fixed === true ? "blocker" : "clarify";
    const start = facts.start || {};
    if (p.earliestStart && p.latestStart && start.earliest && start.latest && start.quote) {
      const outside = start.latest < p.earliestStart || start.earliest > p.latestStart;
      const inside = start.earliest >= p.earliestStart && start.latest <= p.latestStart;
      add("start", "Start date", outside ? conflict(start.fixed) : inside ? "compatible" : "clarify",
        outside ? "The advertised start dates do not overlap your permitted start window." : inside ? "The advertised start dates fall within your permitted window." : "The employer's start window only partly overlaps yours; agree a specific date.", start.quote);
    } else add("start", "Start date", "clarify", "Confirm the employer's start date against your permitted start window.");

    const duration = facts.duration || {};
    if (duration.minWeeks != null && duration.maxWeeks != null && duration.quote) {
      const outside = duration.maxWeeks < p.minWeeks || duration.minWeeks > p.maxWeeks;
      const inside = duration.minWeeks >= p.minWeeks && duration.maxWeeks <= p.maxWeeks;
      add("duration", "Placement duration", outside ? conflict(duration.fixed) : inside ? "compatible" : "clarify",
        outside ? `The advertised duration falls outside your ${p.minWeeks}–${p.maxWeeks} week range.` : inside ? `The advertised duration fits your ${p.minWeeks}–${p.maxWeeks} week range.` : `Agree a duration within your ${p.minWeeks}–${p.maxWeeks} week range.`, duration.quote);
    } else add("duration", "Placement duration", "clarify", `Confirm a duration of ${p.minWeeks}–${p.maxWeeks} weeks; do not assume that a duration stated in months is an exact number of weeks.`);

    const hours = facts.hours || {};
    if (p.hoursRule === "unconfirmed") {
      add("hours", "Term-time hours", "clarify", `Your stated commitment is ${p.hoursPerWeek} hours per week${p.termTimeOnly ? " during term time" : ""}. Confirm whether this is a minimum, maximum, or fixed commitment, and clarify the remaining academic time.`, hours.quote);
    } else if (hours.hoursPerWeek != null && hours.quote) {
      const outside = p.hoursRule === "fixed" ? hours.hoursPerWeek !== p.hoursPerWeek : p.hoursRule === "minimum" ? hours.hoursPerWeek < p.hoursPerWeek : hours.hoursPerWeek > p.hoursPerWeek;
      add("hours", p.termTimeOnly ? "Term-time hours" : "Weekly hours", outside ? conflict(hours.fixed) : "compatible",
        outside ? `The advertised hours conflict with your ${p.hoursRule} ${p.hoursPerWeek}-hour commitment; confirm flexibility.` : `The advertised hours meet your ${p.hoursRule} ${p.hoursPerWeek}-hour commitment${p.termTimeOnly ? " for term time" : ""}.`, hours.quote);
    } else add("hours", "Working hours", "clarify", "Ask the employer to confirm weekly hours and flexibility.");

    if (p.termTimeOnly && !p.remainingTimeConfirmed) add("academicTime", "Remaining academic time", "clarify", "Confirm the arrangements for the remaining academic time with the university" + (p.termTimePercent ? `; your workplace commitment is described as ${p.termTimePercent}% of term time.` : "."));

    if (p.returnToStudy) {
      const end = facts.end || {};
      if (!p.latestEndDate) add("end", "Return to study", "clarify", "You will return to study after the placement. Confirm your latest permitted end date with the university; none has been recorded.", end.quote);
      else if (end.date && end.quote) add("end", "Return to study", end.date > p.latestEndDate ? conflict(end.fixed) : "compatible", end.date > p.latestEndDate ? "The advertised end date is after your latest permitted end date." : "The advertised end date allows you to return to study by your recorded deadline.", end.quote);
      else add("end", "Return to study", "clarify", "Confirm an end date that allows you to return to academic study.");
    }
    if (p.computingProjectRequired) {
      const project = facts.project || {};
      const relevant = project.status === "relevant" && project.quote;
      add("project", "Computing project", relevant ? "compatible" : project.status === "unrelated" && project.quote ? conflict(project.fixed) : "clarify",
        relevant ? `The posting describes work addressing a defined organisational problem relevant to ${p.projectArea}.` : "Confirm a defined organisational problem and computing-related deliverables. Any suitable sector is acceptable; general duties alone do not establish project suitability.", project.quote);
    }
    return { status: checks.some(c => c.status === "blocker") ? "blocker" : checks.some(c => c.status === "clarify") ? "clarify" : "compatible", profile: p, checks };
  }
  globalThis.PlacementProfile = Object.freeze({ defaults, normalize, errors, fingerprint, evaluate, date });
})();
