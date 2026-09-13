"use strict";

// ---------------------------------------------------------------------------
// offscreen.js — runs inside offscreen.html. Receives base64 PDF bytes from the
// service worker, decodes them, and extracts text with pdf.js's getTextContent()
// (an embedded text layer only — scanned PDFs need OCR, which is out of scope).
// ---------------------------------------------------------------------------

const MAX_PDF_PAGES = 60; // webpage-PDF extraction page cap; see also §11

// pdf.js getDocument() calls are async in a single-threaded document. Guard
// against two overlapping extraction requests interleaving their resolutions.
let extracting = false;

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function extractPdfText(base64) {
  if (extracting) {
    const err = new Error("A PDF extraction is already in progress. Please try again in a moment.");
    err.name = "BUSY";
    throw err;
  }
  extracting = true;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
      "lib/pdf.worker.min.js"
    );
    const data = base64ToUint8Array(base64);
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    let text = "";
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n\n";
    }

    return {
      ok: true,
      text: text.trim(),
      numPages: pdf.numPages,
      truncated: pdf.numPages > MAX_PDF_PAGES,
    };
  } catch (e) {
    return {
      ok: false,
      error: e && e.name === "BUSY"
        ? e.message
        : (e && e.message) || "Failed to read this PDF.",
    };
  } finally {
    extracting = false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.target === "offscreen" && request.type === "extract-pdf") {
    extractPdfText(request.base64).then(sendResponse);
    return true; // async response
  }
  return false;
});