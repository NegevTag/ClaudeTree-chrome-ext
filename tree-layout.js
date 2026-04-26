// tree-layout.js — Compute x,y positions for tree nodes.
// Simplified Reingold-Tilford: top-down, compact, no overlaps.

(function () {
  "use strict";

  const NODE_WIDTH = 110;
  const NODE_HEIGHT = 58;
  const H_GAP = 8;  // horizontal gap between siblings
  const V_GAP = 24; // vertical gap between depth levels

  /**
   * Compute layout positions for all nodes in the tree.
   *
   * Input:  { nodes: Map, rootId: string }
   * Output: Map<string, { x, y, width, height }>
   *
   * Algorithm:
   *   1. Post-order traversal to assign preliminary x (relative to parent).
   *   2. Pre-order traversal to convert to absolute x.
   *   3. Shift entire tree so minimum x = 0.
   */
  function computeLayout(tree) {
    const { nodes, rootId } = tree;
    const layout = new Map();
    const prelim = new Map(); // preliminary x offset
    const modifier = new Map(); // shift for subtree positioning

    // --- Pass 1: Post-order — assign preliminary x ---
    function postOrder(nodeId) {
      const node = nodes.get(nodeId);
      const children = node.childIds;

      for (const childId of children) {
        postOrder(childId);
      }

      if (children.length === 0) {
        // Leaf: position depends on left sibling
        const leftSibling = getLeftSibling(nodeId, nodes);
        if (leftSibling) {
          prelim.set(nodeId, prelim.get(leftSibling) + NODE_WIDTH + H_GAP);
        } else {
          prelim.set(nodeId, 0);
        }
        modifier.set(nodeId, 0);
      } else if (children.length === 1) {
        // Single child: center above it
        const leftSibling = getLeftSibling(nodeId, nodes);
        if (leftSibling) {
          prelim.set(nodeId, prelim.get(leftSibling) + NODE_WIDTH + H_GAP);
          modifier.set(
            nodeId,
            prelim.get(nodeId) - prelim.get(children[0])
          );
        } else {
          prelim.set(nodeId, prelim.get(children[0]));
          modifier.set(nodeId, 0);
        }
      } else {
        // Multiple children: center above leftmost and rightmost
        const midpoint =
          (prelim.get(children[0]) +
            prelim.get(children[children.length - 1])) /
          2;

        const leftSibling = getLeftSibling(nodeId, nodes);
        if (leftSibling) {
          prelim.set(nodeId, prelim.get(leftSibling) + NODE_WIDTH + H_GAP);
          modifier.set(nodeId, prelim.get(nodeId) - midpoint);
        } else {
          prelim.set(nodeId, midpoint);
          modifier.set(nodeId, 0);
        }
      }

      // Fix overlaps between subtrees
      if (children.length > 0) {
        resolveConflicts(nodeId, nodes, prelim, modifier);
      }
    }

    // --- Pass 2: Pre-order — compute absolute positions ---
    function preOrder(nodeId, modSum) {
      const node = nodes.get(nodeId);
      const x = prelim.get(nodeId) + modSum;
      const y = node.depth * (NODE_HEIGHT + V_GAP);

      layout.set(nodeId, { x, y, width: NODE_WIDTH, height: NODE_HEIGHT });

      const nextModSum = modSum + (modifier.get(nodeId) || 0);
      for (const childId of node.childIds) {
        preOrder(childId, nextModSum);
      }
    }

    postOrder(rootId);
    preOrder(rootId, 0);

    // --- Pass 3: Normalize — shift so min x = 0 ---
    let minX = Infinity;
    for (const pos of layout.values()) {
      if (pos.x < minX) minX = pos.x;
    }
    if (minX !== 0) {
      for (const pos of layout.values()) {
        pos.x -= minX;
      }
    }

    return layout;
  }

  /**
   * Get the left sibling of a node (previous child of the same parent).
   */
  function getLeftSibling(nodeId, nodes) {
    const node = nodes.get(nodeId);
    if (!node.parentId) return null;
    const parent = nodes.get(node.parentId);
    if (!parent) return null;
    const idx = parent.childIds.indexOf(nodeId);
    if (idx <= 0) return null;
    return parent.childIds[idx - 1];
  }

  /**
   * Resolve overlaps between subtrees by checking contour distances.
   * Simplified version: check each pair of adjacent subtrees.
   */
  function resolveConflicts(nodeId, nodes, prelim, modifier) {
    const node = nodes.get(nodeId);
    const children = node.childIds;

    for (let i = 1; i < children.length; i++) {
      // Get rightmost position of left subtree
      const leftContour = getRightContour(children[i - 1], nodes, prelim, modifier, 0);
      // Get leftmost position of right subtree
      const rightContour = getLeftContour(children[i], nodes, prelim, modifier, 0);

      const overlap = leftContour - rightContour + NODE_WIDTH + H_GAP;
      if (overlap > 0) {
        // Shift the right subtree
        prelim.set(children[i], prelim.get(children[i]) + overlap);
        modifier.set(children[i], (modifier.get(children[i]) || 0) + overlap);

        // Re-center parent over children
        const mid =
          (prelim.get(children[0]) + prelim.get(children[children.length - 1])) / 2;
        const parentPrelim = prelim.get(nodeId);
        modifier.set(nodeId, (modifier.get(nodeId) || 0) + (parentPrelim - mid));
      }
    }
  }

  function getRightContour(nodeId, nodes, prelim, mod, modSum) {
    const node = nodes.get(nodeId);
    const x = prelim.get(nodeId) + modSum;
    if (node.childIds.length === 0) return x;
    const nextMod = modSum + (mod.get(nodeId) || 0);
    let maxX = x;
    for (const childId of node.childIds) {
      const cx = getRightContour(childId, nodes, prelim, mod, nextMod);
      if (cx > maxX) maxX = cx;
    }
    return maxX;
  }

  function getLeftContour(nodeId, nodes, prelim, mod, modSum) {
    const node = nodes.get(nodeId);
    const x = prelim.get(nodeId) + modSum;
    if (node.childIds.length === 0) return x;
    const nextMod = modSum + (mod.get(nodeId) || 0);
    let minX = x;
    for (const childId of node.childIds) {
      const cx = getLeftContour(childId, nodes, prelim, mod, nextMod);
      if (cx < minX) minX = cx;
    }
    return minX;
  }

  // Expose globally
  window.ClaudeTreeVisual = window.ClaudeTreeVisual || {};
  window.ClaudeTreeVisual.computeLayout = computeLayout;
  window.ClaudeTreeVisual.LAYOUT = { NODE_WIDTH, NODE_HEIGHT, H_GAP, V_GAP };
})();
