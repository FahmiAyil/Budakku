/**
 * Renderer Init — initialization, visibility handling
 */

import { AVATAR_FILES, lastAgents, agentStates } from './config.js';
import { playAnimation } from './animationManager.js';
import { addAgent, updateAgent, removeAgent, cleanupAgents, updateGridLayout, showIdleAvatar } from './agentGrid.js';
import { createWebDashboardButton, setupKeyboardShortcuts, setupContextMenu } from './uiComponents.js';
import { createErrorUI } from './errorUI.js';

let availableAvatars = [];
let idleAvatar = 'avatar_0.webp';

async function init() {
  if (!window.electronAPI) {
    console.error('[Renderer] electronAPI not available');
    return;
  }

  setupKeyboardShortcuts();
  setupContextMenu();

  // Load avatar list
  if (window.electronAPI.getAvatars) {
    try {
      const files = await window.electronAPI.getAvatars();
      const validFiles = files.filter(f => f.match(/\.(png|jpe?g|webp|gif)$/i));
      const zero = validFiles.find(f => f.includes('0.') || f.includes('_0.'));
      if (zero) idleAvatar = zero;

      availableAvatars = validFiles.filter(f => f !== idleAvatar);
      if (availableAvatars.length === 0 && idleAvatar) {
        availableAvatars.push(idleAvatar);
      }
    } catch (e) {
      console.warn('Failed to load avatars', e);
    }
  }

  // Display idle avatar
  showIdleAvatar(idleAvatar);

  // Dashboard button — floating overlay at bottom-right corner
  const toolbar = document.createElement('div');
  toolbar.className = 'avatar-toolbar';
  toolbar.appendChild(createWebDashboardButton());
  document.body.appendChild(toolbar);

  // Register event listeners
  window.electronAPI.onAgentAdded(addAgent);
  window.electronAPI.onAgentUpdated(updateAgent);
  window.electronAPI.onAgentRemoved(removeAgent);
  window.electronAPI.onAgentsCleaned(cleanupAgents);

  if (window.electronAPI.onErrorOccurred) {
    window.electronAPI.onErrorOccurred(createErrorUI);
  }

  if (window.electronAPI.onPlaySound) {
    window.electronAPI.onPlaySound((type) => {
      if (typeof notificationSound === 'undefined') return;
      if (type === 'done') notificationSound.playDoneSound();
      else if (type === 'permission') notificationSound.playPermissionSound();
    });
  }

  if (window.electronAPI.onShowPermissionPopup) {
    window.electronAPI.onShowPermissionPopup((data) => showPermissionBubble(data));
  }
  if (window.electronAPI.onHidePermissionPopup) {
    window.electronAPI.onHidePermissionPopup((data) => restorePermissionBubble(data.sessionId));
  }

  // Load existing agents
  try {
    const agents = await window.electronAPI.getAllAgents();
    lastAgents.length = 0;
    lastAgents.push(...agents);
    for (const agent of agents) {
      addAgent(agent);
    }
    updateGridLayout();
  } catch (err) {
    console.error('[Renderer] Failed to load agents:', err);
  }

  window.electronAPI.rendererReady();
}

// --- Permission Bubble — 3 separate clickable speech bubbles above character ---
function permBorderClass(opt) {
  const l = opt.toLowerCase();
  if (l === 'deny' || l === 'no') return 'is-alert';
  if (l.includes('always') || l.includes('session')) return 'perm-bubble-always';
  return 'is-complete';
}

function showPermissionBubble(data) {
  const card = document.querySelector(`[data-agent-id="${data.sessionId}"]`);
  if (!card) return;
  const bubble = card.querySelector('.agent-bubble');
  if (!bubble) return;

  // Mark card as showing permission options
  card._permStash = true;
  const optCount = (data.options || ['Allow', 'Deny']).length;
  window.electronAPI.expandForPermission?.(optCount * 30 + 10);

  // Remove any existing option container
  card.querySelector('.perm-options')?.remove();

  const container = document.createElement('div');
  container.className = 'perm-options';
  container.style.webkitAppRegion = 'no-drag';
  container.style.pointerEvents = 'auto';

  (data.options || ['Allow', 'Deny']).forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'agent-bubble perm-opt ' + permBorderClass(opt);
    btn.textContent = opt;
    btn.style.webkitAppRegion = 'no-drag';
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const decision = (opt.toLowerCase() === 'deny' || opt.toLowerCase() === 'no') ? 'deny' : 'allow';
      window.electronAPI.sendPermissionDecision?.(data.sessionId, decision);
      restorePermissionBubble(data.sessionId);
    });
    container.appendChild(btn);
  });

  // Insert above the project name tag
  const typeTag = card.querySelector('.type-tag');
  card.insertBefore(container, typeTag || bubble);
}

function restorePermissionBubble(sessionId) {
  const card = document.querySelector(`[data-agent-id="${sessionId}"]`);
  if (!card) return;
  card.querySelector('.perm-options')?.remove();
  card._permStash = null;
  window.electronAPI.restoreFromPermission?.();
}

// --- Visibility handling ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const [agentId, state] of agentStates.entries()) {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    }
  } else {
    for (const [agentId, state] of agentStates.entries()) {
      if (state.animName) {
        const card = document.querySelector(`[data-agent-id="${agentId}"]`);
        const character = card?.querySelector('.agent-character');
        if (character) {
          const tempAnim = state.animName;
          state.animName = null;
          playAnimation(agentId, character, tempAnim);
        }
      }
    }
  }
});

// --- Start ---
init();
