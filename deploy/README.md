# Clarifin deploy — auto-deploy on git push

One-time setup on the VPS (31.220.90.52):

```bash
# 1. Make the deploy script executable + create the log file
chmod +x /opt/mizan/deploy/deploy.sh
touch /var/log/clarifin-deploy.log

# 2. Install the webhook listener as a systemd service
cp /opt/mizan/deploy/clarifin-webhook.service /etc/systemd/system/
# EDIT the file: set WEBHOOK_SECRET to a long random string
systemctl daemon-reload
systemctl enable --now clarifin-webhook

# 3. Expose it through Nginx (inside the clarifin.xyz server block):
#    location /deploy-hook {
#        proxy_pass http://127.0.0.1:9000;
#        proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
#    }
nginx -t && systemctl reload nginx
```

GitHub → repo → Settings → Webhooks → Add webhook:
- Payload URL: `https://clarifin.xyz/deploy-hook`
- Content type: `application/json`
- Secret: the same WEBHOOK_SECRET
- Events: just the push event

Every push to `main` now pulls, rebuilds backend+frontend images, applies Alembic
migrations and restarts the stack. Deploys are single-flight (lock file) and logged
to `/var/log/clarifin-deploy.log`. Manual deploy: `bash /opt/mizan/deploy/deploy.sh`.
