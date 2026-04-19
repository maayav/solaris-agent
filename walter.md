#!/bin/bash
# ══════════════════════════════════════════════════════
# ELITE-RECON v2.0
# Tuned for Juice Shop — works on any web target
# Usage: ./elite-recon.sh <target_url>
#   e.g. ./elite-recon.sh http://127.0.0.1:3000
#        ./elite-recon.sh https://example.vercel.app
# ══════════════════════════════════════════════════════

set -uo pipefail

TARGET="${1:?[!] Usage: $0 <target_url>}"
DOMAIN=$(echo "$TARGET" | sed 's~https\?://~~' | cut -d/ -f1 | cut -d: -f1)

# ── Wordlists ──────────────────────────────────────────
WORDLIST_DIR="/home/peburu/wordlists/recon"
MAIN_WL="$WORDLIST_DIR/directories/raft-small-directories.txt"
VERCEL_WL="$WORDLIST_DIR/vercel-paths.txt"   # custom: _next/static, api/, .env, etc.

# ── Juice Shop Known Paths (always probed directly) ────
JUICESHOP_PATHS=(
  "/ftp"
  "/ftp/legal.md"
  "/ftp/acquisitions.md"
  "/api/Users"
  "/api/Products"
  "/api/Feedbacks"
  "/api/SecurityQuestions"
  "/rest/admin/application-configuration"
  "/rest/basket/1"
  "/rest/user/whoami"
  "/metrics"
  "/wallet/balance"
  "/administration"
  "/b2b/v2"
  "/#/score-board"
)

# ── Output directory ───────────────────────────────────
OUT_DIR="./recon-$(echo "$DOMAIN" | tr ':.' '-')-$(date +%s)"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "📁 Output dir : $OUT_DIR"
echo "🚀 ELITE RECON: $TARGET"
echo "   Domain     : $DOMAIN"
echo "──────────────────────────────────────────────────"

# ══════════════════════════════════════════════════════
# 1. HEADERS + TECH FINGERPRINT
# ══════════════════════════════════════════════════════
echo ""
echo "[1/11] 🔍 Headers + Tech Fingerprint..."
curl -sI "$TARGET" \
  | grep -Ei "server|x-powered-by|vercel|next|supabase|railway|x-frame|content-security-policy|x-runtime|cf-ray" \
  | tee headers.txt
echo "  ✓ Done"

# ══════════════════════════════════════════════════════
# 2. NMAP — common web ports
# ══════════════════════════════════════════════════════
echo ""
echo "[2/11] 🔍 Nmap Port Scan..."
nmap -p 80,443,3000,8080,8443,8888 \
  --script http-title,banner \
  "$DOMAIN" | tee nmap.txt
echo "  ✓ Done"

# ══════════════════════════════════════════════════════
# 3. FFUF — Directory bruteforce
# ══════════════════════════════════════════════════════
echo ""
echo "[3/11] 💥 FFUF Directory Fuzz..."
ffuf -u "$TARGET/FUZZ" \
  -w "$MAIN_WL" \
  -mc 200,201,301,302,403 \
  -t 20 -timeout 10 \
  -o dirs.json -of json \
  -s 2>/dev/null || true
jq -r '.results[].url' dirs.json 2>/dev/null > dirs_urls.txt || touch dirs_urls.txt
echo "  ✓ Found: $(wc -l < dirs_urls.txt) directories"

# ══════════════════════════════════════════════════════
# 4. FFUF — API route bruteforce
# ══════════════════════════════════════════════════════
echo ""
echo "[4/11] 💥 FFUF API Route Fuzz..."
ffuf -u "$TARGET/api/FUZZ" \
  -w "$MAIN_WL" \
  -mc 200,201,401,405 \
  -t 10 -timeout 10 \
  -o api.json -of json \
  -s 2>/dev/null || true
jq -r '.results[].url' api.json 2>/dev/null > api_urls.txt || touch api_urls.txt
echo "  ✓ Found: $(wc -l < api_urls.txt) API routes"

# ══════════════════════════════════════════════════════
# 5. FFUF — Vercel / Supabase storage paths
# ══════════════════════════════════════════════════════
echo ""
echo "[5/11] 💥 FFUF Vercel + Supabase Storage..."

