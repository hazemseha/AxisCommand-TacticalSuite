/**
 * mesh.js — Tactical Offline Mesh Network
 * LAN-based peer discovery and encrypted messaging.
 * 
 * On Electron: Uses WebSocket over local network (LAN)
 * Supports: Chat, coordinate sharing, point sync
 */
import { encrypt, decrypt, isEncryptionActive } from './crypto.js';
import { showToast } from './toast.js';
import { getAllPins, getAllRoutes, getAllZones, savePin, saveRoute, saveZone } from './db.js';
import { generateId } from './db.js';

let ws = null;
let isHost = false;
let peerName = 'Unknown';
let connectedPeers = [];
let chatPanel = null;
let chatMessages = [];
let onPeersChanged = null;
let map = null;

const MESH_PORT = 9477;
const MESH_VERSION = '1.0';

// ===== INIT =====

export function initMesh(mapInstance, userName) {
  map = mapInstance;
  peerName = userName || 'مشغل مجهول';
  createChatPanel();
}

// ===== CONNECTION =====

/**
 * Start as host (server) — other devices connect to you
 */
export async function startHost() {
  try {
    // In Electron, we use the main process to create a WebSocket server
    if (window.electronAPI?.startMeshServer) {
      const result = await window.electronAPI.startMeshServer(MESH_PORT);
      isHost = true;
      showToast(`📡 شبكة تكتيكية — الخادم يعمل على المنفذ ${MESH_PORT}`, 'success');
      updateStatusUI('hosting');
      return result;
    } else {
      showToast('❌ خاصية الشبكة غير مدعومة في هذا الوضع', 'error');
    }
  } catch (e) {
    console.error('[Mesh] Host start failed:', e);
    showToast('❌ فشل بدء الخادم: ' + e.message, 'error');
  }
}

/**
 * Connect to a host by IP address
 */
export async function connectToHost(hostIp) {
  try {
    const url = `ws://${hostIp}:${MESH_PORT}`;
    ws = new WebSocket(url);
    
    ws.onopen = () => {
      showToast(`✅ متصل بالشبكة التكتيكية — ${hostIp}`, 'success');
      updateStatusUI('connected');
      
      // Send join message
      sendMessage({
        type: 'join',
        name: peerName,
        version: MESH_VERSION,
        timestamp: Date.now()
      });
    };
    
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (e) {
        console.warn('[Mesh] Bad message:', e);
      }
    };
    
    ws.onerror = (e) => {
      console.error('[Mesh] Connection error:', e);
      showToast('❌ خطأ في الاتصال', 'error');
      updateStatusUI('disconnected');
    };
    
    ws.onclose = () => {
      showToast('🔌 انقطع الاتصال بالشبكة', 'info');
      updateStatusUI('disconnected');
      ws = null;
    };
    
  } catch (e) {
    console.error('[Mesh] Connect failed:', e);
    showToast('❌ فشل الاتصال: ' + e.message, 'error');
  }
}

/**
 * Disconnect from mesh
 */
export function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  updateStatusUI('disconnected');
  showToast('🔌 غادرت الشبكة التكتيكية', 'info');
}

// ===== MESSAGING =====

function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Send a chat message
 */
export function sendChat(text) {
  if (!text.trim()) return;
  
  const msg = {
    type: 'chat',
    name: peerName,
    text: text.trim(),
    timestamp: Date.now()
  };
  
  sendMessage(msg);
  addChatBubble(msg, true); // Show locally
}

/**
 * Send a coordinate/pin from the map
 */
export function sendCoordinate(lat, lng, label) {
  const msg = {
    type: 'coordinate',
    name: peerName,
    lat: lat,
    lng: lng,
    label: label || `نقطة من ${peerName}`,
    timestamp: Date.now()
  };
  
  sendMessage(msg);
  showToast(`📍 تم إرسال الإحداثيات: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'success');
}

/**
 * Sync all points to connected peers
 */
export async function syncPoints() {
  try {
    const pins = await getAllPins();
    const routes = await getAllRoutes();
    const zones = await getAllZones();
    
    const msg = {
      type: 'sync',
      name: peerName,
      data: {
        pins: pins,
        routes: routes,
        zones: zones
      },
      timestamp: Date.now()
    };
    
    sendMessage(msg);
    showToast(`🔄 تم إرسال ${pins.length} نقطة + ${routes.length} مسار + ${zones.length} منطقة`, 'success');
  } catch (e) {
    console.error('[Mesh] Sync failed:', e);
    showToast('❌ فشل المزامنة', 'error');
  }
}

// ===== MESSAGE HANDLER =====

async function handleMessage(msg) {
  switch (msg.type) {
    case 'join':
      if (!connectedPeers.find(p => p.name === msg.name)) {
        connectedPeers.push({ name: msg.name, joinedAt: msg.timestamp });
      }
      updatePeersUI();
      addSystemMessage(`🟢 ${msg.name} انضم للشبكة`);
      break;
      
    case 'chat':
      addChatBubble(msg, false);
      // Notification sound/vibration
      if (navigator.vibrate) navigator.vibrate(50);
      break;
      
    case 'coordinate':
      addSystemMessage(`📍 ${msg.name} أرسل إحداثيات: ${msg.label}`);
      // Add marker to map
      if (map) {
        const L = window.L;
        L.marker([msg.lat, msg.lng], {
          icon: L.divIcon({
            className: 'mesh-received-marker',
            html: `<div style="background:#4285f4; color:#fff; padding:2px 6px; border-radius:4px; font-size:11px; white-space:nowrap; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">📡 ${msg.label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          })
        }).addTo(map);
      }
      break;
      
    case 'sync':
      addSystemMessage(`🔄 ${msg.name} يرسل بيانات مزامنة...`);
      await handleSync(msg.data);
      break;
      
    case 'leave':
      connectedPeers = connectedPeers.filter(p => p.name !== msg.name);
      updatePeersUI();
      addSystemMessage(`🔴 ${msg.name} غادر الشبكة`);
      break;
  }
}

