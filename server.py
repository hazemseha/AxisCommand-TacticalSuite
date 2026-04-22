try:
    import http.server as server
    import socketserver
except ImportError:
    import SimpleHTTPServer as server
    import SocketServer as socketserver

import os
import sys
import json
import socket
import subprocess

# Port discovery loop
PORT = 8000
MAX_ATTEMPTS = 20
httpd = None

os.chdir('dist')

class Handler(server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST')
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/ip':
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('10.255.255.255', 1))
                IP = s.getsockname()[0]
            except Exception:
                IP = '127.0.0.1'
            finally:
                s.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"ip": IP, "port": PORT}).encode())
            return
            
        return server.SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path == '/api/sync/upload':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            with open('sync.pinvault', 'wb') as f:
                f.write(post_data)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            print("[+] AirDrop Sync Hosted (sync.pinvault)")
            return

        if self.path == '/shutdown':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "shutting down"}).encode())
            print("\n[+] Exit signal received! Shutting down...")
            os._exit(0)
            
        self.send_response(404)
        self.end_headers()

for i in range(MAX_ATTEMPTS):
    try:
        current_port = PORT + i
        httpd = socketserver.TCPServer(("0.0.0.0", current_port), Handler)
        PORT = current_port
        break
    except Exception:
        continue

if not httpd:
    print("[ERROR] Could not bind to any port between 8000-8020.")
    sys.exit(1)

print("[*] Serving PinVault at http://localhost:{}".format(PORT))
print("[*] Use the 'Exit' button in the app to close this server.")

try:
    url = "http://localhost:{}".format(PORT)
    # Open browser fallback sequence
    if os.name == 'nt':
        cmd = 'start "" chrome.exe --app="{0}" 2>nul || start "" msedge.exe --app="{0}" 2>nul || start {0}'.format(url)
        subprocess.Popen(cmd, shell=True)
    else:
        import webbrowser
        webbrowser.open(url)
        
    httpd.serve_forever()
except Exception as e:
    print("[ERROR] Server Error: {}".format(e))
except KeyboardInterrupt:
    print("\n[+] Stopped.")
