$ pkill -f "bun run src/e2e-test" 2>/dev/null; sleep 1; ls -la ~/recon-reports/mission:alpha-1775647021384-g6ayah/

$ cd /run/media/peburu/BIG\ DRIVE/Backup/Projects/Prawin/solaris/solaris-agent/agent-swarm && rm -f ./solaris-events.db && ALPHA_LLM_PLANNING=true timeout 180 npx bun run src/e2e-test.ts 2>&1
$ ls -la ~/recon-reports/ | tail -5


**SecLists** is the definitive source — install the whole thing and you get everything you need: [github](https://github.com/danielmiessler/seclists)

```bash
# Install full SecLists
sudo pacman -S seclists
# or clone directly
git clone https://github.com/danielmiessler/SecLists /home/peburu/wordlists/seclists
```

## Most useful lists for Juice Shop specifically

| Wordlist | Path (after install) | Use for |
|---|---|---|
| `common-api-endpoints-mazen160.txt` | `SecLists/Discovery/Web-Content/` | REST API endpoint fuzzing |
| `api-seen-in-wild.txt` | `SecLists/Discovery/Web-Content/api/` | Real-world API names like `users`, `orders`, `checkout`  [git.selfmade](https://git.selfmade.ninja/zer0sec/SecLists/-/tree/eee1651de7906112719066540ca2c5bf688cf9f2/Discovery/Web-Content/api) |
| `api_wordlist` | `SecLists/Discovery/Web-Content/api/` | General API discovery |
| `common.txt` | `SecLists/Discovery/Web-Content/` | Generic directory brute force |
| `CommonBackdoors-PHP.fuzz.txt` | `SecLists/Discovery/Web-Content/` | Hidden files, config leaks |

## For Juice Shop's specific vuln categories

```bash
# SQL injection payloads (for /rest/user/login)
SecLists/Fuzzing/SQLi/Generic-SQLi.txt

# XSS payloads
SecLists/Fuzzing/XSS/XSS-Jhaddix.txt

# Default credentials (admin panel)
SecLists/Passwords/Default-Credentials/default-passwords.csv
```

## Kiterunner — better than ffuf for APIs

Also worth installing — it's purpose-built for API route discovery and uses real-world API schema wordlists: [pentest-book](https://www.pentest-book.com/enumeration/webservices/apis)

```bash
# AUR
yay -S kiterunner-bin

# Usage
kr scan http://127.0.0.1:3000 -w routes-small.kite
```

It understands REST patterns like `/api/v1/users/{id}` natively, which ffuf can't do without manual configuration.
