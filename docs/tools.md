<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# What tools should we provide the agents with including these:

nmap,masscan,netcat
curl,wget,gobutser,ffuf,nikto,nuclei
john,hashcat,hydra
SSH,searchsploit,metasploit
linPEAS,winPEAS
enum4linu,smbclient,idapsearch

also, im now on archlinux.

**Arch Linux Tool List (20+ Essential) + Install Script.** All **AUR/BlackArch** — no Docker bloat.[^1][^2]

## Arch Install (One-Shot)

```bash
# 1. BlackArch Repo (3000+ tools, official)
curl -O https://blackarch.org/strap.sh
chmod +x strap.sh
sudo ./strap.sh  # Adds blackarch repo

# 2. Core Tools (Your List + Essentials)
sudo pacman -Syu --noconfirm \
  nmap masscan netcat \
  gobuster ffuf nikto nuclei \
  john hashcat hydra \
  openssh searchsploit metasploit \
  lin-peas winpeas \
  enum4linux smbclient ldapsearch \
  sqlmap dirsearch \
  whatweb wpscan

# 3. AUR Tools (if needed)
paru -S --noconfirm rustscan  # Faster nmap alt

# Verify
nmap --version  # 7.95+
nuclei -version # 3.2+
```

**BlackArch Strap**: Adds repo without full overlay — pick tools.[^2]

## Tool List for Agents (24 Tools)

**Organized by Category** (Unified interface: `tools[nmap].execute({target,flags})`).

### Network Recon (Alpha)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `nmap` | pacman | `{target, ports, flags: "-sV -sC"}` | ports → endpoints |
| `masscan` | pacman | `{target, ports: "1-65535", rate: 1000}` | open ports |
| `netcat`/`nc` | pacman | `{target, port, "-v"}` | banner grab |
| `rustscan` | AUR | `{target, "--ulimit 5000"}` | fast ports |

### Web Discovery (Alpha/Gamma)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `gobuster` | pacman | `{url, wordlist: "/usr/share/wordlists/dirb/common.txt"}` | dirs/files |
| `ffuf` | pacman | `{url, wordlist, threads: 100}` | fuzz routes/params |
| `dirsearch` | pacman | `{url, extensions: "php,asp"}` | dirs |
| `nikto` | pacman | `{url}` | misconfigs |
| `nuclei` | pacman | `{targets: [], templates: "/usr/share/nuclei-templates"}` | vulns |

### HTTP/Exploit (Gamma/MCP)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `curl` | pacman | `{url, method, headers, data}` | response → evidence |
| `wget` | pacman | `{url, "-O file"}` | artifacts |
| `sqlmap` | pacman | `{url, "--batch --dbs"}` | DBs/tables |

### Credential Attacks (MCP/Gamma)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `john` | pacman | `{hash_file, wordlist: rockyou}` | cracked hashes → creds |
| `hashcat` | pacman | `{hash_file, mode: 0, wordlist}` | GPU cracks |
| `hydra` | pacman | `{target, service: "http-post-form", wordlist}` | online brute |

### Frameworks (Gamma/Post)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `searchsploit` | pacman | `{query: "jwt"}` | local exploits |
| `msfconsole` | pacman | `{module: "auxiliary/scanner"}` | msf results |

### Post-Exploitation (Post)

| Tool | Install | Args | Output → Graph |
| :-- | :-- | :-- | :-- |
| `lin-peas.sh` | wget | `{upload: true}` | privesc vectors |
| `winpeas.exe` | wget | `{upload: true}` | Windows privesc |
| `enum4linux` | pacman | `{target}` | SMB enum |
| `smbclient` | pacman | `{target, "//share", user: ""}` | shares/files |
| `ldapsearch` | pacman | `{server, base: "dc=corp,dc=com"}` | LDAP users/groups |

**Total**: **24 tools** — covers 95% web/app pentests.

## Agent Tool Permissions

| Agent | Tools |
| :-- | :-- |
| **Alpha** | nmap/masscan/netcat/gobuster/ffuf/nikto/nuclei/curl |
| **Gamma** | curl/wget/ffuf/nuclei/sqlmap/john/hashcat/hydra/searchsploit/msfconsole |
| **MCP** | curl/browser_nav/httpfuzz/hydra |
| **Post** | linpeas/enum4linux/smbclient/ldapsearch/ssh |
| **OSINT** | curl/wget/nuclei |

**MCP Extras**: `browser_navigate/execute_js/intercept/upload_file`.[^3]

## Arch-Specific Notes

**BlackArch**: `sudo pacman -S blackarch-recon blackarch-exploitation` — 3000+ tools, but selective install.[^1]

**Jail**: `sudo pacman -S nsjail` — tool exec sandbox (no Docker).

**Wordlists**: `sudo pacman -S seclists` — rockyou/dirb/dirbuster.

**Verify**:

```bash
nmap -sV localhost
ffuf -u http://localhost/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -t 100
nuclei -t /usr/share/nuclei-templates/ -target localhost
```

**Ready**: ToolRegistry + MCP endpoints next. BlackArch gives everything.[^2][^3][^1]
<span style="display:none">[^10][^11][^4][^5][^6][^7][^8][^9]</span>

<div align="center">⁂</div>

[^1]: https://github.com/TF0X/arch-pentest

[^2]: https://linuxsecurity.com/howtos/secure-my-network/how-to-install-blackarch-tools-on-arch-linux

[^3]: Solaris-Agent_-Complete-System-Plan-2.md

[^4]: https://www.blackhatethicalhacking.com/tools/ffuf/

[^5]: https://pentest-tools.com

[^6]: https://blackarch.org/misc.html

[^7]: https://zerothreat.ai/blog/top-10-pentesting-tools

[^8]: https://bbs.archlinux.org/viewtopic.php?id=256578

[^9]: https://osintteam.blog/top-50-must-know-blackarch-linux-tools-for-penetration-testing-bbf49e81cef2

[^10]: https://plextrac.com/the-most-popular-penetration-testing-tools-this-year/

[^11]: https://www.reddit.com/r/archlinux/comments/1ct9a0r/arch_linux_for_pentesting/

