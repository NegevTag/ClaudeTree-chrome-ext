// content.js — Orchestrator: toggle panel, fetch data via bridge, render tree.
// Injected into claude.ai by the manifest content_scripts config.

(function () {
  "use strict";

  const STORAGE_KEY_WIDTH = "ctv_panel_width";
  const DEFAULT_WIDTH = 360;
  const MIN_WIDTH = 280;

  let panelVisible = false;
  let panelEl = null;
  let bridgeInjected = false;
  let bridgeReady = false;
  let currentConversationId = null;
  let currentTree = null;
  let pendingRequests = new Map(); // requestId -> { resolve, reject }
  let requestCounter = 0;

  // ── Panel creation ──────────────────────────────────────────────

  function createPanel() {
    if (panelEl) return panelEl;

    const savedWidth = parseInt(
      localStorage.getItem(STORAGE_KEY_WIDTH) || DEFAULT_WIDTH,
      10
    );
    const width = Math.max(MIN_WIDTH, savedWidth || DEFAULT_WIDTH);

    panelEl = document.createElement("div");
    panelEl.id = "ctv-panel";
    panelEl.style.width = width + "px";
    panelEl.innerHTML = `
      <div id="ctv-resize-handle"></div>
      <div class="ctv-header">
        <span class="ctv-title">Conversation Tree</span>
        <div class="ctv-header-actions">
          <button class="ctv-btn ctv-refresh-btn" title="Refresh tree">↻</button>
          <button class="ctv-btn ctv-close-btn" title="Close panel">✕</button>
        </div>
      </div>
      <div class="ctv-status"></div>
      <div id="ctv-controls">
        <button class="ctv-btn ctv-refresh-btn" title="Refresh tree">↻</button>
        <button class="ctv-btn ctv-close-btn" title="Close panel">✕</button>
      </div>
      <div class="ctv-content"></div>
    `;

    document.body.appendChild(panelEl);

    panelEl.querySelector("#ctv-controls .ctv-close-btn").addEventListener("click", hidePanel);
    panelEl.querySelector("#ctv-controls .ctv-refresh-btn").addEventListener("click", loadTree);

    setupResizeHandle(panelEl);

    return panelEl;
  }

  // ── Resize handle ───────────────────────────────────────────────

  function setupResizeHandle(panel) {
    const handle = panel.querySelector("#ctv-resize-handle");
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      handle.classList.add("ctv-resizing");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const delta = startX - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, startWidth + delta);
      panel.style.width = newWidth + "px";
      // Keep layout pushed as width changes
      if (panelVisible) pushLayout();
    });

    document.addEventListener("mouseup", () => {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove("ctv-resizing");
      localStorage.setItem(STORAGE_KEY_WIDTH, panel.offsetWidth);
    });
  }

  // ── Push Claude's layout to make room for panel ────────────────
  // Inject a <style> that shrinks the whole page body except our panel.

  let layoutStyleEl = null;

  function pushLayout() {
    const w = panelEl ? panelEl.offsetWidth : DEFAULT_WIDTH;
    if (!layoutStyleEl) {
      layoutStyleEl = document.createElement("style");
      layoutStyleEl.id = "ctv-layout-push";
      document.head.appendChild(layoutStyleEl);
    }
    layoutStyleEl.textContent = `
      body > *:not(#ctv-panel):not(script):not(style) {
        margin-right: ${w}px !important;
        transition: margin-right 0.2s ease;
      }
    `;
  }

  function restoreLayout() {
    if (layoutStyleEl) {
      layoutStyleEl.textContent = "";
    }
  }

  function showPanel() {
    createPanel();
    panelEl.classList.add("ctv-visible");
    panelVisible = true;
    pushLayout();
    loadTree();
  }

  function hidePanel() {
    if (panelEl) panelEl.classList.remove("ctv-visible");
    panelVisible = false;
    restoreLayout();
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  // ── Status messages ─────────────────────────────────────────────

  function setStatus(msg, isError = false) {
    if (!panelEl) return;
    const statusEl = panelEl.querySelector(".ctv-status");
    statusEl.textContent = msg;
    statusEl.className = "ctv-status" + (isError ? " ctv-status-error" : "");
    statusEl.style.display = msg ? "block" : "none";
  }

  function setTitle(text) {
    if (!panelEl) return;
    panelEl.querySelector(".ctv-title").textContent = text;
  }

  // ── Bridge injection ────────────────────────────────────────────

  function injectBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("bridge.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.direction !== "from-bridge") return;

    const { type, requestId, payload, error } = event.data;

    if (type === "BRIDGE_READY") {
      bridgeReady = true;
      return;
    }
    if (type === "TREE_DATA" && pendingRequests.has(requestId)) {
      pendingRequests.get(requestId).resolve(payload);
      pendingRequests.delete(requestId);
    }
    if (type === "TREE_ERROR" && pendingRequests.has(requestId)) {
      pendingRequests.get(requestId).reject(new Error(error));
      pendingRequests.delete(requestId);
    }
  });

  // ── API communication via bridge ────────────────────────────────

  function fetchTree(conversationId) {
    return new Promise((resolve, reject) => {
      const requestId = "req_" + ++requestCounter;
      pendingRequests.set(requestId, { resolve, reject });

      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error("Request timed out. Is the bridge loaded?"));
        }
      }, 15000);

      window.postMessage(
        { direction: "from-content-script", type: "FETCH_TREE", conversationId, requestId },
        "*"
      );
    });
  }

  // ── Conversation ID extraction ──────────────────────────────────

  function getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  }

  // ── Tree loading and rendering ──────────────────────────────────

  async function loadTree() {
    const convId = getConversationId();
    if (!convId) {
      setTitle("Conversation Tree");
      setStatus("Navigate to a conversation to see its tree.");
      return;
    }

    currentConversationId = convId;
    setTitle("Loading…");
    setStatus("Loading conversation tree…");

    injectBridge();

    if (!bridgeReady) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (bridgeReady) break;
      }
      if (!bridgeReady) {
        setStatus("Bridge failed to load. Try refreshing the page.", true);
        return;
      }
    }

    try {
      const apiResponse = await fetchTree(convId);
      const tree = window.ClaudeTreeVisual.normalizeTree(apiResponse);
      currentTree = tree;

      const layout = window.ClaudeTreeVisual.computeLayout(tree);
      const contentEl = panelEl.querySelector(".ctv-content");
      window.ClaudeTreeVisual.renderTree(contentEl, tree, layout, handleNodeClick);

      setStatus("");
      // Use API name, or fall back to the page <title> (Claude sets it to the chat name)
      const pageTitle = document.title.replace(/\s*[-|].*claude.*/i, "").trim();
      setTitle(tree.conversationName || pageTitle || "Untitled conversation");
    } catch (err) {
      console.error("[ClaudeTreeVisual]", err);
      setTitle("Conversation Tree");
      setStatus("Error: " + err.message, true);
    }
  }

  // ── Node click → navigate in claude.ai ──────────────────────────

  function handleNodeClick(nodeId) {
    if (!currentTree) return;
    const node = currentTree.nodes.get(nodeId);
    if (!node) return;

    const contentEl = panelEl.querySelector(".ctv-content");
    window.ClaudeTreeVisual.highlightPath(contentEl, currentTree, nodeId);
    scrollToMessage(node);
  }

  function scrollToMessage(node) {
    // Strategy 1: data attribute
    const byAttr = document.querySelector(`[data-message-id="${node.id}"]`);
    if (byAttr) {
      byAttr.scrollIntoView({ behavior: "smooth", block: "center" });
      flashElement(byAttr);
      return;
    }

    // Strategy 2: text content match
    const containers = document.querySelectorAll(
      '[data-testid^="message"], .message, [class*="Message"]'
    );
    const snippet = node.fullText.slice(0, 80).trim();
    for (const container of containers) {
      if (snippet.length > 10 && container.textContent?.includes(snippet)) {
        container.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(container);
        return;
      }
    }

    console.log("[ClaudeTreeVisual] Could not find message in DOM:", node.id, node.text);
  }

  function flashElement(el) {
    el.style.transition = "outline 0.2s ease";
    el.style.outline = "2px solid #5B7BD5";
    setTimeout(() => { el.style.outline = "none"; }, 1500);
  }

  // ── Listen for toggle command from background.js ────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_PANEL") togglePanel();
  });

  // ── Watch for SPA navigation ────────────────────────────────────

  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (panelVisible) {
        const newConvId = getConversationId();
        if (newConvId && newConvId !== currentConversationId) {
          loadTree();
        } else if (!newConvId) {
          setTitle("Conversation Tree");
          setStatus("Navigate to a conversation to see its tree.");
        }
      }
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // ── Keyboard shortcut: Ctrl+Shift+T ────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "T") {
      e.preventDefault();
      togglePanel();
    }
  });
})();
