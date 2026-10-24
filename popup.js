"use strict";

// ---------------------------------------------------------------------------
// popup.js — ShouldIApply panel UI (fit-first + Missing Data Mode).
// Renders in two surfaces: a chrome floating window and the injected overlay
// iframe. Both host popup.html, so styling/behavior is shared.
// ---------------------------------------------------------------------------

const els = {
  noKey: document.getElementById("no-key"),
  openSettings: document.getElementById("open-settings"),
  summarizeBtn: document.getElementById("summarize-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  summaryText: document.getElementById("summary-text"),
  jobView: document.getElementById("job-view"),

  panelFooter: document.getElementById("panel-footer"),
  btnChecklist: document.getElementById("btn-checklist"),
  btnCopy: document.getElementById("btn-copy"),
  footFlags: document.getElementById("foot-flags"),
  footFlagsText: document.getElementById("foot-flags-text"),
  linkReanalyze: document.getElementById("link-reanalyze"),
  linkChat: document.getElementById("link-chat"),

  btnSettings: document.getElementById("btn-settings"),
  btnChat: document.getElementById("btn-chat"),
  btnPin: document.getElementById("btn-pin"),
  btnDock: document.getElementById("btn-dock"),
  btnClose: document.getElementById("btn-close"),

  chatDrawer: document.getElementById("chat-drawer"),
  chatBack: document.getElementById("chat-back"),
  chatClose: document.getElementById("chat-close"),
  chips: document.getElementById("chips"),
  chatLog: document.getElementById("chat-log"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  chatStatus: document.getElementById("chat-status"),

  checklistModal: document.getElementById("checklist-modal"),
  checklistClose: document.getElementById("checklist-close"),
  checklistList: document.getElementById("checklist-list"),
  btnCopySelected: document.getElementById("btn-copy-selected"),
};

let extracted = null;
let history = [];
let chatInFlight = false;
let currentTabId = null;
let currentJob = null;
let currentFit = null;
let currentFitFallback = null;
let currentAnalysis = null; // retained only for old saved sessions
let currentContentType = null;

// Analysis "in flight" guard so we don't double-fire missing-data calls.
let analyzing = false;

const MAX_LOCAL_HISTORY = 10;
const SESSIONS_KEY = "summaSessions";
const LEGACY_SESSION_KEY = "summaSession";

const DEFAULT_CHIPS = [
  { label: "What skills or qualifications are required?", question: "What skills or qualifications are required?" },
  { label: "What are the main responsibilities?", question: "What are the main responsibilities?" },
  { label: "What benefits or perks are offered?", question: "What benefits or perks are offered?" },
  { label: "What are the key takeaways?", question: "What are the 3–5 most important key takeaways from this content?" },
  { label: "Summarize this in one paragraph", question: "Summarize the entire content in a single concise paragraph." },
  { label: "What are the pros and cons?", question: "What are the main pros and cons discussed in this content?" },
  { label: "What are the gaps against my CV?", question: "What are the gaps between my CV and this job posting?" },
  { label: "What's missing or unclear?", question: "What important information is missing or unclear in this content?" },
];
const CV_CHIP = { label: "Is this a good fit for my CV?", question: "Is this a good fit for my CV? What am I missing?" };

// ---------------------------------------------------------------------------
// Inline SVG icons (self-contained, no font file / network). Icons are static
// strings we control, so assigning via innerHTML is safe (never LLM text).
// ---------------------------------------------------------------------------
const ICONS = {
  close: '<path d="M6.5 6.5L17.5 6.5M6.5 17.5L17.5 17.5M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  push_pin: '<path d="M12 4a4 4 0 0 1 0 4M12 8L12 16M12 20a2 2 0 0 1 0 2" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  chat: '<path d="M7 5a5 5 0 0 1 0 5M4 14a4 4 0 0 1 0 4M11 10a3 3 0 0 1 0 3" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  lock: '<path d="M7 6a5 5 0 0 1 0 5M6 11h12v6M9 17h6" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 8h0" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="8" r="1.4" fill="currentColor"/>',
  report_problem: '<path d="M12 5l-6 -2.5M12 5l6 -2.5M8 9h8v8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 14v6" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="20" r="1.6" fill="currentColor"/>',
  location_off: '<circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 7L12 18M8 6L16 18M16 6L8 18" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  work_history: '<rect x="6" y="6" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M10 6v3M8 3L8 6" stroke="currentColor" stroke-width="1.6"/>',
  monetization_on: '<path d="M7 5h10M9 5v14M11 5v14M7 11h10" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M10 5v14" stroke="currentColor" stroke-width="1.7"/>',
  help_center: '<circle cx="12" cy="10" r="6" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 10L12 17M12 17h0" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  help: '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M11 11L11 20" stroke="currentColor" stroke-width="1.7"/><circle cx="11" cy="20" r="1.1" fill="currentColor"/>',
  public: '<circle cx="12" cy="13" r="7" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="12" cy="8" r="2.4" fill="currentColor"/>',
  check_circle: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M8 16L11 13L15 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  question_mark: '<path d="M9 6v14M13 8v2M13 8l4 4M8 6v3" stroke="currentColor" stroke-width="1.9" fill="none"/><circle cx="17" cy="20" r="1.1" fill="currentColor"/>',
  corporate_fare: '<rect x="5" y="9" width="14" height="11" rx="1" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 4h8M8 4v5" stroke="currentColor" stroke-width="1.6"/>',
  psychology_alt: '<path d="M12 8L16 5M12 8L8 5M12 8L12 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="12" cy="20" r="1.3" fill="currentColor"/>',
  business: '<rect x="5" y="6" width="14" height="12" rx="1" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 6v5" stroke="currentColor" stroke-width="1.6"/>',
  shield: '<path d="M12 4l-6 6l12 0l6 6M6 10h12v8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 14h0" stroke="currentColor" stroke-width="1.8"/>',
  contact_support: '<rect x="5" y="6" width="14" height="11" rx="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M9 12h6M12 12L12 4" stroke="currentColor" stroke-width="1.7"/>',
  content_copy: '<rect x="5" y="5" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.7" fill="none"/><rect x="5" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  refresh: '<path d="M12 5a7 7 0 0 1 0 7M12 19a7 7 0 0 1 0 7M12 5L12 19" stroke="currentColor" stroke-width="1.9" fill="none"/>',
  assignment: '<path d="M5 4h14v16M5 8v8M8 16h5M9 20l7 -3" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  done_all: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M8 16L11 13L15 17M12 9l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  expand_more: '<path d="M12 6L12 18M6 12L18 12M12 18l-6 -6M12 18l6 -6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  chevron: '<path d="M12 6L12 18M13 12L7 12M19 12L13 12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/>',
  settings: '<circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 6v12M6 12h12M6 8h2M18 8h-2M6 16h2M18 16h-2" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  volume_up: '<path d="M12 8h0M8 4v16M10 6v12M12 8v8M14 6v3M16 4v9" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  calendar: '<rect x="7" y="4" width="10" height="16" rx="2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M9 9h6M9 9v7" stroke="currentColor" stroke-width="1.4"/>',
};

function icon(name, extraClass) {
  const body = ICONS[name] || ICONS.help;
  const cls = extraClass ? " icon-svg " + extraClass : " icon-svg";
  return '<span class="' + cls + '"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' + body + "</svg></span>";
}

// Render a collection of static icon spans for any container with [data-icon].
function hydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.getAttribute("data-icon"));
  });
}

