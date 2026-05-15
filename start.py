#!/usr/bin/env python3
"""
Servidor de desarrollo local para Control de Acceso.
Uso: python start.py
Luego abra http://localhost:8080 en su navegador.
"""
import http.server
import socketserver
import os

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Evitar cache agresivo en desarrollo para config.js y sw.js
        if self.path in ('/js/config.js', '/sw.js', '/index.html'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"✅ Servidor listo en http://localhost:{PORT}")
        print(f"   Empleado: http://localhost:{PORT}")
        print(f"   Admin:    http://localhost:{PORT}/#admin")
        print("   Presione Ctrl+C para detener.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Servidor detenido.")
