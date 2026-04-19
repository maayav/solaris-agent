# Tool Documentation

## ffuf — Fast Web Fuzzer

**Purpose:** Brute-force directories, files, API endpoints, parameters, and virtual hosts
by replacing the `FUZZ` keyword in a URL, header, or POST body with wordlist entries.
Ideal for discovering hidden routes, API paths, and content not linked anywhere.

### Core Flags

| Flag | Description |
|---|---|
| `-u` | Target URL. Place `FUZZ` where you want wordlist substitution |
| `-w` | Wordlist path (use `-w wordlist.txt:FUZZ2` for named keywords) |
| `-t` | Number of concurrent threads (keep low for local targets: 5–10) |
| `-rate` | Max requests per second |
| `-s` | Silent mode — output matched results only, no banner |
| `-mc` | Match HTTP status codes (e.g. `-mc 200,201,401,403,405`) |
| `-fc` | Filter out status codes |
| `-fs` | Filter by response size in bytes (critical for SPAs with static fallback pages) |
| `-fw` | Filter by word count in response |
| `-fl` | Filter by line count in response |
| `-fr` | Filter by regex match in response body |
| `-e` | Append extensions to each word (e.g. `-e .php,.html,.js`) |
| `-H` | Custom header (e.g. `-H "Authorization: Bearer token"`) |
| `-X` | HTTP method (default GET; use POST, PUT, etc.) |
| `-d` | POST body data |
| `-recursion` | Enable recursive fuzzing on found directories |
| `-recursion-depth` | Max recursion depth |
| `-ac` | Auto-calibrate filters based on a few initial responses |
| `-o` | Output file |
| `-of` | Output format: `json`, `csv`, `html`, `md` |
| `-timeout` | Per-request timeout in seconds |

### Examples

```bash
# Directory fuzzing — filter SPA fallback size
ffuf -u {target_url}/FUZZ -w ~/wordlists/raft-small-directories.txt -fs 75002 -t 5 -rate 20 -s

# API endpoint fuzzing — match meaningful status codes only
ffuf -u {target_url}/api/FUZZ -w ~/wordlists/raft-small-directories.txt -fs 75002 -mc 200,201,401,405 -t 5 -rate 20 -s

# Extension fuzzing for config/backup files
ffuf -u {target_url}/FUZZ -w ~/wordlists/raft-small-words.txt -e .bak,.conf,.env,.json,.old -fs 75002 -s

# POST body parameter fuzzing
ffuf -u {target_url}/login -X POST -d "username=admin&password=FUZZ" -w ~/wordlists/passwords.txt -mc 302

# Pipe results into httpx for enrichment
ffuf -u {target_url}/FUZZ -w ~/wordlists/raft-small-directories.txt -fs 75002 -s | httpx -silent -title -status-code -tech-detect

# Virtual host fuzzing
ffuf -u {target_url} -H "Host: FUZZ.target.com" -w ~/wordlists/subdomains.txt -fs 0 -s
```

---

## httpx — HTTP Toolkit & Prober

**Purpose:** Probe a list of URLs/hosts for liveness, extract metadata (status code, title,
tech stack, content length, headers), and enrich piped input from other tools.
Best used as a downstream enrichment stage in a pipeline.

### Core Flags

| Flag | Description |
|---|---|
| `-u` | Single target URL |
| `-l` | Input from file (avoid in pipes — use stdin instead) |
| `-silent` | Suppress banner, only print results |
| `-status-code` / `-sc` | Print HTTP status code |
| `-title` | Print page title |
| `-tech-detect` / `-td` | Detect tech stack via Wappalyzer signatures |
| `-content-length` / `-cl` | Print response content length |
| `-location` | Print redirect location |
| `-follow-redirects` / `-fr` | Follow HTTP redirects |
| `-mc` | Match status codes |
| `-fc` | Filter status codes |
| `-ms` | Match response size |
| `-fs` | Filter response size |
| `-H` | Custom header |
| `-method` | HTTP method |
| `-body-preview` | Print first N chars of body |
| `-screenshot` | Take screenshot of page (requires Chrome) |
| `-favicon` | Extract favicon hash (useful for Shodan pivots) |
| `-probe` | Show SUCCESS/FAILED probe status |
| `-o` | Output file |
| `-json` | Output as JSON Lines |
| `-threads` / `-t` | Concurrency |
| `-timeout` | Request timeout in seconds |

### Examples