// ---------------------------------------------------------------------------
// Session persistence (scoped per tab, survives popup close/reopen)
// ---------------------------------------------------------------------------
function sessionSlot(tabId) { return tabId == null ? null : "tab-" + tabId; }

async function saveSession() {
  if (!extracted || currentTabId == null) return;
  const slot = sessionSlot(currentTabId);
  const tab = await chrome.tabs.get(currentTabId).catch(() => null);
  const { [SESSIONS_KEY]: all } = await chrome.storage.local.get([SESSIONS_KEY]);
  const sessions = all && typeof all === "object" ? all : {};
  sessions[slot] = {
    savedAt: Date.now(),
    sourceUrl: tab && tab.url ? tab.url : null,
    extracted,
    summary: els.summaryText.dataset && els.summaryText.dataset.raw ? els.summaryText.dataset.raw : "",
    history,
    contentType: currentContentType,
    job: currentJob,
    fit: currentFit,
    fitFallback: currentFitFallback,
  };
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

async function clearSession() {
  if (currentTabId == null) return;
  const slot = sessionSlot(currentTabId);
  const { [SESSIONS_KEY]: all } = await chrome.storage.local.get([SESSIONS_KEY]);
  if (!all || typeof all !== "object") return;
  delete all[slot];
  const keys = Object.keys(all);
  if (keys.length === 0) {
    await chrome.storage.local.remove(SESSIONS_KEY);
  } else {
    await chrome.storage.local.set({ [SESSIONS_KEY]: all });
  }
}

async function migrateLegacy() {
  const { [LEGACY_SESSION_KEY]: legacy } = await chrome.storage.local.get([LEGACY_SESSION_KEY]);
  if (legacy) {
    await chrome.storage.local.remove(LEGACY_SESSION_KEY);
  }
}

// ---------------------------------------------------------------------------
// Generic summary rendering (non-job pages). DOM-built so untrusted page text
// is never interpreted as HTML.
// ---------------------------------------------------------------------------
function renderSummary(text) {
  const container = els.summaryText;
  container.innerHTML = "";
  container.dataset.raw = text || "";
  const lines = (text || "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const ul = document.createElement("ul");
  ul.className = "summary-bullets";
  for (const line of lines) {
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m) {
      const li = document.createElement("li");
      li.textContent = m[1];
      ul.appendChild(li);
    } else if (line.toLowerCase().startsWith("summary")) {
      // skip a leading "Summary:" label line if present
    } else {
      const p = document.createElement("p");
      p.className = "summary-line";
      p.textContent = line;
      container.appendChild(p);
    }
  }
  if (ul.childNodes.length > 0) container.appendChild(ul);
}

// ---------------------------------------------------------------------------
// Lightweight Markdown rendering for chat answers (DOM-built, safe)
// ---------------------------------------------------------------------------
function appendInline(parent, text) {
  const tokenRe = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (let m; (m = tokenRe.exec(text)); ) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**")) {
      const b = document.createElement("strong");
      b.textContent = tok.slice(2, -2);
      parent.appendChild(b);
    } else if (tok.startsWith("*") && !tok.startsWith("**")) {
      const i = document.createElement("em");
      i.textContent = tok.slice(1, -1);
      parent.appendChild(i);
    } else if (tok.startsWith("`")) {
      const c = document.createElement("code");
      c.textContent = tok.slice(1, -1);
      parent.appendChild(c);
    } else if (tok.startsWith("[")) {
      const close = tok.lastIndexOf("](");
      const label = tok.slice(1, close);
      const href = tok.slice(close + 2, -1);
      const a = document.createElement("a");
      a.textContent = label;
      a.href = /^https?:\/\//i.test(href) ? href : "#";
      a.target = "_blank";
      a.rel = "noreferrer";
      parent.appendChild(a);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderMarkdown(content) {
  const wrapper = document.createElement("div");
  wrapper.className = "md-body";
  const raw = (content || "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");
  const out = wrapper;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const eh = document.createElement("h" + (h[1].length === 1 ? 1 : h[1].length));
      appendInline(eh, h[2]);
      out.appendChild(eh);
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const ul = document.createElement("ul");
      ul.className = "md-list";
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendInline(li, lines[i].replace(/^\s*[-*•]\s+/, ""));
        ul.appendChild(li);
        i++;
      }
      out.appendChild(ul);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const ol = document.createElement("ol");
      ol.className = "md-list";
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendInline(li, lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        ol.appendChild(li);
        i++;
      }
      out.appendChild(ol);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.appendChild(document.createElement("hr"));
      i++;
      continue;
    }
    const pLines = [line];
    i++;
    while (i < lines.length) {
      const n = lines[i].trim();
      if (n === "" || /^(#{1,3})\s+/.test(n) || /^\s*[-*•]\s+/.test(n) || /^\s*\d+[.)]\s+/.test(n) || /^\s*(---+|\*\*\*+)\s*$/.test(n)) break;
      pLines.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    p.className = "md-p";
    appendInline(p, pLines.join(" ").trim());
    out.appendChild(p);
  }
  return wrapper;
}
// ---------------------------------------------------------------------------
// Status + chat helpers
// ---------------------------------------------------------------------------
function setStatus(text) { els.status.hidden = !text; els.status.textContent = text || ""; }
function setChatStatus(text) { els.chatStatus.hidden = !text; els.chatStatus.textContent = text || ""; }

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = "message " + role;
  const label = document.createElement("span");
  label.className = "role-label " + role;
  label.textContent = role === "user" ? "You" : "ShouldIApply";
  div.appendChild(label);
  if (role === "assistant") {
    div.appendChild(renderMarkdown(content));
  } else {
    const body = document.createElement("span");
    body.className = "plain-text";
    body.textContent = content;
    div.appendChild(body);
  }
  els.chatLog.appendChild(div);
  const scroller = els.chatLog.closest ? els.chatLog.closest(".chat-scroll") : null;
  const sc = scroller || els.chatLog;
  sc.scrollTop = sc.scrollHeight;
}

function setChatBusy(busy) {
  els.chatInput.disabled = busy;
  els.chatSend.disabled = busy;
  els.chips.querySelectorAll("button").forEach((b) => (b.disabled = busy));
}

async function renderChips() {
  const chips = [...DEFAULT_CHIPS];
  const { cvText } = await chrome.storage.local.get(["cvText"]);
  if (cvText && cvText.trim()) chips.push(CV_CHIP);
  els.chips.innerHTML = "";
  chips.forEach(({ label, question }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", () => askChat(question));
    els.chips.appendChild(b);
  });
}

function openChat() {
  els.chatDrawer.hidden = false;
  const sc = els.chatDrawer.querySelector(".chat-scroll");
  if (sc) sc.scrollTop = sc.scrollHeight;
  els.chatInput.focus();
}
function closeChat() { els.chatDrawer.hidden = true; }
function toggleChat() { if (els.chatDrawer.hidden) { openChat(); } else { closeChat(); } }

// ---------------------------------------------------------------------------
// Generic DOM helpers for building job view
// ---------------------------------------------------------------------------
function jobEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function spanHtml(html) {
  const s = document.createElement("span");
  s.innerHTML = html;
  return s;
}

function showNoKey() {
  els.noKey.hidden = false;
  els.summarizeBtn.hidden = true;
  setStatus("");
}

function showTabClosedNotice() {
  els.summarizeBtn.disabled = true;
  els.summarizeBtn.hidden = true;
  setChatBusy(true);
  els.result.hidden = true;
  setStatus("The page this window was open for was closed. Click the ShouldIApply icon on a tab to start fresh.");
}

function handleError(res) {
  const code = res && res.error;
  const message = (res && res.message) || "Something went wrong.";
  if (code === "NO_API_KEY" || code === "INVALID_API_KEY") {
    showNoKey();
  } else if (code === "NO_TAB") {
    showTabClosedNotice();
  } else {
    setStatus(message);
  }
}

// Verdict bucketing (base band from score only).
function verdictBand(score) {
  if (typeof score !== "number" || score < 0 || score > 100) return null;
  if (score >= 80) return { label: "Strong Match", tone: "strong" };
  if (score >= 55) return { label: "Partial Match", tone: "partial" };
  return { label: "Weak Match", tone: "weak" };
}

function fitGaps(fit) {
  const g = (fit && Array.isArray(fit.gaps)) ? fit.gaps : [];
  return g.filter((x) => x && typeof x === "object");
}

// Deterministic verdict cap. The model classifies gap severity; a single
// "blocker" caps the band at "Needs verification" regardless of fitScore.
function fitVerdict(fit) {
  const base = verdictBand(fit && fit.fitScore) || { label: "No fit score", tone: "none" };
  const gaps = fitGaps(fit);
  const blockers = gaps.filter((g) => g.severity === "blocker").length;
  const risks = gaps.filter((g) => g.severity === "risk").length;
  if (blockers > 0) {
    return { band: { label: "Needs verification", tone: "partial" }, blockerCount: blockers, riskCount: risks, capped: true };
  }
  return { band: base, blockerCount: 0, riskCount: risks, capped: false };
}

function templatedFitReason(fit) {
  fit = fit || {};
  const gaps = fitGaps(fit);
  const blockers = gaps.filter((g) => g.severity === "blocker").length;
  const risks = gaps.filter((g) => g.severity === "risk").length;
  if (blockers > 0) return blockers + " blocker" + (blockers === 1 ? "" : "s") + " to verify before applying.";
  if (risks > 0) return risks + " potential risk" + (risks === 1 ? "" : "s") + " to review below.";
  const matched = Array.isArray(fit.matched) ? fit.matched.length : 0;
  const missing = Array.isArray(fit.missing) ? fit.missing.length : 0;
  const total = matched + missing;
  if (total === 0) return "No core requirements were extracted for this posting.";
  if (missing === 0) return "You meet all " + total + " core requirement" + (total === 1 ? "" : "s") + ".";
  return "Missing " + missing + " of " + total + " core requirement" + (total === 1 ? "" : "s") + ".";
}

// ---------------------------------------------------------------------------
// Missing-data / quick-fact analysis (computed client-side from job schema)
// ---------------------------------------------------------------------------
function fmtMoney(n) {
  if (n == null) return "";
  if (n >= 1000) return "$" + Math.round(n / 1000) + "k";
  return "$" + n;
}
function fmtRange(c) {
  c = c || {};
  return (fmtMoney(c.min) || "?") + "–" + (fmtMoney(c.max) || "?") + " / " + (c.period || "year");
}
function visaClarity(job) {
  const elig = (job.eligibility || []).map((s) => String(s).toLowerCase()).filter((s) => s);
  const flags = (job.flags || []).map((f) => String(f.text || "").toLowerCase()).filter((s) => s);
  const hay = elig.concat(flags).join(" ");
  // Conditional / limiting signals first - these must never read as "sponsored".
  const limited = /no\s*(visa\s*)?sponsor|no[\w\s-]*sponsorship|does ?not.*sponsor|without.*sponsor|own (legal )?right to work|must have.*(right to work|visa)|require.*(sponsor|right to work)|unless.*sponsor|cannot.*sponsor|not able.*sponsor/;
  if (limited.test(hay)) return "conditional";
  // Explicit, unconditional sponsorship signal.
  const pos = /visa\s*(sponsorship|sponsor(ed)?|support)\b|sponsorship\s+(is\s+)?available\b|will\s+(sponsor|support).*\bvisa\b/;
  if (pos.test(hay)) return "supported";
  if (/right to work|work\s*(authorization|eligibility)|citizenship|nationality/.test(hay)) return "conditional";
  return "unclear";
}

function computeQuickFacts(job) {
  const role = job.role || {};
  const c = job.compensation || {};
  const facts = [];
  let omissions = 0;
  const loc = role.location ? String(role.location).trim() : "";
  const isUnspec = !loc || /unspecified|n\/a|not (disclosed|listed)|unknown/i.test(loc);

  if (c.min != null || c.max != null) {
    facts.push({ icon: "monetization_on", status: "confirmed", label: "Salary", value: fmtRange(c) });
  } else {
    facts.push({ icon: "monetization_on", status: "warn", label: "Salary", value: "Not Disclosed on Page" });
    omissions++;
  }

  if (!isUnspec) {
    facts.push({ icon: "location_off", status: "confirmed", label: "Location", value: loc });
  } else {
    facts.push({ icon: "location_off", status: "neutral", label: "Location", value: "Not Disclosed" });
    omissions++;
  }

  if (role.workArrangement) {
    facts.push({ icon: "work_history", status: "confirmed", label: "Work", value: role.workArrangement });
  } else {
    facts.push({ icon: "help_center", status: "missing", label: "Work", value: "Hybrid / Remote Unspecified" });
  }

  const et = job.employmentType ? String(job.employmentType).trim() : "";
  if (et) {
    facts.push({ icon: "work_history", status: "confirmed", label: "Employment", value: et });
  } else {
    facts.push({ icon: "work_history", status: "neutral", label: "Employment", value: "Unspecified" });
  }

  const visa = visaClarity(job);
  if (visa === "supported") {
    facts.push({ icon: "public", status: "confirmed", label: "Visa", value: "Sponsorship available" });
  } else if (visa === "none") {
    facts.push({ icon: "public", status: "confirmed", label: "Visa", value: "No sponsorship available" });
  } else if (visa === "conditional") {
    facts.push({ icon: "public", status: "warn", label: "Visa", value: "Right to work required — verify", warn: true });
    omissions++;
  } else {
    facts.push({ icon: "public", status: "warn", label: "Visa", value: "Unclear — verify", warn: true });
    omissions++;
  }

  return { facts, omissions };
}

function buildRing(score, tone) {
  const circ = 2 * Math.PI * 19;
  const pct = typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;
  const offset = circ - (circ * pct) / 100;
  return (
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
      '<circle class="track" cx="24" cy="24" r="19" />' +
      '<circle class="progress" cx="24" cy="24" r="19" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" />' +
    "</svg>"
  );
}

// ---------------------------------------------------------------------------
// Fit verdict hero + quick-facts + skills matrix rendering
// ---------------------------------------------------------------------------
function renderFitHero(job, fit) {
  const vd = fitVerdict(fit);
  const band = vd.band;
  const score = fit && typeof fit.fitScore === "number" ? fit.fitScore : null;
  const role = job.role || {};

  const hero = document.createElement("div");
  hero.className = "fit-hero";

  // Header row: live label + title/company (left), ring (right)
  const header = document.createElement("div");
  header.className = "fit-header";
  const info = document.createElement("div");
  info.className = "fit-info";
  const live = document.createElement("span");
  live.className = "live";
  live.textContent = "Live Analysis";
  const title = document.createElement("h1");
  title.className = "fit-title";
  title.textContent = role.title || "Untitled role";
  const comp = document.createElement("div");
  comp.className = "fit-company";
  comp.appendChild(spanHtml(icon("lock", "icon")));
  comp.appendChild(document.createTextNode(" " + (role.company || "Unknown company")));
  const loc = role.location ? String(role.location).trim() : "";
  const isUnspec = !loc || /unspecified|n\/a|not (disclosed|listed)|unknown/i.test(loc);
  if (!isUnspec) {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = " • ";
    comp.appendChild(sep);
    comp.appendChild(document.createTextNode(loc));
  } else {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = " • ";
    comp.appendChild(sep);
    const w = document.createElement("span");
    w.className = "warn";
    w.textContent = "Location Unspecified";
    comp.appendChild(w);
  }
  info.appendChild(live);
  info.appendChild(title);
  info.appendChild(comp);
  header.appendChild(info);

  const ringWrap = document.createElement("div");
  ringWrap.className = "fit-ring-wrap";
  const ring = document.createElement("div");
  ring.className = "fit-ring " + band.tone;
  ring.appendChild(spanHtml(buildRing(score == null ? 0 : score, band.tone)));
  const ringLabel = document.createElement("div");
  ringLabel.className = "ring-label";
  const num = document.createElement("span");
  num.className = "ring-num";
  num.textContent = score == null ? "—" : Math.round(score) + "%";
  const unit = document.createElement("span");
  unit.className = "ring-unit";
  unit.textContent = "FIT";
  ringLabel.appendChild(num);
  ringLabel.appendChild(unit);
  ring.appendChild(ringLabel);
  ringWrap.appendChild(ring);
  if (vd.blockerCount > 0) {
    const badge = document.createElement("span");
    badge.className = "ring-badge blocker";
    badge.textContent = "⛔ " + vd.blockerCount + " blocker" + (vd.blockerCount === 1 ? "" : "s");
    ringWrap.appendChild(badge);
  }
  header.appendChild(ringWrap);
  hero.appendChild(header);

  // Verdict banner
  const banner = document.createElement("div");
  banner.className = "verdict-banner " + band.tone;
  const bIcon = spanHtml(icon(band.tone === "strong" ? "check_circle" : "report_problem", "icon"));
  banner.appendChild(bIcon);
  const bText = document.createElement("span");
  bText.textContent = "Verdict: ";
  const bStrong = document.createElement("strong");
  bStrong.textContent = band.label;
  bText.appendChild(bStrong);
  banner.appendChild(bText);
  if (vd.capped) {
    const ed = document.createElement("span");
    ed.className = "ed";
    ed.textContent = " — " + vd.blockerCount + " blocker" + (vd.blockerCount === 1 ? "" : "s") + " to verify";
    banner.appendChild(ed);
  } else if (band.tone === "partial") {
    const ed = document.createElement("span");
    ed.className = "ed";
    ed.textContent = " — Needs Verification";
    banner.appendChild(ed);
  } else if (band.tone === "weak") {
    const ed = document.createElement("span");
    ed.className = "ed";
    ed.textContent = " — review gaps before deciding";
    banner.appendChild(ed);
  }
  hero.appendChild(banner);

  // One-line reason (templated from counts)
  const reason = document.createElement("div");
  reason.className = "ai-est";
  reason.appendChild(spanHtml(icon("info", "icon")));
  const reasonText = document.createElement("span");
  // Keep the primary explanation deterministic rather than model-authored.
  reasonText.textContent = templatedFitReason(fit || { matched: [], missing: [] });
  reason.appendChild(reasonText);
  hero.appendChild(reason);

  return hero;
}

function renderOmissionPill(omissions) {
  const pill = document.createElement("div");
  pill.className = "omission-pill";
  pill.appendChild(spanHtml(icon("info", "icon")));
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = omissions + (omissions === 1 ? " high-impact omission" : " high-impact omissions");
  p.appendChild(document.createTextNode("Scanner detected "));
  p.appendChild(strong);
  p.appendChild(document.createTextNode(" in this posting. Evaluate suggested inquiries below."));
  pill.appendChild(p);
  return pill;
}

function renderFlags(job) {
  const flags = Array.isArray(job.flags) ? job.flags.filter((f) => f && f.text) : [];
  if (!flags.length) return null;
  const callout = document.createElement("section");
  callout.className = "gap-card";
  const title = document.createElement("h3");
  title.className = "gap-title";
  title.textContent = "Important eligibility and role flags";
  callout.appendChild(title);
  const list = document.createElement("ul");
  list.className = "gap-list";
  flags.forEach((flag) => {
    const item = document.createElement("li");
    item.className = "gap-row";
    item.appendChild(spanHtml(icon("report_problem", "icon")));
    const text = document.createElement("span");
    text.className = "gap-text";
    text.textContent = flag.text;
    item.appendChild(text);
    const severity = document.createElement("span");
    severity.className = "tag " + (flag.severity === "warning" ? "risk" : "minor");
    severity.textContent = flag.severity === "warning" ? "Warning" : "Info";
    item.appendChild(severity);
    list.appendChild(item);
  });
  callout.appendChild(list);
  return callout;
}

function renderFitFallback(text) {
  const card = document.createElement("section");
  card.className = "gap-card";
  const title = document.createElement("h3");
  title.className = "gap-title";
  title.textContent = "CV comparison";
  card.appendChild(title);
  const body = document.createElement("p");
  body.className = "gap-note";
  body.textContent = text;
  card.appendChild(body);
  return card;
}

function renderQuickFacts(job, facts) {
  const wrap = document.createElement("div");
  wrap.className = "facts-wrap";
  const head = document.createElement("div");
  head.className = "facts-head";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Parameters Extracted";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = facts.filter((f) => f.status === "confirmed").length + " of " + facts.length + " Confirmed";
  head.appendChild(label);
  head.appendChild(count);
  wrap.appendChild(head);

  const row = document.createElement("div");
  row.className = "facts-row";
  facts.forEach((f) => {
    const chip = document.createElement("span");
    chip.className = "fact-chip " + f.status;
    chip.appendChild(spanHtml(icon(f.icon, "icon")));
    const labelNode = document.createTextNode(f.label + ": ");
    chip.appendChild(labelNode);
    const val = document.createElement("strong");
    if (f.warn) val.className = "warn";
    val.textContent = f.value;
    chip.appendChild(val);
    row.appendChild(chip);
  });
  wrap.appendChild(row);
  return wrap;
}

// ---------------------------------------------------------------------------
// Skills compatibility matrix (confirmed matches vs ambiguous-in-posting)
// ---------------------------------------------------------------------------
function renderSkillsMatrix(job, fit) {
  const reqs = job.requirements || [];
  const matched = (fit && Array.isArray(fit.matched)) ? fit.matched : [];
  const ambiguous = reqs.filter((r) => r.ambiguous);

  const card = document.createElement("div");
  card.className = "skills-card";
  const head = document.createElement("div");
  head.className = "skills-head";
  const h2 = document.createElement("h2");
  h2.textContent = "Why this score";
  const count = document.createElement("span");
  count.className = "skills-count";
  count.textContent = matched.length + " of " + reqs.length + " matched";
  head.appendChild(h2);
  head.appendChild(count);
  card.appendChild(head);

  const intro = document.createElement("p");
  intro.className = "skills-intro";
  if (ambiguous.length) {
    intro.appendChild(document.createTextNode("You match " + matched.length + " of " + reqs.length + " identified skills ("));
    const w = document.createElement("span");
    w.className = "warn";
    w.textContent = ambiguous.length + " skill" + (ambiguous.length === 1 ? "" : "s") + " ambiguous";
    intro.appendChild(w);
    intro.appendChild(document.createTextNode(" in source text)."));
  } else {
    intro.appendChild(document.createTextNode("You match " + matched.length + " of " + reqs.length + " identified skills."));
  }
  card.appendChild(intro);

  const list = document.createElement("div");
  list.className = "skills-list";

  matched.forEach((m) => {
    const row = document.createElement("div");
    row.className = "skill-row matched";
    const left = document.createElement("div");
    left.className = "left";
    left.appendChild(spanHtml(icon("check_circle", "icon")));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.requirement;
    left.appendChild(name);
    row.appendChild(left);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Confirmed Match";
    row.appendChild(tag);
    list.appendChild(row);
    if (m.why) {
      const evidence = document.createElement("p");
      evidence.className = "gap-why";
      evidence.textContent = m.why;
      list.appendChild(evidence);
    }
  });

  ambiguous.forEach((r) => {
    const row = document.createElement("div");
    row.className = "skill-row ambiguous";
    const body = document.createElement("div");
    body.className = "body left";
    const top = document.createElement("div");
    top.className = "left";
    top.appendChild(spanHtml(icon("question_mark", "icon")));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.text;
    top.appendChild(name);
    body.appendChild(top);
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = r.note || "Ambiguous in the posting wording — confirm scope with the recruiter.";
    body.appendChild(note);
    row.appendChild(body);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Ambiguous in Post";
    row.appendChild(tag);
    list.appendChild(row);
  });

  if (!matched.length && !ambiguous.length) {
    const empty = document.createElement("p");
    empty.className = "skills-intro";
    empty.textContent = fit ? "No requirements were extracted for this posting." : "Add your CV to see skill-by-skill compatibility.";
    list.appendChild(empty);
  }

  card.appendChild(list);
  return card;
}

function renderGaps(job, fit) {
  if (!fit) return null; // no CV fitted -> the cv-onboard prompt covers this
  const missing = Array.isArray(fit.missing) ? fit.missing : [];
  const hard = fitGaps(fit);

  const card = document.createElement("div");
  card.className = "gap-card";
  const h = document.createElement("h3");
  h.className = "gap-title";
  h.textContent = "Gaps vs your CV";
  card.appendChild(h);

  if (!missing.length && !hard.length) {
    const p = document.createElement("p");
    p.className = "gap-none";
    p.textContent = "You cover every listed requirement and hard gate on this posting — no gaps found.";
    card.appendChild(p);
    return card;
  }

  const ul = document.createElement("ul");
  ul.className = "gap-list";

  // Requirement-level gaps (from the CV-fit missing[]).
  missing.forEach((m) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "gap-row";
    row.appendChild(spanHtml(icon("question_mark", "icon")));
    const t = document.createElement("span");
    t.className = "gap-text";
    t.textContent = m.requirement;
    row.appendChild(t);
    const tag = document.createElement("span");
    tag.className = "tag missing";
    tag.textContent = "Missing";
    row.appendChild(tag);
    li.appendChild(row);
    if (m.why) {
      const why = document.createElement("p");
      why.className = "gap-why";
      why.textContent = m.why;
      li.appendChild(why);
    }
    ul.appendChild(li);
  });

  // Hard-criteria gaps (model-classified severity: blocker/risk/minor).
  hard.forEach((g) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "gap-row";
    row.appendChild(spanHtml(icon(g.severity === "blocker" ? "report_problem" : "question_mark", "icon")));
    const t = document.createElement("span");
    t.className = "gap-text";
    t.textContent = (g.area ? g.area + ": " : "") + g.text;
    row.appendChild(t);
    const tag = document.createElement("span");
    tag.className = "tag " + g.severity;
    tag.textContent = g.severity === "blocker" ? "Blocker" : g.severity === "risk" ? "Risk" : "Minor";
    row.appendChild(tag);
    li.appendChild(row);
    ul.appendChild(li);
  });

  card.appendChild(ul);

  const note = document.createElement("p");
  note.className = "gap-note";
  note.textContent = "Requirement gaps come from the CV match; hard-criteria gaps (severity) come from eligibility, timing, visa or relocation. Ask a follow-up for a deeper plan.";
  card.appendChild(note);
  return card;
}

