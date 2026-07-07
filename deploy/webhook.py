#!/usr/bin/env python3
"""
Clarifin deploy webhook — a tiny stdlib-only HTTP server that runs on the VPS HOST
(not inside Docker: a container can't rebuild the stack it runs in).

Listens on 127.0.0.1:9000 (put it behind Nginx: location /deploy-hook → proxy_pass).
GitHub sends a push event; we verify the HMAC-SHA256 signature with WEBHOOK_SECRET,
check the ref is main, and kick off deploy.sh in the background.

Setup: see deploy/README.md
"""
import hashlib
import hmac
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("WEBHOOK_SECRET", "")
DEPLOY_SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/opt/mizan/deploy/deploy.sh")
PORT = int(os.environ.get("WEBHOOK_PORT", "9000"))


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code: int, body: str) -> None:
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        if not SECRET:
            self._reply(503, "webhook secret not configured")
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > 1_000_000:
            self._reply(413, "payload too large")
            return
        body = self.rfile.read(length)

        # GitHub signs the raw body: sha256=<hmac>. Constant-time compare, fail closed.
        sig = self.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            self._reply(401, "bad signature")
            return

        try:
            payload = json.loads(body)
        except Exception:
            self._reply(400, "bad json")
            return

        if payload.get("ref") != "refs/heads/main":
            self._reply(200, "ignored (not main)")
            return

        # Fire and forget — deploy.sh is single-flight (lock file) and logs itself.
        subprocess.Popen(["/bin/bash", DEPLOY_SCRIPT], start_new_session=True)
        self._reply(202, "deploy started")

    def log_message(self, fmt: str, *args) -> None:  # quiet default access log
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