```bash
# Probe a single URL with full metadata
httpx -u {target_url} -title -tech-detect -status-code -silent

# Enrich piped URLs from another tool
cat urls.txt | httpx -silent -title -status-code -tech-detect

# Pipe from ffuf for instant enrichment
ffuf -u {target_url}/FUZZ -w wordlist.txt -fs 75002 -s | httpx -silent -title -status-code

# Quick liveness check across a list
httpx -l hosts.txt -silent -probe

# Extract content-length + title for comparison
httpx -u {target_url} -cl -title -silent

# Follow redirects and show final destination
httpx -u {target_url} -follow-redirects -location -silent
```

---

## katana — Next-Gen Web Crawler

**Purpose:** Crawl a web application to discover all reachable URLs, endpoints, and JS-embedded
routes. Supports headless JS rendering for SPAs and automatically parses JavaScript files for
hidden endpoints. The best tool for mapping what's actually linked/reachable.

### Core Flags

| Flag | Description |
|---|---|
| `-u` | Target URL to crawl |
| `-d` | Max crawl depth (default 3) |
| `-jc` / `-js-crawl` | Parse JS files for embedded endpoints |
| `-jsl` / `-jsluice` | Use jsluice for deeper JS secret/endpoint extraction (memory-heavy) |
| `-kf` / `-known-files` | Crawl known files: `all`, `robotstxt`, `sitemapxml` |
| `-hl` / `-headless` | Enable headless Chrome crawling (for JS-heavy SPAs) |
| `-silent` | Suppress banner, output URLs only |
| `-c` | Concurrent fetchers (default 10) |
| `-rl` | Rate limit — requests per second (default 150) |
| `-timeout` | Request timeout seconds (default 10) |
| `-proxy` | HTTP/SOCKS5 proxy |
| `-H` | Custom headers |
| `-cs` | Crawl scope regex (stay in scope) |
| `-em` | Extension match filter (e.g. `-em js,php`) |
| `-ef` | Extension filter (exclude e.g. `-ef png,css,jpg`) |
| `-f` | Output field: `url`, `path`, `fqdn`, `file`, `kv` (key-value pairs) |
| `-o` | Output file |
| `-j` / `-jsonl` | JSON Lines output |
| `-xhr` | Extract XHR request URLs |
| `-aff` | Auto form fill (experimental) |

### Examples

```bash
# Standard crawl with JS parsing and known-file discovery
katana -u {target_url} -jc -kf all -silent

# Pipe discovered URLs into httpx for enrichment
katana -u {target_url} -jc -kf all -silent | httpx -silent -title -tech-detect -status-code

# Headless crawl for JS-rendered SPA (React/Angular/Vue)
katana -u {target_url} -hl -jc -silent

# Deep JS secret extraction with jsluice
katana -u {target_url} -jsl -silent

# Extract only JS files
katana -u {target_url} -jc -silent -em js

# Crawl with custom headers (e.g. authenticated session)
katana -u {target_url} -H "Cookie: session=abc123" -jc -silent

# Extract XHR endpoints made by the app
katana -u {target_url} -xhr -silent
```

---

## nmap — Network Port Scanner

**Purpose:** Discover open ports and running services on a host. Useful as the first step
before web enumeration to understand what's exposed. Script scanning (`--script`) adds
service fingerprinting, banner grabbing, and HTTP metadata extraction.

### Core Flags

| Flag | Description |
|---|---|
| `-p` | Port range or list (e.g. `-p 80,443,8080` or `-p 1-65535`) |
| `-sV` | Service/version detection |
| `-sC` | Run default NSE scripts |
| `-sS` | SYN scan (stealth, requires root) |
| `-sT` | TCP connect scan (no root needed) |
| `-A` | Aggressive: OS detect + version + scripts + traceroute |
| `-T<0-5>` | Timing template (T3 default; T4 faster; T5 aggressive) |
| `--script` | Run specific NSE scripts (e.g. `--script http-title,banner`) |
| `-oN` | Normal output to file |
| `-oX` | XML output |
| `-oG` | Grepable output |
| `--open` | Show only open ports |
| `-Pn` | Skip host discovery (treat host as up) |
| `-n` | No DNS resolution (faster) |

### Useful NSE Scripts for Web Recon

| Script | What it finds |
|---|---|
| `http-title` | Page title of HTTP services |
| `banner` | Raw service banner |
| `http-headers` | HTTP response headers |
| `http-methods` | Allowed HTTP methods |
| `http-robots.txt` | Robots.txt contents |
| `http-auth-finder` | Auth mechanisms used |

### Examples

```bash
# Fast scan of common web/app ports
nmap -p 22,80,443,3000,3001,5000,8080,8443,9090 --script http-title,banner 127.0.0.1

# Full service version detection on web ports
nmap -sV -p 80,443,8080,8443,3000 127.0.0.1

# Aggressive scan with OS detection
nmap -A -p 1-10000 --open 127.0.0.1

# Script scan for HTTP info on a specific port
nmap -p 3000 --script http-title,http-headers,http-methods 127.0.0.1
```

