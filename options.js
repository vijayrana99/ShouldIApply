"use strict";

// ---------------------------------------------------------------------------
// options.js — Settings page: OpenRouter API key, model, and CV text/file.
// API key & CV -> chrome.storage.local (sensitive / can be large).
// Model        -> chrome.storage.sync   (small, nice to sync).
// ---------------------------------------------------------------------------

const apiKeyEl = document.getElementById("api-key");
const modelEl = document.getElementById("model");
const cvTextEl = document.getElementById("cv-text");
const cvFileEl = document.getElementById("cv-file");
const saveBtn = document.getElementById("save-btn");
const savedNotice = document.getElementById("saved-notice");
const formEl = document.getElementById("settings-form");

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
const MAX_CV_PDF_PAGES = 20; // most CVs are 1-3 pages; generous cap, not a target

const placementFields = {
  enabled: document.getElementById("placement-enabled"), earliestStart: document.getElementById("placement-earliest"),
  latestStart: document.getElementById("placement-latest"), minWeeks: document.getElementById("placement-min-weeks"),
  maxWeeks: document.getElementById("placement-max-weeks"), hoursPerWeek: document.getElementById("placement-hours"),
  termTimePercent: document.getElementById("placement-percent"), remainingTimeConfirmed: document.getElementById("placement-remaining-confirmed"),
  hoursRule: document.getElementById("placement-hours-rule"), termTimeOnly: document.getElementById("placement-term-time"),
  latestEndDate: document.getElementById("placement-end"), returnToStudy: document.getElementById("placement-return"),
  dissertationAlternative: document.getElementById("placement-dissertation"), computingProjectRequired: document.getElementById("placement-project"),
  projectArea: document.getElementById("placement-area"),
};
const placementMessage = document.getElementById("placement-message");
function fillPlacementProfile(raw) {
  const profile = PlacementProfile.normalize(raw);
  for (const [key, field] of Object.entries(placementFields)) {
    if (field.type === "checkbox") field.checked = profile[key];
    else field.value = profile[key] == null ? "" : profile[key];
  }
}
function readPlacementProfile() {
  return Object.fromEntries(Object.entries(placementFields).map(([key, field]) => [key,
    field.type === "checkbox" ? field.checked : field.type === "number" ? field.value === "" ? null : Number(field.value) : field.value]));
}
document.getElementById("placement-import").addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10000) throw new Error("Choose a placement profile smaller than 10 KB.");
    const profile = JSON.parse(await file.text());
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Choose a valid placement-profile JSON object.");
    const issues = PlacementProfile.errors(profile);
    if (issues.length) throw new Error(issues.join(" "));
    fillPlacementProfile(profile);
    placementMessage.textContent = "Profile loaded. Review the fields, then click Save to apply it.";
  } catch (error) {
    placementMessage.textContent = error.message || "Could not import this profile.";
  }
  placementMessage.hidden = false;
  event.target.value = "";
});

async function load() {
  const { openrouterApiKey, cvText, placementProfile } = await chrome.storage.local.get([
    "openrouterApiKey",
    "cvText",
    "placementProfile",
  ]);
  apiKeyEl.value = openrouterApiKey || "";
  if (cvText) cvTextEl.value = cvText;
  fillPlacementProfile(placementProfile);

  const { model } = await chrome.storage.sync.get(["model"]);
  modelEl.value = model || DEFAULT_MODEL;
}

async function extractTextFromFile(file) {
  if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
    return await file.text();
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
      "lib/pdf.worker.min.js"
    );
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pageCount = Math.min(pdf.numPages, MAX_CV_PDF_PAGES);
    let text = "";
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n\n";
    }
    if (pdf.numPages > MAX_CV_PDF_PAGES) {
      text += `\n[Note: only the first ${MAX_CV_PDF_PAGES} of ${pdf.numPages} pages were read.]`;
    }
    return text.trim();
  }
  throw new Error("Unsupported file type. Use a .txt or .pdf file.");
}

function flashSaved() {
  savedNotice.hidden = false;
  setTimeout(() => (savedNotice.hidden = true), 1500);
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const placementProfile = readPlacementProfile();
  const issues = PlacementProfile.errors(placementProfile);
  if (issues.length) {
    placementMessage.textContent = issues.join(" ");
    placementMessage.hidden = false;
    placementMessage.scrollIntoView({ block: "nearest" });
    return;
  }
  await chrome.storage.local.set({
    placementProfile: PlacementProfile.normalize(placementProfile),
    openrouterApiKey: apiKeyEl.value.trim(),
    cvText: cvTextEl.value.trim(),
  });
  await chrome.storage.sync.set({
    model: modelEl.value.trim() || DEFAULT_MODEL,
  });
  placementMessage.hidden = true;
  flashSaved();
});

cvFileEl.addEventListener("change", async () => {
  const file = cvFileEl.files && cvFileEl.files[0];
  if (!file) return;
  try {
    cvTextEl.value = await extractTextFromFile(file);
  } catch (err) {
    alert(err && err.message ? err.message : "Couldn't read that file.");
  }
  cvFileEl.value = "";
});

load();
formEl.addEventListener("keydown", (e) => {
  // Ctrl/Cmd+Enter in textarea: easier than clicking Save or tabbing out.
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    formEl.requestSubmit();
  }
});
