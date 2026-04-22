/**
 * logger.js — Tactical Log Console for field debugging
 * Captures console output and provides an in-app overlay
 */

const logs = [];
const MAX_LOGS = 200;

export const Logger = {
  init() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      this.addLog('LOG', args);
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      this.addLog('ERROR', args);
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      this.addLog('WARN', args);
      originalWarn.apply(console, args);
    };

    // Capture uncaught errors
    window.onerror = (msg, url, line, col, error) => {
      this.addLog('CRITICAL', [`${msg} at ${line}:${col}`]);
      return false;
    };
  },

  addLog(type, args) {
    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    logs.push({ timestamp, type, message });
    if (logs.length > MAX_LOGS) logs.shift();

    const display = document.getElementById('log-display');
    if (display) {
      const logLine = document.createElement('div');
      logLine.className = `log-line log-${type.toLowerCase()}`;
      logLine.innerHTML = `<span class="log-time">[${timestamp}]</span> <span class="log-type">${type}</span>: ${message}`;
      display.appendChild(logLine);
      display.scrollTop = display.scrollHeight;
    }
  },

  getLogs() {
    return logs;
  },

  exportLogs() {
    const text = logs.map(l => `[${l.timestamp}] ${l.type}: ${l.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinvault_logs_${Date.now()}.txt`;
    a.click();
  }
};
