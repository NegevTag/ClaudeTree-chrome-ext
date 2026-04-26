# Claude Tree Visual

Chrome extension that visualizes Claude.ai conversations as a navigable tree instead of linear chat with branch arrows.

> ⚠️ **Vibe-coded.** Built end-to-end with Claude Code through conversational iteration — no upfront design doc, just shipping features as ideas came up. Treat it accordingly.

## Architecture

```
User clicks extension icon
  → background.js sends TOGGLE_PANEL to content.js
  → content.js injects bridge.js into page context
  → bridge.js fetches conversation tree via Claude API (?tree=True)
  → data-normalize.js transforms response into tree model
  → tree-layout.js computes node positions (Reingold-Tilford)
  → tree-render.js renders DOM cards + SVG edges in side panel
  → Click a node → scrolls claude.ai to that message
```

## Setup

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this `ClaudeTreeVisual` folder
5. Navigate to any conversation on [claude.ai](https://claude.ai)
6. Click the extension icon in the toolbar (or press `Ctrl+Shift+T`)

## Usage

- **Toggle panel**: Click the toolbar icon or press `Ctrl+Shift+T`
- **Navigate**: Click any node in the tree to scroll to that message
- **Refresh**: Click the ↻ button if the conversation changed
- **Branch points**: Nodes with multiple children are highlighted with a thicker left border
- **Path highlight**: Clicking a node highlights the full path from root to that node

## How It Works

The extension uses Claude.ai's internal API with `?tree=True` to fetch the full conversation structure including all branches. Each message has a `uuid` and `parent_message_uuid`, which lets us reconstruct the tree.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 extension config |
| `background.js` | Service worker — toolbar icon click handler |
| `bridge.js` | Page-context script — fetches API with session cookies |
| `data-normalize.js` | API response → internal tree model |
| `tree-layout.js` | Computes node positions (Reingold-Tilford) |
| `tree-render.js` | Renders DOM cards + SVG edges |
| `content.js` | Orchestrator — panel, data flow, navigation |
| `styles.css` | Tufte-inspired visual styling |

## Requirements

- Chrome browser (Manifest V3)
- Logged into [claude.ai](https://claude.ai)
- A conversation with branches (edit + resend a message to create one)

## Nice Icons (Optional)

The extension ships with solid-color placeholder icons. To generate proper tree-shaped icons:
1. Open `icons/generate-icons.html` in your browser
2. Right-click each canvas → Save image as → replace the corresponding `icon-{size}.png`