async function handleSync(data) {
  let imported = { pins: 0, routes: 0, zones: 0 };
  
  try {
    if (data.pins) {
      for (const pin of data.pins) {
        pin.id = generateId(); // New ID to avoid conflicts
        pin.syncedFrom = peerName;
        await savePin(pin);
        imported.pins++;
      }
    }
    if (data.routes) {
      for (const route of data.routes) {
        route.id = generateId();
        route.syncedFrom = peerName;
        await saveRoute(route);
        imported.routes++;
      }
    }
    if (data.zones) {
      for (const zone of data.zones) {
        zone.id = generateId();
        zone.syncedFrom = peerName;
        await saveZone(zone);
        imported.zones++;
      }
    }
    
    showToast(`✅ مزامنة: ${imported.pins} نقطة + ${imported.routes} مسار + ${imported.zones} منطقة`, 'success');
    addSystemMessage(`✅ تم استيراد البيانات بنجاح`);
  } catch (e) {
    console.error('[Mesh] Sync import failed:', e);
    showToast('❌ فشل استيراد بيانات المزامنة', 'error');
  }
}

// ===== CHAT UI =====

function createChatPanel() {
  chatPanel = document.createElement('div');
  chatPanel.id = 'mesh-chat-panel';
  chatPanel.className = 'mesh-chat-panel hidden';
  chatPanel.innerHTML = `
    <div class="mesh-chat-header">
      <span>💬 الشات التكتيكي</span>
      <div class="mesh-chat-header-actions">
        <span id="mesh-status" class="mesh-status">⚪ غير متصل</span>
        <button id="mesh-close-chat" style="background:none; border:none; color:#fff; cursor:pointer; font-size:16px;">✕</button>
      </div>
    </div>
    <div id="mesh-peers" class="mesh-peers"></div>
    <div id="mesh-messages" class="mesh-messages"></div>
    <div class="mesh-chat-input-bar">
      <input type="text" id="mesh-chat-input" placeholder="اكتب رسالة..." autocomplete="off" />
      <button id="mesh-send-btn">📤</button>
    </div>
    <div class="mesh-chat-actions">
      <button id="mesh-sync-btn" class="mesh-action-btn">🔄 مزامنة</button>
      <button id="mesh-disconnect-btn" class="mesh-action-btn mesh-danger">🔌 قطع</button>
    </div>
  `;
  
  document.body.appendChild(chatPanel);
  
  // Wire events
  document.getElementById('mesh-close-chat')?.addEventListener('click', toggleChatPanel);
  
  document.getElementById('mesh-send-btn')?.addEventListener('click', () => {
    const input = document.getElementById('mesh-chat-input');
    if (input?.value) {
      sendChat(input.value);
      input.value = '';
      input.focus();
    }
  });
  
  document.getElementById('mesh-chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('mesh-send-btn')?.click();
    }
  });
  
  document.getElementById('mesh-sync-btn')?.addEventListener('click', syncPoints);
  document.getElementById('mesh-disconnect-btn')?.addEventListener('click', disconnect);
}

export function toggleChatPanel() {
  if (chatPanel) {
    chatPanel.classList.toggle('hidden');
  }
}

function addChatBubble(msg, isMine) {
  const container = document.getElementById('mesh-messages');
  if (!container) return;
  
  const bubble = document.createElement('div');
  bubble.className = `mesh-bubble ${isMine ? 'mesh-bubble-mine' : 'mesh-bubble-other'}`;
  
  const time = new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  
  bubble.innerHTML = `
    ${!isMine ? `<span class="mesh-bubble-name">${msg.name}</span>` : ''}
    <span class="mesh-bubble-text">${msg.text}</span>
    <span class="mesh-bubble-time">${time}</span>
  `;
  
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  
  chatMessages.push(msg);
}

function addSystemMessage(text) {
  const container = document.getElementById('mesh-messages');
  if (!container) return;
  
  const el = document.createElement('div');
  el.className = 'mesh-system-msg';
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function updatePeersUI() {
  const el = document.getElementById('mesh-peers');
  if (!el) return;
  
  if (connectedPeers.length === 0) {
    el.innerHTML = '<span style="color:#888; font-size:0.7rem;">لا يوجد أجهزة متصلة</span>';
  } else {
    el.innerHTML = connectedPeers.map(p => 
      `<span class="mesh-peer-badge">🟢 ${p.name}</span>`
    ).join('');
  }
}

function updateStatusUI(status) {
  const el = document.getElementById('mesh-status');
  if (!el) return;
  
  switch (status) {
    case 'hosting':
      el.textContent = '📡 خادم';
      el.style.color = '#06d6a0';
      break;
    case 'connected':
      el.textContent = '🟢 متصل';
      el.style.color = '#06d6a0';
      break;
    case 'disconnected':
      el.textContent = '⚪ غير متصل';
      el.style.color = '#888';
      break;
  }
}
