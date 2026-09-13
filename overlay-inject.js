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
      min-width: 320px;
      min-height: 400px;
      max-width: 90vw;
      max-height: 90vh;
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
    iframe { flex: 1 1 auto; border: none; width: 100%; background: #fff; }
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
        <button class="ctrl" data-action="minimize" title="Minimize">—</button>
        <button class="ctrl" data-action="close" title="Close">✕</button>
      </div>
    </div>
  `;

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL(`popup.html?tabId=${tabId}`);
  panel.appendChild(iframe);

  shadow.appendChild(style);
  shadow.appendChild(panel);

  // --- Close button ---
  panel.querySelector('.ctrl[data-action="close"]').addEventListener("click", () => host.remove());

  // --- Drag to move ---
  const header = panel.querySelector(".header");
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
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