if [ -f "$VERCEL_WL" ]; then
  ffuf -u "$TARGET/FUZZ" \
    -w "$VERCEL_WL" \
    -mc 200,401,403 \
    -t 15 -timeout 10 \
    -o vercel.json -of json \
    -s 2>/dev/null || true
  jq -r '.results[].url' vercel.json 2>/dev/null > vercel_urls.txt || touch vercel_urls.txt
else
  echo "  [!] vercel-paths.txt not found — skipping Vercel fuzz"
  touch vercel_urls.txt
fi

ffuf -u "$TARGET/storage/v1/object/FUZZ" \
  -w "$MAIN_WL" \
  -mc 200,401 \
  -t 10 -timeout 10 \
  -o storage.json -of json \
  -s 2>/dev/null || true
jq -r '.results[].url' storage.json 2>/dev/null > storage_urls.txt || touch storage_urls.txt
echo "  ✓ Done"

# ══════════════════════════════════════════════════════
# 5b. JUICE SHOP — Direct known-path probe
# ══════════════════════════════════════════════════════
echo ""
echo "[5b]   🧃 Juice Shop Known Path Probe..."
for path in "${JUICESHOP_PATHS[@]}"; do
  STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 5 "$TARGET$path" 2>/dev/null)
  echo "  $STATUS  $TARGET$path"
done | tee juiceshop_probe.txt
echo "  ✓ Done"

# ══════════════════════════════════════════════════════
# 6. HTTPX — Validate & enrich all found URLs
# ══════════════════════════════════════════════════════
echo ""
echo "[6/11] 🌐 HTTPX Live Check..."
cat dirs_urls.txt api_urls.txt vercel_urls.txt storage_urls.txt 2>/dev/null \
  | grep -E '^https?://' \
  | sort -u \
  | httpx -title -tech-detect -status-code -silent \
  | tee live.txt
echo "  ✓ Live: $(wc -l < live.txt) endpoints"

# ══════════════════════════════════════════════════════
# 7. KATANA — JS crawl (goldmine for SPAs)
# ══════════════════════════════════════════════════════
echo ""
echo "[7/11] 🕷️  Katana JS Crawl..."
katana -u "$TARGET" -jc -kf all -silent 2>/dev/null \
  | tee all_crawled.txt \
  | httpx -silent \
  | tee crawled.txt

# Merge katana hits into live.txt
cat crawled.txt >> live.txt
sort -u live.txt -o live.txt
echo "  ✓ Crawled: $(wc -l < all_crawled.txt) URLs  |  Live: $(wc -l < live.txt) total"

# ══════════════════════════════════════════════════════
# 8. NUCLEI — Vuln scan (live endpoints + direct target)
# ══════════════════════════════════════════════════════
echo ""
echo "[8/11] ☢️  Nuclei Vuln Scan..."

# Broad template scan on all live URLs
if [ -s live.txt ]; then
  nuclei -l live.txt \
    -t cves/ -t exposures/ -t misconfiguration/ -t technologies/ \
    -severity medium,high,critical \
    -rl 25 -c 10 -silent 2>/dev/null \
    | tee nuclei.txt
else
  echo "  [!] live.txt empty — running on target directly"
  touch nuclei.txt
fi

# Juice Shop / OWASP specific tags on target
nuclei -u "$TARGET" \
  -tags owasp,juice-shop,sqli,xss,idor,auth-bypass,misconfig \
  -severity info,low,medium,high,critical \
  -rl 10 -silent 2>/dev/null \
  | tee -a nuclei.txt

sort -u nuclei.txt -o nuclei.txt
echo "  ✓ Nuclei hits: $(wc -l < nuclei.txt)"



# ══════════════════════════════════════════════════════
# 9. JS SECRETS — Scan crawled .js bundles
#    Reuses Step 7's all_crawled.txt (no re-crawl)
# ══════════════════════════════════════════════════════
echo ""
echo "[9/11] 🔑 JS Secrets Scan..."
grep '\.js$' all_crawled.txt 2>/dev/null \
  | sort -u \
  | head -50 \
  | xargs -I {} sh -c \
    'echo "=== {} ==="; curl -s --max-time 10 "{}" \
      | grep -Ei "(key|secret|token|password|api_key|anon_key|service_role|vercel|railway|supabase|postgres|mongodb|redis|bearer|authorization)[^a-z0-9_-]" \
      | grep -v "//.*comment" \
      | head -5' \
  2>/dev/null \
  | tee js_secrets.txt