---

## curl — HTTP Request Tool

**Purpose:** Make precise, targeted HTTP requests to specific endpoints. Best for quick
manual probing of known/suspected endpoints, inspecting headers, testing authentication,
and validating findings from other tools.

### Core Flags

| Flag | Description |
|---|---|
| `-s` | Silent — suppress progress meter |
| `-I` / `--head` | Fetch headers only (HEAD request) |
| `-i` | Include response headers in output |
| `-L` | Follow redirects |
| `-X` | HTTP method (GET, POST, PUT, DELETE, PATCH) |
| `-d` | POST/PUT body data |
| `-H` | Custom header (e.g. `-H "Content-Type: application/json"`) |
| `-b` | Cookie string |
| `-u` | Basic auth (user:pass) |
| `-o` | Write output to file |
| `-w` | Format string for metadata (e.g. `-w "%{http_code}"`) |
| `-k` | Skip TLS verification |
| `--max-time` | Timeout in seconds |
| `-v` | Verbose — show full request/response |

### Examples

```bash
# Fetch response headers only
curl -sI {target_url}

# Probe a REST endpoint
curl -s {target_url}/api/Users
curl -s {target_url}/api/Products
curl -s {target_url}/rest/user/whoami

# Check FTP directory listing
curl -s {target_url}/ftp/

# Probe common meta-endpoints
curl -s {target_url}/robots.txt
curl -s {target_url}/metrics
curl -s {target_url}/.well-known/security.txt
curl -s {target_url}/api/Challenges

# POST JSON body
curl -s -X POST {target_url}/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'

# Show HTTP status code only
curl -s -o /dev/null -w "%{http_code}" {target_url}/admin
```

---

## whatweb — Web Technology Fingerprinter

**Purpose:** Identify the tech stack of a web application — framework, server, CMS, JS libraries,
analytics tools, and more. Covers 1800+ signatures. Higher aggression levels (`-a 3`) send more
requests to increase detection accuracy.

### Core Flags

| Flag | Description |
|---|---|
| `-a <1-4>` | Aggression level: 1=stealthy, 3=aggressive (recommended), 4=heavy |
| `-v` | Verbose output — show all detected plugins with detail |
| `--log-json` | Output as JSON to a file |
| `--log-xml` | Output as XML |
| `-t` | Number of concurrent threads |
| `--proxy` | HTTP proxy |
| `--user-agent` | Custom User-Agent |
| `-U` | Read targets from file |
| `--colour=never` | Disable colored output (useful for piping) |

### Examples

```bash
# Standard fingerprinting
whatweb {target_url} -a 3 -v

# Quiet output for scripting
whatweb {target_url} -a 3 --colour=never

# JSON output for later parsing
whatweb {target_url} -a 3 --log-json=whatweb-results.json

# Multi-threaded against multiple targets
whatweb -U targets.txt -a 3 -t 5
```

---

## gau — Get All URLs (Wayback Machine / Passive Discovery)

**Purpose:** Fetch historically known URLs for a domain from passive sources: Wayback Machine,
Common Crawl, OTX, URLScan. Finds endpoints that may no longer be linked but still exist,
old API versions, leaked paths, and backup files — without sending a single request to the target.

### Core Flags

| Flag | Description |
|---|---|
| `--subs` | Include subdomains |
| `--providers` | Specify sources: `wayback`, `commoncrawl`, `otx`, `urlscan` |
| `--mc` | Match status codes (from URLScan data) |
| `--fc` | Filter status codes |
| `--ft` | Filter by MIME type |
| `--blacklist` | Exclude extensions (e.g. `--blacklist png,jpg,css`) |
| `--threads` | Number of concurrent threads |
| `--retries` | Retry count for failed requests |
| `--json` | JSON output |
| `--o` | Output file |
| `2>/dev/null` | Suppress error output (recommended for clean piping) |

### Examples

```bash
# Fetch all historical URLs and probe live ones
gau {target_host} 2>/dev/null | httpx -silent -status-code -title

# Filter out static assets for cleaner output
gau {target_host} 2>/dev/null --blacklist png,jpg,gif,css,woff | httpx -silent

# Include subdomains
gau {target_host} --subs 2>/dev/null | httpx -silent

# Only use specific sources
gau {target_host} --providers wayback,urlscan 2>/dev/null | httpx -silent

# Save raw URLs to file for analysis
gau {target_host} 2>/dev/null -o gau-urls.txt
```
