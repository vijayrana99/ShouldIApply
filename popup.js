"use strict";

// ---------------------------------------------------------------------------
// popup.js — floating-window UI (loaded via chrome.windows.create) for Summa.
// The window is pinned to a source tab (passed as ?tabId= in the URL) and lets
// the user summarize that tab, then ask follow-up questions.
// ---------------------------------------------------------------------------

const els = {
  pageTitle: document.getElementById("page-title"),
  pageUrl: document.getElementById("page-url"),
  noKey: document.getElementById("no-key"),
  openSettings: document.getElementById("open-settings"),
  summarizeBtn: document.getElementById("summarize-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  summaryText: document.getElementById("summary-text"),
  jobView: document.getElementById("job-view"),
  chips: document.getElementById("chips"),
  chatLog: document.getElementById("chat-log"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  chatStatus: document.getElementById("chat-status"),
  newSummary: document.getElementById("new-summary"),
  modelBadge: document.getElementById("model-badge"),
};

let extracted = null; // context returned by a successful summarize
let history = []; // running {role, content} chat history
let chatInFlight = false;
let currentTabId = null; // active tab the popup is scoped to

const MAX_LOCAL_HISTORY = 10; // mirror of background's MAX_CHAT_TURNS
const SESSIONS_KEY = "summaSessions"; // map of { "tab-<id>": session }
const LEGACY_SESSION_KEY = "summaSession"; // old single-slot key, removed on first run

const DEFAULT_CHIPS = [
  { label: "What skills or qualifications are required?", question: "What skills or qualifications are required?" },
  { label: "What are the main responsibilities?", question: "What are the main responsibilities?" },
  { label: "What benefits or perks are offered?", question: "What benefits or perks are offered?" },
  { label: "What are the key takeaways?", question: "What are the 3–5 most important key takeaways from this content?" },
  { label: "Summarize this in one paragraph", question: "Summarize the entire content in a single concise paragraph." },
  { label: "What are the pros and cons?", question: "What are the main pros and cons discussed in this content?" },
  { label: "What should I do next?", question: "Based on this content, what action items or next steps should I take?" },
  { label: "Explain the hard concepts", question: "What are the most technical or specialized terms or concepts here, and what do they mean in plain language?" },
  { label: "What's missing or unclear?", question: "What important information is missing or unclear in this content?" },
];
const CV_CHIP = {
  label: "Is this a good fit for my CV? What am I missing?",
  question: "Is this a good fit for my CV? What am I missing?",
};

// ---- Session persistence (scoped per tab, survives popup close/reopen) ------
function sessionSlot(tabId) {
  return tabId == null ? null : "tab-" + tabId;
}

async function saveSession() {
  if (!extracted || currentTabId == null) return;
  const slot = sessionSlot(currentTabId);

  const { [SESSIONS_KEY]: all } = await chrome.storage.local.get([SESSIONS_KEY]);
  const sessions = all && typeof all === "object" ? all : {};
  sessions[slot] = {
    savedAt: Date.now(),
    extracted,
    summary: els.summaryText.dataset && els.summaryText.dataset.raw
      ? els.summaryText.dataset.raw
      : "",
    history,
    contentType: currentContentType,
    job: currentJob,
    fit: currentFit,
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

// Remove the legacy single-slot key once, so old data can't leak across tabs.
async function migrateLegacy() {
  const { [LEGACY_SESSION_KEY]: legacy } = await chrome.storage.local.get([
    LEGACY_SESSION_KEY,
  ]);
  if (legacy) {
    await chrome.storage.local.remove(LEGACY_SESSION_KEY);
  }
}

// ---- Modern summary rendering -----------------------------------------------
// The model returns plain text bullets. Turn each bulleted line into a styled
// <li> and any non-bullet lines into plain paragraphs — all via DOM nodes so
// untrusted page text is never interpreted as HTML.
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

  if (ul.childNodes.length > 0) {
    container.appendChild(ul);
  }
}

// ---- Markdown rendering (safe: builds DOM nodes, never innerHTML on LLM text) ------
// Handles headings, bold/italic/code/links, bullet & ordered lists, and tables —
// the formatting styles LLM chat answers typically contain.
function appendInline(parent, text) {
  // Tokenize **bold**, *italic*, `code`, and [label](url); everything else plain.
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

function renderTable(lines, out) {
  const table = document.createElement("table");
  table.className = "md-table";
  // First line = header, line[1] = separator, rest = body rows.
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  for (const cell of splitTableRow(lines[0])) {
    const th = document.createElement("th");
    appendInline(th, cell.trim());
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  const tbody = document.createElement("tbody");
  for (let i = 2; i < lines.length; i++) {
    const tr = document.createElement("tr");
    for (const cell of splitTableRow(lines[i])) {
      const td = document.createElement("td");
      appendInline(td, cell.trim());
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  out.appendChild(table);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|");
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

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const eh = document.createElement("h" + (h[1].length === 1 ? 1 : h[1].length));
      eh.className = "md-" + (h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3");
      appendInline(eh, h[2]);
      out.appendChild(eh);
      i++;
      continue;
    }

    // Bullet list
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

    // Ordered list
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

    // Table (2+ consecutive lines starting with |)
    if (line.trim().startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      renderTable(tableLines, out);
      continue;
    }

    // Horizontal rule
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.appendChild(document.createElement("hr"));
      i++;
      continue;
    }

    // Paragraph — gather consecutive plain lines into one <p> (handles wrapping).
    const pLines = [line];
    i++;
    while (i < lines.length) {
      const n = lines[i].trim();
      if (n === "" || /^(#{1,3})\s+/.test(n) || /^\s*[-*•]\s+/.test(n) ||
          /^\s*\d+[.)]\s+/.test(n) || /^\s*(---+|\*\*\*+)\s*$/.test(n) ||
          n.startsWith("|")) {
        break;
      }
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
function setStatus(text) {
  els.status.hidden = !text;
  els.status.textContent = text || "";
}

function setChatStatus(text) {
  els.chatStatus.hidden = !text;
  els.chatStatus.textContent = text || "";
}

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = "message " + role;
  const label = document.createElement("span");
  label.className = "role-label";
  label.textContent = role === "user" ? "You" : "Summa";
  div.appendChild(label);
  if (role === "assistant") {
    // Render Markdown (headings, bullets, tables, bold, code, links) as DOM.
    div.appendChild(renderMarkdown(content));
  } else {
    const body = document.createElement("span");
    body.className = "plain-text";
    body.textContent = content;
    div.appendChild(body);
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function showNoKey() {
  els.noKey.hidden = false;
  els.summarizeBtn.hidden = true;
  setStatus("");
}

function showTabClosedNotice() {
  // The tab this window is pinned to no longer exists. Disable the whole UI so
  // a stale window can't be used to summarize a dead tab.
  els.summarizeBtn.disabled = true;
  els.summarizeBtn.hidden = true;
  setChatBusy(true);
  els.result.hidden = true;
  setStatus("The page this window was open for was closed. Click the Summa icon on a tab to start fresh.");
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

function setChatBusy(busy) {
  els.chatInput.disabled = busy;
  els.chatSend.disabled = busy;
  els.chips.querySelectorAll("button").forEach((b) => (b.disabled = busy));
}

async function renderChips() {
  const chips = [...DEFAULT_CHIPS];
  const { cvText } = await chrome.storage.local.get(["cvText"]);
  if (cvText && cvText.trim()) {
    chips.push(CV_CHIP);
  }
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

// ---- Job view rendering (contentType === "job_posting") ---------------------
function jobEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function jobListSection(lines) {
  const ul = document.createElement("ul");
  ul.className = "job-list";
  lines.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
  return ul;
}

function jobAccordion(title, countLabel, buildBody) {
  const card = document.createElement("div");
  card.className = "job-card";
  const head = jobEl("button", "job-card-head");
  head.type = "button";
  const left = jobEl("span", "job-card-title", title);
  const count = jobEl("span", "job-card-count", countLabel);
  head.appendChild(left);
  head.appendChild(count);
  const body = buildBody();
  body.className = "job-card-body hidden";
  const chevron = jobEl("span", "job-chevron", "▾");
  head.appendChild(chevron);
  head.addEventListener("click", () => {
    const hidden = body.classList.toggle("hidden");
    chevron.textContent = hidden ? "▾" : "▴";
  });
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function jobSection(title, body) {
  const card = document.createElement("div");
  card.className = "job-card open";
  const head = jobEl("div", "job-card-title", title);
  card.appendChild(head);
  body.className = "job-card-body";
  card.appendChild(body);
  return card;
}

// CV onboarding / refresh footer (§3 + §4.6).
function renderCvFooter(job, fit) {
  const wrap = document.createElement("div");
  wrap.className = "cvfit";

  if (!fit) {
    // Empty-CV state: CV-first onboarding, not the full breakdown.
    const onboard = document.createElement("div");
    onboard.className = "cv-onboard";
    const title = jobEl("div", "cv-onboard-title", "Add your CV to see if this job fits you");
    onboard.appendChild(title);
    const blurb = jobEl("div", "job-muted", "We need your CV to compare against this posting. Requirements stay hidden until then.");
    onboard.appendChild(blurb);
    const btn = jobEl("button", "primary", "Open CV settings");
    btn.type = "button";
    btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
    onboard.appendChild(btn);
    wrap.appendChild(onboard);
    return wrap;
  }

  // Fit exists -> refresh footer.
  const btn = jobEl("button", "ghost small", "Refresh with updated CV");
  btn.type = "button";
  wrap.appendChild(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const status = jobEl("div", "job-muted", "Analyzing fit against your CV...");
    wrap.appendChild(status);
    const res = await chrome.runtime.sendMessage({ action: "cvFit", job: currentJob });
    status.remove();
    if (res && res.ok) {
      currentFit = res.fit;
      await saveSession();
      reRenderJobView();
    } else {
      wrap.appendChild(jobEl("div", "job-error", (res && res.message) || "Could not analyze fit."));
    }
    btn.disabled = false;
  });
  return wrap;
}

// Verdict bucketing (§6). Returns { label, tone } or null if no usable score.
function verdictBand(score) {
  if (typeof score !== "number" || score < 0 || score > 100) return null;
  if (score >= 80) return { label: "Strong Match", tone: "strong" };
  if (score >= 55) return { label: "Partial Match", tone: "partial" };
  return { label: "Weak Match", tone: "weak" };
}

function templatedFitReason(fit) {
  const matched = Array.isArray(fit.matched) ? fit.matched.length : 0;
  const missing = Array.isArray(fit.missing) ? fit.missing.length : 0;
  const total = matched + missing;
  if (missing === 0) return "You meet all " + total + " core requirement" + (total === 1 ? "" : "s") + ".";
  if (total === 0) return "No core requirements were extracted for this posting.";
  return "Missing " + missing + " of " + total + " core requirement" + (total === 1 ? "" : "s") + ".";
}

function renderFitHero(job, fit) {
  const hero = document.createElement("div");
  hero.className = "fit-hero";
  const band = verdictBand(fit && fit.fitScore);
  const role = job.role || {};
  const comp = job.compensation || {};

  // Top: large score (or a fallback message if no score).
  const scoreWrap = document.createElement("div");
  scoreWrap.className = "fit-score-wrap";
  if (band) {
    const num = document.createElement("span");
    num.className = "fit-score-num " + band.tone;
    num.textContent = Math.round(fit.fitScore) + "%";
    const label = document.createElement("span");
    label.className = "fit-band " + band.tone;
    label.textContent = band.label;
    scoreWrap.appendChild(num);
    scoreWrap.appendChild(label);
  } else {
    const num = document.createElement("span");
    num.className = "fit-score-num none";
    num.textContent = "—";
    const label = document.createElement("span");
    label.className = "fit-band none";
    label.textContent = "No fit score";
    scoreWrap.appendChild(num);
    scoreWrap.appendChild(label);
  }
  hero.appendChild(scoreWrap);

  // One-line reason (templated from counts; never freeform).
  const reason = document.createElement("div");
  reason.className = "fit-reason";
  reason.textContent = templatedFitReason(fit);
  hero.appendChild(reason);

  // Role + company + salary subline (demoted, not the top block).
  const sub = [];
  if (role.title) sub.push(role.title);
  if (role.company) sub.push(role.company);
  const sal = [];
  if (comp.min != null || comp.max != null) {
    const fmt = (n) => n == null ? "" : (n >= 1000 ? "$" + Math.round(n / 1000) + "k" : String(n));
    sal.push(fmt(comp.min) + "–" + fmt(comp.max) + " / " + (comp.period || "year"));
  }
  const subline = document.createElement("div");
  subline.className = "fit-subline";
  subline.textContent = sub.join(" • ") + (sal.length ? "  ·  " + sal.join(" · ") : "");
  hero.appendChild(subline);

  return hero;
}


// Full job details (fit-first: hero + flags are rendered above by summarize).
function renderJobViewInto(root, job, fit) {
  if (!root) root = els.jobView;
  // Flags callout (highly visible; shown if any).
  for (const fl of job.flags || []) {
    root.appendChild(jobEl("div", "job-flag " + fl.severity, fl.text));
  }
  // "Why this score" — matched/missing breakdown, expanded by default.
  if (fit && Array.isArray(fit.matched)) {
    const why = document.createElement("div");
    why.className = "fit-why";
    const h2 = jobEl("div", "fit-why-title", "Why this score");
    why.appendChild(h2);
    if (fit.matched.length) {
      const ul = document.createElement("ul");
      ul.className = "job-list fit-matched";
      fit.matched.forEach((m) => {
        const li = document.createElement("li");
        li.appendChild(jobEl("span", "fit-tick", "✓"));
        const t = document.createElement("span");
        t.textContent = m.requirement + (m.why ? " — " + m.why : "");
        li.appendChild(t);
        ul.appendChild(li);
      });
      why.appendChild(ul);
    }
    if (fit.missing.length) {
      const ul = document.createElement("ul");
      ul.className = "job-list fit-missing";
      fit.missing.forEach((m) => {
        const li = document.createElement("li");
        li.appendChild(jobEl("span", "fit-tick miss", "—"));
        const t = document.createElement("span");
        t.textContent = m.requirement + (m.why ? " — " + m.why : "");
        li.appendChild(t);
        ul.appendChild(li);
      });
      why.appendChild(ul);
    }
    root.appendChild(why);
  }

  // Full details — collapsed accordions.
  const detailsHeading = jobEl("div", "job-details-title", "Job details");
  root.appendChild(detailsHeading);

  const req = job.requirements || [];
  if (req.length) root.appendChild(jobAccordion("Key Requirements", `${req.length}`, () => {
    const ul = document.createElement("ul");
    ul.className = "job-list";
    req.forEach((r) => {
      const li = document.createElement("li");
      const badge = jobEl("span", "job-tier " + r.tier, r.tier);
      li.appendChild(badge);
      li.appendChild(document.createTextNode(" " + r.text));
      ul.appendChild(li);
    });
    return ul;
  }));

  const resp = job.responsibilities || [];
  if (resp.length) root.appendChild(jobAccordion("Responsibilities", `${resp.length}`, () => jobListSection(resp)));

  const benefits = job.benefits || [];
  if (benefits.length) root.appendChild(jobAccordion("Benefits", `${benefits.length}`, () => jobListSection(benefits)));

  const elig = job.eligibility || [];
  if (elig.length) root.appendChild(jobAccordion("Eligibility", `${elig.length}`, () => jobListSection(elig)));

  if (job.process && (job.process.stages || []).length) {
    const p = job.process;
    const lines = (p.stages || []).map((s) => s.name + (s.detail ? ": " + s.detail : ""));
    (p.assessmentAreas || []).forEach((a) => lines.push(a));
    root.appendChild(jobAccordion("Process", `${(p.stages || []).length} stage(s)`, () => jobListSection(lines)));
  }
}


// re-render helper
function reRenderJobView() {
  els.jobView.innerHTML = "";
  els.jobView.hidden = false;
  els.jobView.appendChild(renderFitHero(currentJob, currentFit));
  renderJobViewInto(els.jobView, currentJob, currentFit);
  els.jobView.appendChild(renderCvFooter(currentJob, currentFit));
}

let currentJob = null;
let currentFit = null;
let currentContentType = null;

// ---- Actions ---------------------------------------------------------------
async function summarize() {
  if (currentTabId == null) {
    showTabClosedNotice();
    return;
  }
  els.summarizeBtn.disabled = true;
  setStatus("Reading the page and summarizing...");

  const res = await chrome.runtime.sendMessage({ action: "extractJob", tabId: currentTabId });

  els.summarizeBtn.disabled = false;

  if (res && res.ok) {
    extracted = res.extracted;
    history = [];
    currentJob = res.job || null;
    if (res.contentType === "job_posting" && currentJob) {
      // FIT-FIRST: hide plain summary, show job card with verdict hero on top.
      els.summaryText.hidden = true;
      currentFit = res.fit || null;
      els.jobView.innerHTML = "";
      els.jobView.hidden = false;
      // Render fit hero first, then the fuller job view below.
      els.jobView.appendChild(renderFitHero(currentJob, currentFit));
      // Next sections (why/this-score, flags, collapsed details) appended here later.
      renderJobViewInto(els.jobView, currentJob, currentFit);
      els.jobView.appendChild(renderCvFooter(currentJob, currentFit));
      await renderChips();
      setStatus("");
    } else {
      els.jobView.hidden = true;
      els.summaryText.hidden = false;
      renderSummary(res.summary);
      setStatus("");
      await renderChips();
    }

    els.chatLog.innerHTML = "";
    els.result.hidden = false;
    await saveSession();
  } else {
    handleError(res);
  }
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
    const res = await chrome.runtime.sendMessage({
      action: "chat",
      context: extracted,
      history,
      question: q,
    });

    if (res && res.ok) {
      addMessage("assistant", res.answer);
      history.push({ role: "user", content: q });
      history.push({ role: "assistant", content: res.answer });
      if (history.length > MAX_LOCAL_HISTORY) {
        history = history.slice(history.length - MAX_LOCAL_HISTORY);
      }
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

// ---- Wiring -----------------------------------------------------------------
async function restoreSession(tabId) {
  const slot = sessionSlot(tabId);
  if (!slot) return false;

  const { [SESSIONS_KEY]: all } = await chrome.storage.local.get([SESSIONS_KEY]);
  const session = all && typeof all === "object" ? all[slot] : null;
  if (!session || !session.extracted) return false;

  extracted = session.extracted;
  history = Array.isArray(session.history) ? session.history : [];
  els.chatLog.innerHTML = "";
  for (const msg of history) {
    addMessage(msg.role === "user" ? "user" : "assistant", msg.content);
  }

  currentContentType = session.contentType || null;
  currentJob = session.job || null;

  if (currentContentType === "job_posting" && currentJob) {
    els.summaryText.hidden = true;
    currentFit = session.fit || null;
    els.jobView.innerHTML = "";
    els.jobView.hidden = false;
    els.jobView.appendChild(renderFitHero(currentJob, currentFit));
    renderJobViewInto(els.jobView, currentJob, currentFit);
    els.jobView.appendChild(renderCvFooter(currentJob, currentFit));
  } else {
    els.jobView.hidden = true;
    els.summaryText.hidden = false;
    renderSummary(session.summary || "");
  }


  await renderChips();
  els.result.hidden = false;
  return true;
}

async function newSummary() {
  extracted = null;
  history = [];
  setStatus("");
  els.result.hidden = true;
  await clearSession();
  els.summarizeBtn.hidden = false;
}

async function init() {
  // The floating window is pinned to a source tab via ?tabId= in the URL.
  const params = new URLSearchParams(window.location.search);
  const rawTabId = params.get("tabId");

  if (rawTabId != null && /^\d+$/.test(rawTabId)) {
    currentTabId = Number(rawTabId);
  }

  if (currentTabId == null) {
    showTabClosedNotice();
  } else {
    try {
      const tab = await chrome.tabs.get(currentTabId);
      els.pageTitle.textContent = tab.title || "";
      els.pageTitle.title = tab.title || "";
      els.pageUrl.textContent = tab.url || "";
    } catch (err) {
      // Tab was closed before the window finished loading.
      showTabClosedNotice();
    }
  }

  // Show the current model in the header (right side), clicking opens Settings.
  const { model } = await chrome.storage.sync.get(["model"]);
  els.modelBadge.textContent = model || "deepseek/deepseek-v4-flash-0731";
  els.modelBadge.addEventListener("click", () => chrome.runtime.openOptionsPage());

  await migrateLegacy();

  const { openrouterApiKey } = await chrome.storage.local.get(["openrouterApiKey"]);
  if (!openrouterApiKey) {
    showNoKey();
  } else if (currentTabId != null) {
    await restoreSession(currentTabId);
  }

  els.summarizeBtn.addEventListener("click", summarize);
  els.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.chatSend.addEventListener("click", () => askChat());
  els.newSummary.addEventListener("click", newSummary);
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") askChat();
  });
}

init();