SECRET_COUNT=$(grep -v '^===' js_secrets.txt 2>/dev/null | grep -c . || echo 0)
echo "  ✓ Secret hits: $SECRET_COUNT"

# ══════════════════════════════════════════════════════
# 10. GAU — Wayback / historical endpoints
#     gau takes a bare domain (no https://)
# ══════════════════════════════════════════════════════
echo ""
echo "[10/11] 📼 GAU Wayback Scan..."
gau "$DOMAIN" 2>/dev/null \
  | httpx -silent 2>/dev/null \
  | nuclei -t exposures/ -severity medium,high,critical -silent 2>/dev/null \
  | tee wayback.txt \
  || echo "  [!] gau returned no results or is unavailable" | tee wayback.txt
echo "  ✓ Wayback hits: $(wc -l < wayback.txt)"

# ══════════════════════════════════════════════════════
# 11. SUMMARY REPORT
# ══════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║            📊  RECON SUMMARY                 ║"
echo "╠══════════════════════════════════════════════╣"
printf  "║  Target      : %-30s║\n" "$TARGET"
printf  "║  Domain      : %-30s║\n" "$DOMAIN"
echo   "╠══════════════════════════════════════════════╣"
printf  "║  FFUF Dirs   : %-5s                         ║\n" "$(wc -l < dirs_urls.txt 2>/dev/null || echo 0)"
printf  "║  FFUF API    : %-5s                         ║\n" "$(wc -l < api_urls.txt 2>/dev/null || echo 0)"
printf  "║  Live URLs   : %-5s                         ║\n" "$(wc -l < live.txt 2>/dev/null || echo 0)"
printf  "║  Crawled JS  : %-5s                         ║\n" "$(grep '\.js$' all_crawled.txt 2>/dev/null | wc -l || echo 0)"
printf  "║  Nuclei hits : %-5s                         ║\n" "$(wc -l < nuclei.txt 2>/dev/null || echo 0)"
printf  "║  JS Secrets  : %-5s                         ║\n" "$SECRET_COUNT"
printf  "║  Wayback     : %-5s                         ║\n" "$(wc -l < wayback.txt 2>/dev/null || echo 0)"
echo   "╚══════════════════════════════════════════════╝"

echo ""
echo "🔴  TOP NUCLEI FINDINGS:"
if [ -s nuclei.txt ]; then
  head -20 nuclei.txt
else
  echo "  None"
fi

echo ""
echo "🌐  TOP LIVE ENDPOINTS:"
if [ -s live.txt ]; then
  head -15 live.txt
else
  echo "  None"
fi

echo ""
echo "🔑  SECRET HITS:"
if [ -s js_secrets.txt ] && [ "$SECRET_COUNT" -gt 0 ]; then
  grep -v '^===' js_secrets.txt | head -10
else
  echo "  None"
fi

echo ""
echo "🧃  JUICE SHOP PROBE RESULTS:"
grep -v '^  200  ' juiceshop_probe.txt 2>/dev/null | head -20 || true
echo ""
grep '^  200  ' juiceshop_probe.txt 2>/dev/null \
  | awk '{print "  ✅ " $2}' || echo "  No 200s found"

echo ""
echo "📁  All output saved to: $OUT_DIR/"
echo "    Files: headers.txt nmap.txt dirs_urls.txt api_urls.txt"
echo "           live.txt crawled.txt nuclei.txt js_secrets.txt"
echo "           juiceshop_probe.txt wayback.txt"s


cd /run/media/peburu/BIG\ DRIVE/Backup/Projects/Prawin/solaris/solaris-agent/agent-swarm && ALPHA_LLM_PLANNING=true timeout 1200 npx bun run src/e2e-test.ts 2>&1
cd /run/media/peburu/BIG\ DRIVE/Backup/Projects/Prawin/solaris/solaris-agent/agent-swarm && timeout 600 bun run dist/e2e-gamma.js 2>&1

