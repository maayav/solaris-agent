# Wordlists

Structured wordlists for the Solaris-Agent swarm. Symlinked from external repos to avoid duplication.

## Setup

```bash
# Clone external repos
cd payloads
git clone --depth 1 https://github.com/danielmiessler/SecLists.git
git clone --depth 1 https://github.com/swisskyrepo/PayloadsAllTheThings.git
```

## Structure

```
wordlists/
├── INDEX.json              # Auto-generated index
├── README.md
│
├── recon/                  # Directory/file/subdomain discovery
│   ├── directories/
│   │   ├── raft-large-directories.txt   # 62K dirs
│   │   ├── raft-medium-directories.txt  # 30K dirs
│   │   └── raft-small-directories.txt   # 20K dirs
│   ├── files/
│   │   ├── raft-large-files.txt        # 37K files
│   │   └── raft-medium-files.txt       # 17K files
│   └── subdomains/
│       └── subdomains-top1mil.txt      # 653K subdomains
│
├── exploit/                # Exploit payloads
│   └── command_injection/
│       └── command-injection-commix.txt  # 8K payloads
│
└── fuzzing/               # General fuzzing
    └── naughty_strings.txt  # 699 fuzz strings
```

## Rebuild Index

```bash
bun run scripts/build-wordlist-index.ts
```

## Usage

```typescript
import { loadWordlistIndex, findWordlist } from '../src/utils/wordlist-index';

const index = loadWordlistIndex();
const wordlist = findWordlist('recon', 'raft-small-directories');
// wordlist.path -> 'recon/directories/raft-small-directories.txt'
```

## Sources

- **SecLists** - https://github.com/danielmiessler/SecLists
- **PayloadsAllTheThings** - https://github.com/swisskyrepo/PayloadsAllTheThings
