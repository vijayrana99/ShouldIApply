"use strict";

// ---------------------------------------------------------------------------
// content-extract.js — injected into the active tab to extract readable text.
// Expects lib/readability.js to have been injected first (defines the global
// `Readability` class). Returns { title, text } as the script's completion
// value, which chrome.scripting.executeScript surfaces as results[0].result.
// ---------------------------------------------------------------------------

(() => {
  // Fallback: strip chrome/navigation chrome and take innerText directly.
  function manualExtract(doc) {
    const clone = doc.cloneNode(true);
    const selectors = [
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "nav",
      "footer",
      "form",
      "button",
      "aside",
      ".advertisement",
      ".ads",
      ".sidebar",
      ".comment",
      ".comments",
      ".social",
    ];
    clone
      .querySelectorAll(selectors.join(","))
      .forEach((el) => el.remove());
    const root = clone.body || clone.documentElement;
    return (root && root.innerText ? root.innerText : "").trim();
  }

  try {
    const clone = document.cloneNode(true);
    const article = new Readability(clone).parse();

    let title = document.title || "";
    let text = "";

    if (
      article &&
      typeof article.textContent === "string" &&
      article.textContent.trim().length > 200
    ) {
      title = article.title || title;
      text = article.textContent.trim();
    } else {
      // Readability came up empty or too short — use the manual fallback.
      text = manualExtract(document);
    }

    return { title, text };
  } catch (e) {
    // Readability can throw on unusual DOMs; fall back rather than fail the summary.
    return { title: document.title || "", text: manualExtract(document) };
  }
})();