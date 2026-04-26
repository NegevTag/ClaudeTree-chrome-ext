// data-normalize.js — Transform Claude API response into internal tree model.
// Loaded as content script (no ES module export; exposes window.normalizeTree).

(function () {
  "use strict";

  /**
   * Extract chat_messages from the API response.
   * Claude's response shape can vary, so we try multiple paths.
   */
  function extractMessages(apiResponse) {
    // Path 1: top-level chat_messages
    if (Array.isArray(apiResponse.chat_messages)) {
      return apiResponse.chat_messages;
    }
    // Path 2: nested under chat_conversation
    if (
      apiResponse.chat_conversation &&
      Array.isArray(apiResponse.chat_conversation.chat_messages)
    ) {
      return apiResponse.chat_conversation.chat_messages;
    }
    // Path 3: the response itself is the array
    if (Array.isArray(apiResponse)) {
      return apiResponse;
    }
    throw new Error(
      "Could not extract chat_messages from API response. Keys: " +
        Object.keys(apiResponse).join(", ")
    );
  }

  /**
   * Extract text content from a message's content array.
   */
  function getMessageText(msg) {
    // Prefer content blocks if present (tree=True often returns msg.text="")
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((block) => block && block.type === "text" && block.text)
        .map((block) => block.text);
      if (textParts.length) return textParts.join("\n");
    }
    if (typeof msg.text === "string" && msg.text.trim()) return msg.text;
    return "[no text content]";
  }

  /**
   * Map Claude sender values to our role format.
   */
  function normalizeRole(sender) {
    if (sender === "human") return "user";
    if (sender === "assistant") return "assistant";
    // Fallback: treat system/other as assistant
    return "assistant";
  }

  /**
   * Truncate text to ~8-10 words at a clean word boundary.
   * For code blocks, shows a code indicator instead.
   */
  function truncate(text) {
    const trimmed = text.trim();
    // Code block indicator
    if (trimmed.startsWith("```") || trimmed.startsWith("    ")) {
      return "```code…";
    }
    const words = trimmed.split(/\s+/);
    if (words.length <= 5) return trimmed;
    return words.slice(0, 5).join(" ") + "…";
  }

  /**
   * Build the normalized tree from Claude API response.
   *
   * Returns: {
   *   nodes: Map<string, NodeData>,
   *   rootId: string,
   *   messageOrder: string[],  // all node IDs in tree order
   * }
   */
  /**
   * Extract conversation name from API response.
   * Logs top-level keys to console so we can debug if it's missing.
   */
  function extractConversationName(apiResponse) {
    // Log the top-level keys so we can find where the name lives
    console.log("[ClaudeTreeVisual] API response keys:", Object.keys(apiResponse));

    // Try all known paths
    const candidates = [
      apiResponse.name,
      apiResponse.title,
      apiResponse.chat_conversation?.name,
      apiResponse.chat_conversation?.title,
      apiResponse.conversation?.name,
      apiResponse.conversation?.title,
    ];

    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }

    return null; // caller will fall back to page title
  }

  function normalizeTree(apiResponse) {
    const conversationName = extractConversationName(apiResponse);
    const rawMessages = extractMessages(apiResponse);
    assert(rawMessages.length > 0, "Conversation has no messages");

    // Build nodes map
    const nodes = new Map();
    const childrenMap = new Map(); // parentId -> [childIds]

    for (const msg of rawMessages) {
      assert(msg.uuid, "Message missing uuid");

      const fullText = getMessageText(msg);
      const node = {
        id: msg.uuid,
        parentId: msg.parent_message_uuid || null,
        childIds: [], // filled in second pass
        role: normalizeRole(msg.sender),
        text: truncate(fullText),
        fullText: fullText,
        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : 0,
        depth: 0, // computed below
        isLeaf: false, // computed below
        isBranchPoint: false, // computed below
        index: msg.index != null ? msg.index : -1,
      };

      nodes.set(node.id, node);

      // Track parent→child relationships
      const pid = node.parentId;
      if (pid) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(node.id);
      }
    }

    // Assign children and compute flags
    for (const [parentId, childIds] of childrenMap) {
      if (nodes.has(parentId)) {
        // Sort children by timestamp so branches appear in creation order
        childIds.sort((a, b) => {
          const na = nodes.get(a);
          const nb = nodes.get(b);
          return (na.timestamp || 0) - (nb.timestamp || 0);
        });
        nodes.get(parentId).childIds = childIds;
      }
    }

    // Find root(s) — nodes with no parent or parent not in the set
    const roots = [];
    for (const node of nodes.values()) {
      if (!node.parentId || !nodes.has(node.parentId)) {
        node.parentId = null;
        roots.push(node.id);
      }
    }

    // If multiple roots, create a synthetic root
    let rootId;
    if (roots.length === 1) {
      rootId = roots[0];
    } else if (roots.length > 1) {
      // Multiple roots — create synthetic root to unify them
      const syntheticRoot = {
        id: "__synthetic_root__",
        parentId: null,
        childIds: roots,
        role: "system",
        text: "Conversation",
        fullText: "Conversation Root",
        timestamp: 0,
        depth: 0,
        isLeaf: false,
        isBranchPoint: roots.length > 1,
        index: -1,
      };
      nodes.set(syntheticRoot.id, syntheticRoot);
      rootId = syntheticRoot.id;
    } else {
      throw new Error("No root nodes found in conversation");
    }

    // Compute depths via BFS
    const queue = [rootId];
    const visited = new Set();
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const node = nodes.get(id);
      for (const childId of node.childIds) {
        const child = nodes.get(childId);
        if (child) {
          child.depth = node.depth + 1;
          queue.push(childId);
        }
      }
    }

    // Compute leaf and branch point flags
    for (const node of nodes.values()) {
      node.isLeaf = node.childIds.length === 0;
      node.isBranchPoint = node.childIds.length > 1;
    }

    // Collect all node IDs in DFS order (for ordered traversal)
    const messageOrder = [];
    function dfs(id) {
      messageOrder.push(id);
      const node = nodes.get(id);
      for (const childId of node.childIds) {
        dfs(childId);
      }
    }
    dfs(rootId);

    return { nodes, rootId, messageOrder, conversationName };
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error("[ClaudeTreeVisual] Assertion failed: " + message);
    }
  }

  // Expose globally for other content scripts
  window.ClaudeTreeVisual = window.ClaudeTreeVisual || {};
  window.ClaudeTreeVisual.normalizeTree = normalizeTree;
})();