// ---------------------------------------------------------------------------
// Accordions + detail sections
// ---------------------------------------------------------------------------
function accSection(title, iconName, badge, buildBody, openByDefault) {
  const acc = document.createElement("div");
  acc.className = "acc";
  if (openByDefault) acc.setAttribute("open", "");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "acc-button";
  const left = document.createElement("div");
  left.className = "left";
  left.appendChild(spanHtml(icon(iconName, "icon")));
  const t = document.createElement("span");
  t.className = "title";
  t.textContent = title;
  left.appendChild(t);
  button.appendChild(left);
  if (badge) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = badge;
    button.appendChild(b);
  }
  const chev = document.createElement("span");
  chev.className = "acc-chevron";
  chev.appendChild(spanHtml(icon("expand_more")));
  button.appendChild(chev);
  const body = document.createElement("div");
  body.className = "acc-body";
  buildBody(body);
  button.addEventListener("click", () => {
    if (acc.hasAttribute("open")) { acc.removeAttribute("open"); } else { acc.setAttribute("open", ""); }
  });
  acc.appendChild(button);
  acc.appendChild(body);
  return acc;
}

function reqList(job) {
  const ul = document.createElement("ul");
  ul.className = "req-list";
  (job.requirements || []).forEach((r) => {
    const li = document.createElement("li");
    const tier = document.createElement("span");
    tier.className = "tier " + r.tier;
    tier.textContent = r.tier.replace("-", " ");
    li.appendChild(tier);
    li.appendChild(document.createTextNode(r.text));
    if (r.ambiguous) {
      const amb = document.createElement("span");
      amb.className = "amb";
      amb.textContent = "ambiguous";
      li.appendChild(document.createTextNode(" "));
      li.appendChild(amb);
    }
    ul.appendChild(li);
  });
  return ul;
}

