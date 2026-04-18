#!/bin/bash
# Wrapper so preview_start can launch vite without relying on inherited cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
export PATH="/opt/homebrew/bin:$PATH"
exec ./node_modules/.bin/vite --port 5174 --host 127.0.0.1
