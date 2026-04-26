// bridge.js — Injected into page context to access session cookies for API calls.
// Communicates with content.js via window.postMessage.

(function () {
  "use strict";

  const API_BASE = "https://claude.ai/api";
  let cachedOrgId = null;

  async function fetchJSON(url) {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${resp.statusText} — ${url}`);
    }
    return resp.json();
  }

  async function getOrgId() {
    if (cachedOrgId) return cachedOrgId;
    const orgs = await fetchJSON(`${API_BASE}/organizations`);
    if (!Array.isArray(orgs) || orgs.length === 0) {
      throw new Error("No organizations found. Are you logged into claude.ai?");
    }
    cachedOrgId = orgs[0].uuid;
    return cachedOrgId;
  }

  async function getConversationTree(conversationId) {
    const orgId = await getOrgId();
    const url =
      `${API_BASE}/organizations/${orgId}/chat_conversations/${conversationId}` +
      `?tree=True&rendering_mode=messages&render_all_tools=true`;
    return fetchJSON(url);
  }

  // Listen for requests from content.js
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.direction !== "from-content-script") return;

    const { type, conversationId, requestId } = event.data;

    if (type === "FETCH_TREE") {
      try {
        const data = await getConversationTree(conversationId);
        window.postMessage(
          {
            direction: "from-bridge",
            requestId,
            type: "TREE_DATA",
            payload: data,
          },
          "*"
        );
      } catch (err) {
        window.postMessage(
          {
            direction: "from-bridge",
            requestId,
            type: "TREE_ERROR",
            error: err.message,
          },
          "*"
        );
      }
    }
  });

  // Signal that bridge is ready
  window.postMessage(
    { direction: "from-bridge", type: "BRIDGE_READY" },
    "*"
  );
})();