function plainList(list) {
  const ul = document.createElement("ul");
  ul.className = "plain-list";
  (list || []).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
  return ul;
}

function renderBenchmark(body, analysis) {
  const est = analysis && analysis.salaryEstimate;
  if (!est || est.min == null) {
    body.appendChild(plainList(["Compensation not disclosed in posting."]));
    return;
  }
  const market = document.createElement("div");
  market.className = "market";
  const marks = document.createElement("div");
  marks.className = "marks";
  const p25 = document.createElement("span");
  p25.textContent = "Market 25th: " + fmtMoney(est.min);
  const med = document.createElement("span");
  med.className = "med";
  med.textContent = "Median: " + fmtMoney(est.median);
  const p75 = document.createElement("span");
  p75.textContent = "Market 75th: " + fmtMoney(est.max);
  marks.appendChild(p25);
  marks.appendChild(med);
  marks.appendChild(p75);
  market.appendChild(marks);
  const bar = document.createElement("div");
  bar.className = "market-bar";
  const lo = document.createElement("div");
  lo.className = "lo";
  const mid = document.createElement("div");
  mid.className = "mid";
  mid.style.width = "50%";
  const hi = document.createElement("div");
  hi.className = "hi";
  bar.appendChild(lo);
  bar.appendChild(mid);
  bar.appendChild(hi);
  market.appendChild(bar);

  const ai = document.createElement("div");
  ai.className = "ai-est";
  ai.appendChild(spanHtml(icon("info", "icon")));
  const aiText = document.createElement("span");
  aiText.textContent = "AI-estimated from market knowledge, not scraped from a source. Verify with the recruiter.";
  ai.appendChild(aiText);
  market.appendChild(ai);

  if (est.note) {
    const block = document.createElement("div");
    block.className = "detail-block";
    const p = document.createElement("p");
    p.textContent = est.note;
    block.appendChild(p);
    body.appendChild(block);
  }
}

