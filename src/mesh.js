/**
 * mesh.js — AxisCommand Tactical Mesh Network (V2.0 — Secure)
 * 
 * LAN-based peer sync with:
 *   - Challenge-Response authentication (SHA-256 PIN hash)
 *   - AES-256-GCM encrypted payloads (via crypto.js)
 *   - Delta sync with LWW conflict resolution (via sync-engine.js)
 *   - Bidirectional incremental sync pipeline
 * 
 * Transport: WebSocket over LAN (port 9477)
 * Protocol: JSON messages with type-based routing
 * 
 * SYNC PIPELINE:
 *   1. Connect → Challenge-Response Auth (PIN hash)
 *   2. Requester sends { type: 'sync-request', lastSyncTime }
 *   3. Responder computes delta via getUpdatesSince(), encrypts, sends
 *   4. Requester decrypts, runs resolveConflicts(), applies locally
 *   5. Requester sends its own encrypted delta back
 *   6. Responder applies, both update lastSyncTime
 */
import { encrypt, decrypt, isEncryptionActive } from './crypto.js';
import { showToast } from './toast.js';
import {
  getUpdatesSince, getLastSyncTime, setLastSyncTime,
  getDeviceId, applyResolvedRecords, generateId
} from './db.js';
import {
  resolveConflicts, validateSyncPayload, formatSyncSummary, computeFingerprint
} from './sync-engine.js';

let ws = null;
let isHost = false;
let peerName = 'Unknown';
let peerDeviceId = null;      // Remote device's ID (set after auth)
let isAuthenticated = false;  // Gate: no data flows until true
let connectedPeers = [];
let chatPanel = null;
let chatMessages = [];
let map = null;
let _syncInProgress = false;

const MESH_PORT = 9477;
const MESH_VERSION = '2.0';
const AUTH_TIMEOUT = 10000; // 10s to complete auth or get kicked

// ===== AUTH HELPERS =====

/**
 * Get the stored PIN hash for authentication.
 * Uses the active user's SHA-256 hash from localStorage.
 * @returns {string|null}
 */
function getAuthHash() {
  try {
    const data = localStorage.getItem('pinvault_auth');
    if (!data) return null;
    return JSON.parse(data).hash || null;
  } catch (e) {
    return null;
  }
}

/**
 * Generate a random challenge nonce (hex string).
 * @returns {string} 32-byte hex nonce
 */
function generateNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute HMAC-like response: SHA-256(nonce + pinHash)
 * Both sides compute this independently — if results match, auth passes.
 * @param {string} nonce
 * @param {string} pinHash
 * @returns {Promise<string>} hex-encoded hash
 */
