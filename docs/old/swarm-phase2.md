Here's the complete, consolidated list of all proposed enhancements for your Swarm architecture, merging the initial brainstorm with MCP + hacking knowledge upgrades. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

## Core Targeting Upgrades

- **Web crawling agent**: Builds site maps, discovers forms/APIs, classifies into OWASP categories (headless browser tools in sandbox). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Dynamic API discovery**: Parses JS/network for endpoints/schemas, generates pseudo-OpenAPI for blackboard. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Auth agent**: Detects/attacks login flows, stores cookies/JWTs for global chaining. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Target metadata/OSINT**: WHOIS, TLS, headers, stack fingerprinting (Wappalyzer-style). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

## Agent Training & Specialization

- **Pattern libraries/playbooks**: YAML for bug classes (payloads, fingerprints, bypasses). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Synthetic lab missions**: Juice Shop/DVWA runs to log misses, refine prompts/heursitics. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Vector memory/prior cases**: Qdrant snippets by stack/vuln for strategy reuse. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Coach agent**: Analyzes failures in labs, rewrites strategies/prompts. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Hacking knowledge RAG**: Vector store with OWASP cheats, HackTricks, PayloadsAllTheThings; `hack_docs_retrieve` tool. [oligo](https://www.oligo.security/academy/owasp-top-10-cheat-sheet-of-cheat-sheets)
- **Per-agent doc injection**: Prefix prompts with recon/OSINT cheats for Alpha, Top 10 bypasses for Gamma. [scribd](https://www.scribd.com/document/945732287/Tactical-OSINT-For-Pentesters-OSINT)

## Research & Intel

- **Intel/OSINT agent**: CVE/NVD/Exploit-DB lookups on discovered versions, PoC synthesis. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Stack-tailored recon**: Framework-specific dirs/endpoints, nuclei/ffuf wordlists. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Bounty policy agent**: Scrapes VDP scopes/limits, constrains Commander tasks. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

## Tooling & Sandbox Evolution

- **Tool-building pipeline**: Engineer agent writes Python tools to `generated/`, auto-registers. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Iterative refinement**: Stats-based, Refiner agent edits underperformers (HITL-gated). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Mission-local workspace**: `/workspace/{id}` for scripts/wordlists/flows (`file_*` tools). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Exploit module promotion**: Successful generated tools -> core with metadata. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **MCP tool adapters**: LangChain MCP integration for dynamic discovery/chaining (HexStrike pentest servers). [changelog.langchain](https://changelog.langchain.com/announcements/mcp-adapters-for-langchain-and-langgraph)

## New Agent Roles

| Agent | Role |
|-------|------|
| Crawler | Site mapping/forms/APIs |
| Auth | Login/session attacks |
| Intel/OSINT | CVE/research synthesis |
| Engineer | Tool/script creation |
| Refiner | Tool improvement |
| Coach | Lab training feedback |
| Legal/Policy | VDP/policy enforcement |
| Report Optimizer | Bounty-formatted PoCs |

## Bounty/White-Hat Features

- **Program-aware planning**: Input VDP URL, optimize for scope/rewards. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **POC/report templates**: HackerOne/Intigriti formats, curl repro steps. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Compliance gate**: Authorization proof required, blocks destructive/off-scope. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **ROI prioritization**: Favors high-impact (ATO/RCE) over low. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

## Control Flow & Modes

- **Budgets/timeboxes**: State fields for cost/time-aware `should_continue`. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Modes**: Quick recon, deep exploit, report-only. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Multi-target campaigns**: Parallel assets, intel reuse. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Vector rotation enforcement**: OWASP diversity tracking. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

## UX & Ecosystem

- **Dashboard upgrades**: Timeline, agent thoughts, coverage viz. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **Plugin marketplace**: SDK for user tools/recon modules. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)
- **API extensions**: Campaign endpoints, MCP config. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/persistent-attachments/74539847/ae5e4cfb-ee59-4f5b-891a-885c293f2bfc/SWARM_ARCHITECTURE.md)

This gives you a roadmap from MVP polish to full bounty platform—about 20-25 features, prioritized by dependency (start with targeting + MCP/RAG). [changelog.langchain](https://changelog.langchain.com/announcements/mcp-adapters-for-langchain-and-langgraph)

What's your top 3 to prototype next?