function renderDetails(job, analysis) {
  const details = document.createElement("div");
  details.className = "details";

  if ((job.requirements || []).length) {
    details.appendChild(accSection("Key Requirements", "check_circle", String(job.requirements.length) + " reqs", (b) => b.appendChild(reqList(job)), false));
  }

  if ((job.responsibilities || []).length) {
    details.appendChild(accSection("Responsibilities", "work_history", String(job.responsibilities.length), (b) => b.appendChild(plainList(job.responsibilities))));
  }
  if ((job.benefits || []).length) {
    details.appendChild(accSection("Benefits", "volume_up", String(job.benefits.length), (b) => b.appendChild(plainList(job.benefits))));
  }
  if ((job.eligibility || []).length) {
    details.appendChild(accSection("Eligibility", "shield", String(job.eligibility.length), (b) => b.appendChild(plainList(job.eligibility))));
  }
  if (job.process && (job.process.stages || []).length) {
    const p = job.process;
    const lines = (p.stages || []).map((s) => s.name + (s.detail ? ": " + s.detail : ""));
    (p.assessmentAreas || []).forEach((a) => lines.push(a));
    details.appendChild(accSection("Process", "assignment", String(p.stages.length) + " stages", (b) => b.appendChild(plainList(lines))));
  }

  return accSection("Full job details", "assignment", null, (body) => body.appendChild(details), false);
}