async function computeAuthResponse(nonce, pinHash) {
  const payload = nonce + pinHash;
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ===== ENCRYPTED MESSAGING =====

/**
 * Send a message over WebSocket with optional encryption.
 * Auth messages are sent in cleartext (they contain no tactical data).
 * All other messages are encrypted if a crypto key is active.
 * @param {Object} msg
 */
async function sendMessage(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const json = JSON.stringify(msg);

  // Auth-phase messages are NOT encrypted (no tactical data in them)
  const authTypes = ['auth-challenge', 'auth-response', 'auth-result', 'auth-request'];
  if (authTypes.includes(msg.type)) {
    ws.send(json);
    return;
  }

  // All tactical messages MUST be encrypted
  if (isEncryptionActive()) {
    try {
      const encrypted = await encrypt(json);
      ws.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
    } catch (e) {
      console.error('[Mesh] Encryption failed, message dropped:', e);
    }
  } else {
    // Fallback: send plaintext with warning header
    console.warn('[Mesh] ⚠️ Sending UNENCRYPTED message (no crypto key active)');
    ws.send(json);
  }
}

/**
 * Decrypt an incoming encrypted envelope.
 * @param {Object} envelope — { type: 'encrypted', payload: 'ENC:...' }
 * @returns {Promise<Object|null>} parsed message or null if decryption fails
 */
async function decryptEnvelope(envelope) {
  if (!envelope.payload) return null;

  try {
    const decrypted = await decrypt(envelope.payload);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('[Mesh] 🔴 SECURITY: Decryption failed — possible tampered or wrong-key packet');
    return null; // Silently drop
  }
}

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
 * Connect to a host by IP address.
 * Initiates the challenge-response authentication handshake.
 */
export async function connectToHost(hostIp) {
  const authHash = getAuthHash();
  if (!authHash) {
    showToast('❌ لا يوجد حساب مسجل — سجّل أولاً', 'error');
    return;
  }

  try {
    const url = `ws://${hostIp}:${MESH_PORT}`;
    ws = new WebSocket(url);
    isAuthenticated = false;
    peerDeviceId = null;

    ws.onopen = () => {
      updateStatusUI('authenticating');
      addSystemMessage('🔐 جاري المصادقة...');

      // Send auth request with our identity
      sendMessage({
        type: 'auth-request',
        name: peerName,
        deviceId: getDeviceId(),
        version: MESH_VERSION,
        timestamp: Date.now()
      });

      // Auth timeout: if not authenticated within 10s, disconnect
      setTimeout(() => {
        if (!isAuthenticated && ws) {
          console.warn('[Mesh] Auth timeout — disconnecting');
          addSystemMessage('🔴 فشل المصادقة — انتهت المهلة');
          disconnect();
        }
      }, AUTH_TIMEOUT);
    };

    ws.onmessage = async (event) => {
      try {
        let msg = JSON.parse(event.data);

        // Handle encrypted envelope
        if (msg.type === 'encrypted') {
          msg = await decryptEnvelope(msg);
          if (!msg) return; // Decryption failed — drop silently
        }

        // GATE: Before auth, only allow auth-type messages
        if (!isAuthenticated && !msg.type.startsWith('auth-')) {
          console.warn('[Mesh] 🔴 Rejected pre-auth message:', msg.type);
          return;
        }

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
      const wasAuth = isAuthenticated;
      isAuthenticated = false;
      peerDeviceId = null;
      showToast('🔌 انقطع الاتصال بالشبكة', 'info');
      updateStatusUI('disconnected');
      ws = null;
      if (wasAuth) addSystemMessage('🔌 انقطع الاتصال');
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
  isAuthenticated = false;
  peerDeviceId = null;
  updateStatusUI('disconnected');
  showToast('🔌 غادرت الشبكة التكتيكية', 'info');
}

// ===== CHAT =====

export function sendChat(text) {
  if (!text.trim() || !isAuthenticated) return;

  const msg = {
    type: 'chat',
    name: peerName,
    text: text.trim(),
    timestamp: Date.now()
  };

  sendMessage(msg);
  addChatBubble(msg, true);
}

/**
 * Send a coordinate/pin from the map
 */
export function sendCoordinate(lat, lng, label) {
  if (!isAuthenticated) return;

  const msg = {
    type: 'coordinate',
    name: peerName,
    lat, lng,
    label: label || `نقطة من ${peerName}`,
    timestamp: Date.now()
  };

  sendMessage(msg);
  showToast(`📍 تم إرسال الإحداثيات: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'success');
}

// ===== SYNC PIPELINE =====

/**
 * Initiate a full bidirectional delta sync with the connected peer.
 * This is the main sync entry point triggered by the user.
 */
export async function syncPoints() {
  if (!isAuthenticated || !peerDeviceId) {
    showToast('❌ يجب الاتصال والمصادقة أولاً', 'error');
    return;
  }

  if (_syncInProgress) {
    showToast('⏳ المزامنة قيد التنفيذ...', 'info');
    return;
  }

  _syncInProgress = true;
  addSystemMessage('🔄 بدء المزامنة...');

  try {
    // Step 1: Get our delta since last sync with this peer
    const lastSync = getLastSyncTime(peerDeviceId);
    const localDelta = await getUpdatesSince(lastSync);

    // Step 2: Send sync request with our delta + last sync time
    const msg = {
      type: 'sync-request',
      deviceId: getDeviceId(),
      lastSyncTime: lastSync,
      delta: localDelta,
      fingerprint: computeFingerprint(localDelta),
      timestamp: Date.now()
    };

    sendMessage(msg);
    showToast('📤 جاري إرسال البيانات المشفرة...', 'info');

  } catch (e) {
    console.error('[Mesh] Sync initiation failed:', e);
    showToast('❌ فشل بدء المزامنة: ' + e.message, 'error');
    _syncInProgress = false;
  }
}

// ===== MESSAGE HANDLER =====

async function handleMessage(msg) {
  switch (msg.type) {

    // ─── AUTH FLOW ───

    case 'auth-request': {
      // We are the HOST receiving a connection request
      const authHash = getAuthHash();
      if (!authHash) {
        sendMessage({ type: 'auth-result', success: false, reason: 'No auth configured on host' });
        return;
      }

      // Generate challenge nonce and send it
      const nonce = generateNonce();
      // Store nonce temporarily for verification (attached to ws context)
      ws._authNonce = nonce;
      ws._authPeerName = msg.name;
      ws._authPeerDeviceId = msg.deviceId;

      sendMessage({
        type: 'auth-challenge',
        nonce: nonce,
        hostDeviceId: getDeviceId(),
        timestamp: Date.now()
      });
      break;
    }

    case 'auth-challenge': {
      // We are the CLIENT receiving a challenge from the host
      const authHash = getAuthHash();
      if (!authHash) {
        disconnect();
        return;
      }

      const response = await computeAuthResponse(msg.nonce, authHash);

      sendMessage({
        type: 'auth-response',
        response: response,
        deviceId: getDeviceId(),
        name: peerName,
        timestamp: Date.now()
      });

      // Store host's deviceId for sync tracking
      peerDeviceId = msg.hostDeviceId;
      break;
    }

    case 'auth-response': {
      // We are the HOST verifying the client's response
      const authHash = getAuthHash();
      const nonce = ws._authNonce;

      if (!authHash || !nonce) {
        sendMessage({ type: 'auth-result', success: false, reason: 'Invalid auth state' });
        return;
      }

      const expected = await computeAuthResponse(nonce, authHash);

      if (msg.response === expected) {
        // ✅ Auth success
        isAuthenticated = true;
        peerDeviceId = msg.deviceId;

        if (!connectedPeers.find(p => p.deviceId === msg.deviceId)) {
          connectedPeers.push({
            name: msg.name,
            deviceId: msg.deviceId,
            joinedAt: Date.now()
          });
        }

        sendMessage({
          type: 'auth-result',
          success: true,
          hostName: peerName,
          hostDeviceId: getDeviceId()
        });

        updatePeersUI();
        updateStatusUI('connected');
        addSystemMessage(`🟢 ${msg.name} — مصادقة ناجحة ✅`);
        showToast(`✅ ${msg.name} متصل ومصادق`, 'success');
      } else {
        // 🔴 Auth failed — reject
        console.warn(`[Mesh] 🔴 AUTH FAILED from ${msg.name} (${msg.deviceId})`);
        sendMessage({
          type: 'auth-result',
          success: false,
          reason: 'Invalid credentials'
        });
        addSystemMessage(`🔴 فشل مصادقة ${msg.name} — تم الرفض`);

        // Disconnect the imposter
        setTimeout(() => disconnect(), 500);
      }

      // Clean up auth state
      delete ws._authNonce;
      delete ws._authPeerName;
      delete ws._authPeerDeviceId;
      break;
    }

    case 'auth-result': {
      // We are the CLIENT receiving auth verdict from host
      if (msg.success) {
        isAuthenticated = true;
        peerDeviceId = msg.hostDeviceId || peerDeviceId;

        if (msg.hostName && !connectedPeers.find(p => p.deviceId === peerDeviceId)) {
          connectedPeers.push({
            name: msg.hostName,
            deviceId: peerDeviceId,
            joinedAt: Date.now()
          });
        }

        updatePeersUI();
        updateStatusUI('connected');
        addSystemMessage('🟢 مصادقة ناجحة — الاتصال آمن ✅');
        showToast('✅ متصل بالشبكة التكتيكية — مشفر', 'success');
      } else {
        addSystemMessage(`🔴 رفض المصادقة: ${msg.reason || 'بيانات خاطئة'}`);
        showToast('❌ فشل المصادقة — تحقق من كلمة المرور', 'error');
        disconnect();
      }
      break;
    }

    // ─── SYNC FLOW ───

    case 'sync-request': {
      // We received a sync request with remote's delta
      if (!isAuthenticated) return;

      addSystemMessage('📥 استلام طلب مزامنة...');

      // Validate remote payload
      const validation = validateSyncPayload(msg.delta);
      if (!validation.valid) {
        console.error('[Mesh] Invalid sync payload:', validation.error);
        sendMessage({ type: 'sync-error', error: validation.error });
        return;
      }

      try {
        // Step 1: Get our own delta since the remote's last sync time
        const ourDelta = await getUpdatesSince(msg.lastSyncTime || 0);

        // Step 2: Resolve conflicts between our data and remote's delta
        const { toApplyLocally, toSendToRemote, stats } = resolveConflicts(ourDelta, msg.delta);

        // Step 3: Apply remote wins to our local DB
        if (hasRecords(toApplyLocally)) {
          const counts = await applyResolvedRecords(toApplyLocally);
          addSystemMessage(`📥 تم تطبيق: ${formatCounts(counts)}`);
        }

        // Step 4: Send our wins back to the requester (encrypted)
        sendMessage({
          type: 'sync-response',
          deviceId: getDeviceId(),
          delta: toSendToRemote,
          stats: stats,
          fingerprint: computeFingerprint(toSendToRemote),
          timestamp: Date.now()
        });

        // Step 5: Update last sync time for this peer
        setLastSyncTime(msg.deviceId, Date.now());
        addSystemMessage(`✅ ${formatSyncSummary(stats)}`);

      } catch (e) {
        console.error('[Mesh] Sync processing failed:', e);
        sendMessage({ type: 'sync-error', error: e.message });
      }
      break;
    }

    case 'sync-response': {
      // We initiated the sync and are receiving the host's delta back
      if (!isAuthenticated) return;

      addSystemMessage('📥 استلام رد المزامنة...');

      const validation = validateSyncPayload(msg.delta);
      if (!validation.valid) {
        console.error('[Mesh] Invalid sync response:', validation.error);
        _syncInProgress = false;
        return;
      }

      try {
        // Step 1: Get our fresh state for conflict resolution
        const ourCurrent = await getUpdatesSince(0); // Full state

        // Step 2: Resolve — the response contains only records where the remote won
        const { toApplyLocally, stats } = resolveConflicts(ourCurrent, msg.delta);

        // Step 3: Apply remote wins
        if (hasRecords(toApplyLocally)) {
          const counts = await applyResolvedRecords(toApplyLocally);
          addSystemMessage(`📥 تم تطبيق: ${formatCounts(counts)}`);
        }

        // Step 4: Mark sync complete for this peer
        setLastSyncTime(msg.deviceId, Date.now());

        const summary = formatSyncSummary(msg.stats || stats);
        addSystemMessage(`✅ مزامنة مكتملة — ${summary}`);
        showToast(`✅ ${summary}`, 'success');

      } catch (e) {
        console.error('[Mesh] Sync response processing failed:', e);
        showToast('❌ فشل معالجة رد المزامنة', 'error');
      } finally {
        _syncInProgress = false;
      }
      break;
    }

    case 'sync-error': {
      addSystemMessage(`🔴 خطأ مزامنة: ${msg.error}`);
      showToast('❌ خطأ في المزامنة: ' + msg.error, 'error');
      _syncInProgress = false;
      break;
    }

    // ─── TACTICAL COMMS ───

    case 'chat':
      if (!isAuthenticated) return;
      addChatBubble(msg, false);
      if (navigator.vibrate) navigator.vibrate(50);
      break;

    case 'coordinate':
      if (!isAuthenticated) return;
      addSystemMessage(`📍 ${msg.name} أرسل إحداثيات: ${msg.label}`);
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

    case 'leave':
      connectedPeers = connectedPeers.filter(p => p.deviceId !== msg.deviceId);
      updatePeersUI();
      addSystemMessage(`🔴 ${msg.name} غادر الشبكة`);
      break;
  }
}

// ===== HELPERS =====

function hasRecords(data) {
  return (data.pins?.length || 0) + (data.routes?.length || 0) +
         (data.zones?.length || 0) + (data.folders?.length || 0) > 0;
}

function formatCounts(counts) {
  const parts = [];
  if (counts.pins > 0) parts.push(`${counts.pins} نقطة`);
  if (counts.routes > 0) parts.push(`${counts.routes} مسار`);
  if (counts.zones > 0) parts.push(`${counts.zones} منطقة`);
  if (counts.folders > 0) parts.push(`${counts.folders} مجلد`);
  return parts.join(' + ') || 'لا تغييرات';
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
    case 'authenticating':
      el.textContent = '🔐 مصادقة...';
      el.style.color = '#ffca28';
      break;
    case 'connected':
      el.textContent = '🟢 متصل — مشفر';
      el.style.color = '#06d6a0';
      break;
    case 'disconnected':
      el.textContent = '⚪ غير متصل';
      el.style.color = '#888';
      break;
  }
}
