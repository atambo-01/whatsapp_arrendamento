#!/bin/bash
# run.sh - Rebuild and restart the listings service

set -e
cd "$(dirname "$0")"

echo "Building listings..."
go build -o listings .

echo "Restarting service..."
systemctl --user restart whatsapp-listings

echo "Done. Check status with: systemctl --user status whatsapp-listings"