// ---------------------------------------------------------------------------
// CV onboarding footer (no CV saved) + recruiter questions
// ---------------------------------------------------------------------------
function renderCvFooter(job, fit) {
  if (fit) return null; // fit exists -> details already rendered
  const wrap = document.createElement("div");
  wrap.className = "cv-onboard";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Add your CV to see if this job fits you";
  const blurb = document.createElement("p");
  blurb.textContent = "Paste your CV below to compare it with this posting.";
  const input = document.createElement("textarea");
  input.rows = 5;
  input.placeholder = "Paste your CV or resume…";
  input.className = "cv-inline-input";
  const btn = jobEl("button", "primary", "Save CV and analyse");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    const cvText = input.value.trim();
    if (!cvText) { input.focus(); return; }
    await chrome.storage.local.set({ cvText });
    await reanalyze();
  });
  wrap.appendChild(title);
  wrap.appendChild(blurb);
  wrap.appendChild(input);
  wrap.appendChild(btn);
  return wrap;
}

// Client-side fallback questions derived from the job's missing data, used if
// the model-generated checklist hasn't loaded (or fails).
function defaultGapQuestions(job) {
  const q = [];
  const c = job.compensation || {};
  if (c.min == null && c.max == null) q.push("What is the designated base salary band and target bonus or equity range?");
  const r = job.role || {};
  const loc = r.location ? String(r.location).trim() : "";
  if (!loc || /unspecified|unknown|n\/a/.test(loc)) q.push("Is the team distributed, or is there a required in-office cadence at a specific hub?");
  if (!r.workArrangement) q.push("What does the hybrid / remote policy look like in practice for this role?");
  const amb = (job.requirements || []).filter((x) => x.ambiguous);
  amb.forEach((a) => q.push('Can you clarify the scope of "' + a.text + '" for this role?'));
  if (visaClarity(job) === "unclear" || visaClarity(job) === "conditional") q.push("Is visa sponsorship or right-to-work support available for this role?");
  if (!q.length) q.push("What would make a candidate stand out for this role?");
  return q.slice(0, 5);
}

