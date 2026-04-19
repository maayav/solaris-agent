# Swarm Refactored

TypeScript implementation of the Red Team Swarm agent system.

## Features

- **Commander Agent** - Strategic planning and observation
- **Alpha Recon Agent** - Reconnaissance and intelligence gathering
- **Gamma Exploit Agent** - Exploitation with token chaining
- **Critic Agent** - Deterministic exploit evaluation

## Architecture

See [SWARM_BEHAVIORAL_SPEC.md](../SWARM_BEHAVIORAL_SPEC.md) for full specification.

## ⚠️ Skipped Features

| Feature | Spec Section | Status |
|---------|--------------|--------|
| HITL Approval Gate | 3.5 | ⏸️ Skipped - Requires UI integration |
| PentAGI Reflection Loop | 7 | ⏸️ Skipped - Can be added later |

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

```bash
# LLM Models
COMMANDER_MODEL=google/gemini-2.0-flash-exp:free
COMMANDER_MODEL_FALLBACK=qwen2.5-coder:7b-instruct
RECON_MODEL=qwen2.5-coder:7b-instruct
EXPLOIT_MODEL=google/gemini-2.0-flash-exp:free
CRITIC_MODEL=qwen2.5-coder:7b-instruct

# API Keys
OPENROUTER_API_KEY=sk-or-v1-...

# Redis
REDIS_URL=redis://localhost:6379/0

# Target
TARGET_URL=http://localhost:3000
FAST_MODE=false
```

## Project Structure

```
swarm-refactored/
├── src/
│   ├── types/
│   │   └── index.ts          # All shared enums and types
│   ├── agents/
│   │   ├── schemas.ts        # Zod validation schemas
│   │   ├── commander.ts     # Commander agent
│   │   ├── alpha-recon.ts    # Alpha Recon agent
│   │   ├── gamma-exploit.ts  # Gamma Exploit agent
│   │   └── critic-agent.ts   # Critic agent
│   ├── core/
│   │   ├── state.ts          # RedTeamState management
│   │   ├── redis-bus.ts      # Redis operations
│   │   └── llm-client.ts     # LLM client with cascade
│   ├── graph/
│   │   └── state-machine.ts  # LangGraph state machine
│   └── index.ts              # Main entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Scripts

- `npm run build` - Compile TypeScript
- `npm run dev` - Run with tsx watch
- `npm run test` - Run vitest tests
- `npm run lint` - Run ESLint
