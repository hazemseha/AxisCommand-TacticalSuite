/**
 * tool-manager.js — Central Tool Activation Manager
 * Ensures only ONE tactical tool is active at a time.
 * All tools must register and use this to activate/deactivate.
 */

const registeredTools = {};
let activeToolId = null;

/**
 * Register a tool with its deactivation function
 */
export function registerTool(id, deactivateFn) {
  registeredTools[id] = deactivateFn;
}

/**
 * Deactivate ALL tools except the one being activated
 */
export function deactivateAllTools(exceptId = null) {
  for (const [id, deactivateFn] of Object.entries(registeredTools)) {
    if (id !== exceptId && typeof deactivateFn === 'function') {
      try { deactivateFn(); } catch(e) { /* ignore */ }
    }
  }
  if (!exceptId) activeToolId = null;
}

/**
 * Request activation of a tool — deactivates all others first
 * Returns true if activation is allowed
 */
export function requestActivation(toolId) {
  deactivateAllTools(toolId);
  activeToolId = toolId;
  return true;
}

/**
 * Notify that a tool has been deactivated
 */
export function notifyDeactivation(toolId) {
  if (activeToolId === toolId) activeToolId = null;
}

/**
 * Get currently active tool ID
 */
export function getActiveTool() {
  return activeToolId;
}

/**
 * Helper: prevent panel clicks from reaching the map
 */
export function blockMapClicks(panelElement) {
  if (!panelElement) return;
  ['click', 'mousedown', 'dblclick', 'contextmenu'].forEach(evt => {
    panelElement.addEventListener(evt, (e) => e.stopPropagation());
  });
}