function gapQuestions() {
  const fromModel = currentAnalysis && Array.isArray(currentAnalysis.gapQuestions) ? currentAnalysis.gapQuestions : null;
  return fromModel && fromModel.length ? fromModel : defaultGapQuestions(currentJob);
}

let checklistItems = [];

function renderChecklist() {
  checklistItems = gapQuestions();
  els.checklistList.innerHTML = "";
  checklistItems.forEach((text) => {
    const item = document.createElement("label");
    item.className = "checklist-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    const span = document.createElement("span");
    span.textContent = text;
    item.appendChild(input);
    item.appendChild(span);
    els.checklistList.appendChild(item);
  });
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((res, rej) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      res();
    } catch (e) { rej(e); }
  });
}

async function copySelected() {
  const selected = Array.from(els.checklistList.querySelectorAll(".checklist-item"))
    .map((item) => ({ input: item.querySelector("input"), span: item.querySelector("span") }))
    .filter((o) => o.input.checked)
    .map((o) => o.span.textContent);
  const text = selected.map((c, i) => (i + 1) + ". " + c).join("\n");
  await copyToClipboard(text);
  flashButton(els.btnCopySelected, "Copied!");
  closeChecklist();
}

async function copyGapPrompts() {
  const text = gapQuestions().map((c, i) => (i + 1) + ". " + c).join("\n");
  await copyToClipboard(text);
  flashButton(els.btnCopy, "Copied!");
}

function flashButton(btn, label) {
  const spans = Array.from(btn.querySelectorAll("span"));
  const labelSpan = spans.length ? spans[spans.length - 1] : null;
  const iconSpan = spans.length > 1 ? spans[0] : null;
  if (!labelSpan) {
    const o = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = o; }, 1800);
    return;
  }
  const origIcon = iconSpan ? iconSpan.innerHTML : "";
  const origLabel = labelSpan.textContent;
  labelSpan.textContent = label;
  if (iconSpan) iconSpan.innerHTML = icon("check_circle");
  btn.classList.add("copied");
  setTimeout(() => {
    labelSpan.textContent = origLabel;
    if (iconSpan) iconSpan.innerHTML = origIcon;
    btn.classList.remove("copied");
  }, 1800);
}

function openChecklist() { renderChecklist(); els.checklistModal.hidden = false; }
function closeChecklist() { els.checklistModal.hidden = true; }

// ---------------------------------------------------------------------------
// Main job-view assemble + flow
// ---------------------------------------------------------------------------
let detailsNode = null;
let omissionsCount = 0;

function renderJobViewInto(root, job, fit) {
  // A job page without a CV is intentionally CV-first: do not reveal the
  // secondary requirements breakdown behind the onboarding prompt.
  if (!fit && !currentFitFallback) {
    root.appendChild(renderCvFooter(job, fit));
    els.panelFooter.hidden = true;
    return;
  }
  if (fit) {
    root.appendChild(renderFitHero(job, fit));
  }
  const flags = renderFlags(job);
  if (flags) root.appendChild(flags);
  if (fit) {
    root.appendChild(renderSkillsMatrix(job, fit));
    const gaps = renderGaps(job, fit);
    if (gaps) root.appendChild(gaps);
  } else {
    root.appendChild(renderFitFallback(currentFitFallback));
  }
  detailsNode = renderDetails(job, null);
  root.appendChild(detailsNode);
  omissionsCount = 0;
  updateFooter();
}

function reRenderDetails() {
  if (!detailsNode || !els.jobView) return;
  const newNode = renderDetails(currentJob, null);
  detailsNode.replaceWith(newNode);
  detailsNode = newNode;
}

function updateFooter() {
  els.footFlags.hidden = omissionsCount === 0;
  els.footFlagsText.textContent = omissionsCount + (omissionsCount === 1 ? " Missing Field Flagged" : " Missing Fields Flagged");
  els.panelFooter.hidden = false;
}

async function loadAnalysis() {
  if (!currentJob || analyzing || currentAnalysis) return;
  analyzing = true;
  setStatus("Analyzing missing data…");
  const res = await chrome.runtime.sendMessage({ action: "missingDataAnalysis", job: currentJob });
  analyzing = false;
  if (res && res.ok && res.data) {
    currentAnalysis = res.data;
    await saveSession();
    reRenderDetails();
  }
  // On failure the client-side default questions still drive the checklist.
  setStatus("");
}

async function summarize() {
  if (currentTabId == null) { showTabClosedNotice(); return; }
  els.summarizeBtn.disabled = true;
  setStatus("Checking if this job is right for you…");
  const res = await chrome.runtime.sendMessage({ action: "extractJob", tabId: currentTabId });
  els.summarizeBtn.disabled = false;

  if (res && res.ok) {
    extracted = res.extracted;
    history = [];
    currentJob = res.job || null;
    currentFit = res.fit || null;
    currentFitFallback = res.fitFallback || null;
    currentAnalysis = null;
    analyzing = false;

    if (res.contentType === "job_posting" && currentJob) {
      currentContentType = "job_posting";
      els.summaryText.hidden = true;
      els.summaryText.innerHTML = "";
      els.jobView.innerHTML = "";
      els.jobView.hidden = false;
      renderJobViewInto(els.jobView, currentJob, currentFit);
    } else {
      currentContentType = "not_job_posting";
      els.jobView.hidden = true;
      els.jobView.innerHTML = "";
      els.panelFooter.hidden = true;
      els.summaryText.hidden = false;
      renderSummary(res.summary);
    }

    els.chatLog.innerHTML = "";
    els.chatDrawer.hidden = true;
    els.result.hidden = false;
    setStatus("");
    await renderChips();
    await saveSession();
  } else {
    handleError(res);
  }
}

