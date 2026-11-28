// overlay-inject.js — runs in the page's isolated world, once per click.
// Toggles an in-page floating overlay. First click creates it (with a Shadow
// DOM + iframe hosting the existing popup UI); a second click removes it.

(async function () {
  const HOST_ID = "summa-overlay-host";
  const existing = document.getElementById(HOST_ID);

  if (existing) {
    existing.remove();
    return; // toggle off
  }

  const { tabId } = await chrome.runtime.sendMessage({ action: "getTabId" });

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Attach to <html>, not <body> — some pages replace/rewrite body content
  // (SPAs) in ways that could detach a body-appended overlay unexpectedly.
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 600px;
      height: 860px;
      min-width: min(320px, calc(100vw - 24px));
      min-height: min(400px, calc(100vh - 24px));
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      background: #ffffff;
      border-radius: 14px;
      box-shadow: 0 20px 45px -12px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.08);
      z-index: 2147483647;
      overflow: hidden;
      resize: both;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 14px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      cursor: move;
      user-select: none;
      flex: 0 0 auto;
    }
    .header .logo {
      width: 18px; height: 18px; border-radius: 6px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      display: inline-block;
    }
    .header .brand { display: flex; align-items: center; gap: 8px; }
    .header .title { color: #0f172a; font-size: 13px; font-weight: 650; letter-spacing: 0.01em; }
    .header .controls { display: flex; gap: 6px; }
    .header .ctrl {
      background: none; border: none; color: #94a3b8; font-size: 14px;
      cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .header .ctrl:hover { background: #e2e8f0; color: #334155; }
    iframe { flex: 1 1 0; min-height: 0; border: none; width: 100%; background: #fff; }
    .height-resizer {
      flex: 0 0 14px; width: 100%; height: 14px; padding: 0;
      border: 0; background: #f8fafc; cursor: ns-resize; touch-action: none;
    }
    .height-resizer::after {
      content: ""; display: block; width: 40px; height: 3px;
      margin: auto; border-radius: 3px; background: #94a3b8;
    }
    .height-resizer:focus-visible { outline: 2px solid #4f46e5; outline-offset: -2px; }
  `;

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="header">
      <div class="brand">
        <span class="logo"></span>
        <span class="title">ShouldIApply</span>
      </div>
      <div class="controls">
        <button class="ctrl" data-action="expand-height" title="Expand height" aria-label="Expand height" aria-pressed="false">↕</button>
        <button class="ctrl" data-action="minimize" title="Minimize">—</button>
        <button class="ctrl" data-action="close" title="Close">✕</button>
      </div>
    </div>
  `;

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL(`popup.html?tabId=${tabId}`);
  panel.appendChild(iframe);
  const heightResizer = document.createElement("button");
  heightResizer.className = "height-resizer";
  heightResizer.type = "button";
  heightResizer.title = "Drag to resize height, or use the up/down arrow keys";
  heightResizer.setAttribute("aria-label", "Resize panel height");
  panel.appendChild(heightResizer);

  shadow.appendChild(style);
  shadow.appendChild(panel);

  // --- Close button ---
  panel.querySelector('.ctrl[data-action="close"]').addEventListener("click", () => host.remove());

  // --- Expand vertically / restore the previous height ---
  const expandHeight = panel.querySelector('[data-action="expand-height"]');
  let previousHeight = null;
  function resetExpandButton() {
    previousHeight = null;
    expandHeight.title = "Expand height";
    expandHeight.setAttribute("aria-label", "Expand height");
    expandHeight.setAttribute("aria-pressed", "false");
  }
  expandHeight.addEventListener("click", () => {
    if (previousHeight) {
      panel.style.top = previousHeight.top;
      panel.style.height = previousHeight.height;
      resetExpandButton();
    } else {
      previousHeight = { top: panel.style.top, height: panel.style.height };
      panel.style.top = "12px";
      panel.style.height = "calc(100vh - 24px)";
      expandHeight.title = "Restore height";
      expandHeight.setAttribute("aria-label", "Restore height");
      expandHeight.setAttribute("aria-pressed", "true");
    }
  });

  // The dedicated grip remains outside the iframe so it always receives input.
  function setPanelHeight(height) {
    const available = Math.max(0, window.innerHeight - panel.getBoundingClientRect().top - 12);
    panel.style.height = `${Math.min(available, Math.max(Math.min(400, available), height))}px`;
    resetExpandButton();
  }
  let resizeStart = null;
  heightResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStart = { y: event.clientY, height: panel.getBoundingClientRect().height };
    heightResizer.setPointerCapture(event.pointerId);
    iframe.style.pointerEvents = "none";
  });
  heightResizer.addEventListener("pointermove", (event) => {
    if (resizeStart) setPanelHeight(resizeStart.height + event.clientY - resizeStart.y);
  });
  function finishHeightResize() {
    resizeStart = null;
    iframe.style.pointerEvents = "auto";
  }
  heightResizer.addEventListener("pointerup", finishHeightResize);
  heightResizer.addEventListener("pointercancel", finishHeightResize);
  heightResizer.addEventListener("lostpointercapture", finishHeightResize);
  heightResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = (event.shiftKey ? 50 : 20) * (event.key === "ArrowDown" ? 1 : -1);
    setPanelHeight(panel.getBoundingClientRect().height + delta);
  });

  // --- Drag to move ---
  const header = panel.querySelector(".header");
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    // Let mouse events pass through the iframe while dragging — otherwise
    // moving the cursor over the iframe mid-drag "loses" it, because the
    // iframe is a separate document and doesn't bubble mousemove up.
    iframe.style.pointerEvents = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
    panel.style.right = "auto"; // stop the initial right:20px anchor from fighting left
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    iframe.style.pointerEvents = "auto";
  });
})();