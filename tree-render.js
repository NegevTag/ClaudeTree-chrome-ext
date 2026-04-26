// tree-render.js — Render tree nodes as DOM cards + SVG edges.
// Tufte-inspired: minimal chrome, high data-ink ratio.

(function () {
  "use strict";

  const ROLE_COLORS = {
    user: "#5B7BD5",     // muted blue
    assistant: "#6B8E6B", // muted green
    system: "#999",       // gray
  };

  const ROLE_LABELS = {
    user: "You",
    assistant: "Claude",
    system: "",
  };

  /**
   * Render the full tree into the given container element.
   *
   * @param {HTMLElement} container - The scrollable panel content area
   * @param {{ nodes: Map, rootId: string }} tree - Normalized tree
   * @param {Map<string, {x,y,width,height}>} layout - Computed positions
   * @param {function(string)} onNodeClick - Called with node ID when clicked
   */
  function renderTree(container, tree, layout, onNodeClick) {
    container.innerHTML = "";

    const { nodes, rootId } = tree;
    const { NODE_WIDTH, NODE_HEIGHT } = window.ClaudeTreeVisual.LAYOUT;

    // Compute canvas size
    let maxX = 0;
    let maxY = 0;
    for (const pos of layout.values()) {
      if (pos.x + pos.width > maxX) maxX = pos.x + pos.width;
      if (pos.y + pos.height > maxY) maxY = pos.y + pos.height;
    }

    const padding = 24;
    const canvasWidth = maxX + padding * 2;
    const canvasHeight = maxY + padding * 2;

    // Create canvas wrapper
    const canvas = document.createElement("div");
    canvas.className = "ctv-canvas";
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";
    canvas.style.position = "relative";

    // SVG layer for edges (behind nodes)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", canvasWidth);
    svg.setAttribute("height", canvasHeight);
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.pointerEvents = "none";
    canvas.appendChild(svg);

    // Draw edges
    for (const [nodeId, node] of nodes) {
      const parentPos = layout.get(nodeId);
      if (!parentPos) continue;

      for (const childId of node.childIds) {
        const childPos = layout.get(childId);
        if (!childPos) continue;

        const x1 = parentPos.x + NODE_WIDTH / 2 + padding;
        const y1 = parentPos.y + NODE_HEIGHT + padding;
        const x2 = childPos.x + NODE_WIDTH / 2 + padding;
        const y2 = childPos.y + padding;

        const midY = (y1 + y2) / 2;

        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );
        path.setAttribute(
          "d",
          `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#ccc");
        path.setAttribute("stroke-width", "1.5");

        // Highlight edges to branch points
        if (node.isBranchPoint) {
          path.setAttribute("stroke", "#aaa");
        }

        svg.appendChild(path);
      }
    }

    // Draw node cards
    for (const [nodeId, node] of nodes) {
      const pos = layout.get(nodeId);
      if (!pos) continue;

      // Skip synthetic root if it only has one child
      if (nodeId === "__synthetic_root__" && node.childIds.length <= 1) continue;

      const card = document.createElement("div");
      card.className = "ctv-node";
      card.dataset.nodeId = nodeId;
      card.style.position = "absolute";
      card.style.left = pos.x + padding + "px";
      card.style.top = pos.y + padding + "px";
      card.style.width = NODE_WIDTH + "px";
      card.style.height = NODE_HEIGHT + "px";

      // Role color accent (left border)
      const roleColor = ROLE_COLORS[node.role] || ROLE_COLORS.system;
      card.style.borderLeftColor = roleColor;

      // Branch point indicator
      if (node.isBranchPoint) {
        card.classList.add("ctv-branch-point");
      }

      // Leaf indicator
      if (node.isLeaf) {
        card.classList.add("ctv-leaf");
      }

      // Role label
      const roleLabel = document.createElement("span");
      roleLabel.className = "ctv-role";
      roleLabel.textContent = ROLE_LABELS[node.role] || node.role;
      roleLabel.style.color = roleColor;
      card.appendChild(roleLabel);

      // Datetime badge (top-right, replacing the old index badge)
      if (node.timestamp !== 0) {
        const datetime = document.createElement("span");
        datetime.className = "ctv-depth ctv-datetime";
        datetime.textContent = new Date(node.timestamp).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        card.appendChild(datetime);
      }

      // Message preview text
      const preview = document.createElement("div");
      preview.className = "ctv-preview";
      preview.textContent = node.text;
      card.appendChild(preview);

      // Click handler
      card.addEventListener("click", () => {
        // Remove previous active state
        const prev = container.querySelector(".ctv-node-active");
        if (prev) prev.classList.remove("ctv-node-active");

        card.classList.add("ctv-node-active");
        onNodeClick(nodeId);
      });

      // Hover: show full text in title
      card.title = node.fullText.slice(0, 300);

      canvas.appendChild(card);
    }

    container.appendChild(canvas);

    // ── Zoom + drag (transform-based) ─────────────────────────────
    // Restore previous view if available (auto-refresh shouldn't reset pan/zoom);
    // otherwise fit the whole tree in view.
    const saved = window.ClaudeTreeVisual._viewState;
    let scale, panX, panY;
    if (saved && saved.scale != null) {
      scale = saved.scale;
      panX = saved.panX;
      panY = saved.panY;
    } else {
      const fitScaleX = container.clientWidth / canvasWidth;
      const fitScaleY = container.clientHeight / canvasHeight;
      scale = Math.min(fitScaleX, fitScaleY, 1) * 0.92;
      panX = (container.clientWidth - canvasWidth * scale) / 2;
      panY = (container.clientHeight - canvasHeight * scale) / 2;
    }
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panStartX = 0;
    let panStartY = 0;

    function applyTransform() {
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      window.ClaudeTreeVisual._viewState = { scale, panX, panY };
    }
    applyTransform();

    applyTransform(); // apply initial centering

    // Scroll wheel = zoom
    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = 0.1;
      const direction = e.deltaY < 0 ? 1 : -1;
      const newScale = Math.max(0.15, Math.min(5, scale + direction * zoomFactor * scale));

      // Zoom toward mouse position
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Adjust pan so zoom centers on mouse
      panX = mx - (mx - panX) * (newScale / scale);
      panY = my - (my - panY) * (newScale / scale);
      scale = newScale;

      applyTransform();
    }, { passive: false });

    // Mouse drag = pan
    container.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ctv-node")) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      container.classList.add("ctv-dragging");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panX = panStartX + (e.clientX - dragStartX);
      panY = panStartY + (e.clientY - dragStartY);
      applyTransform();
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      container.classList.remove("ctv-dragging");
    });
  }

  /**
   * Highlight the path from root to a given node.
   */
  function highlightPath(container, tree, nodeId) {
    // Clear previous highlights
    container.querySelectorAll(".ctv-on-path").forEach((el) => {
      el.classList.remove("ctv-on-path");
    });

    // Walk from node to root, collect path
    const { nodes } = tree;
    const pathIds = new Set();
    let current = nodeId;
    while (current) {
      pathIds.add(current);
      const node = nodes.get(current);
      current = node ? node.parentId : null;
    }

    // Apply highlight class
    for (const id of pathIds) {
      const el = container.querySelector(`[data-node-id="${id}"]`);
      if (el) el.classList.add("ctv-on-path");
    }
  }

  // Expose globally
  window.ClaudeTreeVisual = window.ClaudeTreeVisual || {};
  window.ClaudeTreeVisual.renderTree = renderTree;
  window.ClaudeTreeVisual.highlightPath = highlightPath;
  window.ClaudeTreeVisual.resetView = function () {
    window.ClaudeTreeVisual._viewState = null;
  };
})();