async function reanalyze() {
  if (!currentJob) return;
  await chrome.runtime.sendMessage({ action: "clearJobCache", url: currentJob.sourceUrl });
  await newSummary();
  summarize();
}

async function newSummary() {
  extracted = null;
  history = [];
  currentJob = null;
  currentFit = null;
  currentFitFallback = null;
  currentAnalysis = null;
  detailsNode = null;
  setStatus("");
  els.result.hidden = true;
  els.panelFooter.hidden = true;
  els.jobView.innerHTML = "";
  els.summaryText.innerHTML = "";
  if (currentTabId != null) await clearSession();
  els.summarizeBtn.hidden = false;
}

async function askChat(question) {
  const q = (question || els.chatInput.value).trim();
  if (!q || !extracted || chatInFlight) return;
  chatInFlight = true;
  setChatBusy(true);
  els.chatInput.value = "";
  addMessage("user", q);
  setChatStatus("Thinking…");
  try {
    const res = await chrome.runtime.sendMessage({ action: "chat", context: extracted, history, question: q });
    if (res && res.ok) {
      addMessage("assistant", res.answer);
      history.push({ role: "user", content: q });
      history.push({ role: "assistant", content: res.answer });
      if (history.length > MAX_LOCAL_HISTORY) history = history.slice(history.length - MAX_LOCAL_HISTORY);
      await saveSession();
    } else {
      handleError(res);
    }
  } finally {
    setChatStatus("");
    chatInFlight = false;
    setChatBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Session restore + init + wiring
// ---------------------------------------------------------------------------
async function restoreSession(tabId) {
  const slot = sessionSlot(tabId);
  if (!slot) return false;
  const { [SESSIONS_KEY]: all } = await chrome.storage.local.get([SESSIONS_KEY]);
  const session = all && typeof all === "object" ? all[slot] : null;
  if (!session || !session.extracted) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  // A tab ID survives navigation; never show one page's assessment on another.
  if (!tab || !session.sourceUrl || session.sourceUrl !== tab.url) return false;

  extracted = session.extracted;
  history = Array.isArray(session.history) ? session.history : [];
  els.chatLog.innerHTML = "";
  for (const msg of history) addMessage(msg.role === "user" ? "user" : "assistant", msg.content);

  currentContentType = session.contentType || null;
  currentJob = session.job || null;
  currentFit = session.fit || null;
  currentFitFallback = session.fitFallback || null;
  currentAnalysis = null;
  analyzing = false;

  if (currentContentType === "job_posting" && currentJob) {
    els.summaryText.hidden = true;
    els.jobView.hidden = false;
    els.panelFooter.hidden = false;
    renderJobViewInto(els.jobView, currentJob, currentFit);
  } else {
    els.jobView.hidden = true;
    els.panelFooter.hidden = true;
    els.summaryText.hidden = false;
    renderSummary(session.summary || "");
  }

  els.result.hidden = false;
  await renderChips();
  return true;
}

function persistUiState() {
  const state = { pinned: els.btnPin.getAttribute("aria-pressed") === "true", docked: els.btnDock.getAttribute("aria-pressed") === "true" };
  chrome.storage.local.set({ summaUiPrefs: state }).catch(() => {});
}

async function applyUiPrefs() {
  const { summaUiPrefs } = await chrome.storage.local.get(["summaUiPrefs"]);
  if (!summaUiPrefs) return;
  if (summaUiPrefs.pinned) { els.btnPin.setAttribute("aria-pressed", "true"); document.body.classList.add("pinned"); }
  if (summaUiPrefs.docked) { els.btnDock.setAttribute("aria-pressed", "true"); document.body.classList.add("docked"); }
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const rawTabId = params.get("tabId");
  if (rawTabId != null && /^\d+$/.test(rawTabId)) currentTabId = Number(rawTabId);

  // Hide duplicate chrome when embedded in the injected overlay iframe.
  if (window.top && window.top !== window) document.body.classList.add("embedded");
  hydrateIcons(document);

  els.btnClose.addEventListener("click", () => window.close());
  els.btnPin.addEventListener("click", () => {
    const on = els.btnPin.getAttribute("aria-pressed") === "true";
    els.btnPin.setAttribute("aria-pressed", String(!on));
    document.body.classList.toggle("pinned", !on);
    persistUiState();
  });
  els.btnDock.addEventListener("click", () => {
    const on = els.btnDock.getAttribute("aria-pressed") === "true";
    els.btnDock.setAttribute("aria-pressed", String(!on));
    document.body.classList.toggle("docked", !on);
    persistUiState();
  });
  els.btnSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.btnChat.addEventListener("click", toggleChat);
  els.linkChat.addEventListener("click", toggleChat);
  els.chatBack.addEventListener("click", closeChat);
  els.chatClose.addEventListener("click", closeChat);

  els.summarizeBtn.addEventListener("click", summarize);
  els.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.chatSend.addEventListener("click", () => askChat());
  els.chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") askChat(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.chatDrawer.hidden) closeChat();
  });
  els.btnChecklist.addEventListener("click", reanalyze);
  els.checklistClose.addEventListener("click", closeChecklist);
  els.btnCopySelected.addEventListener("click", copySelected);
  els.btnCopy.addEventListener("click", copyGapPrompts);
  els.linkReanalyze.addEventListener("click", () => reanalyze());

  els.checklistModal.addEventListener("click", (e) => {
    if (e.target === els.checklistModal) closeChecklist();
  });

  try {
    chrome.tabs.get(currentTabId).then((tab) => {
      if (tab && tab.title) document.title = tab.title;
    }).catch(() => {});
  } catch (e) {}

  migrateLegacy().then(() => applyUiPrefs()).then(async () => {
    const { openrouterApiKey } = await chrome.storage.local.get(["openrouterApiKey"]);
    if (!openrouterApiKey) {
      showNoKey();
    } else if (currentTabId != null) {
      const restored = await restoreSession(currentTabId);
      if (!restored) summarize();
    }
  });
}

init();
