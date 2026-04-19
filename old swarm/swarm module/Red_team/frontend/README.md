# Red Team Agent Swarm - Frontend

A simple demo frontend for the Red Team Agent Swarm system, built with Next.js and Tailwind CSS.

## Features

- **Mission Control Dashboard**: Start and monitor security assessment missions
- **Multi-Agent Visualization**: See which agent is currently active (Commander, Alpha Recon, Gamma Exploit)
- **Real-time Progress**: Track mission phases and progress
- **Vulnerability Display**: View discovered vulnerabilities with severity ratings
- **Chat-like Interface**: Interact with the agent swarm conversationally

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Backend API running on `http://localhost:8000`

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Project Structure

```
frontend/
âââ public/
âââââ favicon.svg
âââ src/
âââââ app/
ââââââââââ globals.css
ââââââââââ layout.tsx
ââââââââââ page.tsx
âââââ components/
ââââââââââ ChatInput.tsx
ââââââââââ ChatMessage.tsx
ââââââââââ MissionProgress.tsx
ââââââââââ Sidebar.tsx
ââââââââââ WelcomeScreen.tsx
âââââ hooks/
ââââââââââ useMission.ts
âââââ lib/
ââââââââââ api.ts
ââââââââââ utils.ts
âââââ types/
ââââââââââ index.ts
âââ next.config.js
âââ package.json
âââ postcss.config.js
âââ tailwind.config.ts
âââ tsconfig.json
```

## UI Design

The UI is adapted from the `frontend_demo/dashboard` design with a ChatGPT-like dark theme:

- **Dark color scheme** with accent colors for different severity levels
- **Responsive sidebar** for mission history
- **Progress visualization** for mission phases
- **Markdown rendering** for messages with syntax highlighting

## API Integration

The frontend expects the following API endpoints:

- `GET /health` - Health check
- `POST /api/mission/start` - Start a new mission
- `GET /api/mission/{id}/status` - Get mission status
- `GET /api/mission/{id}/report` - Get mission report
- `GET /api/mission/{id}/messages` - Get agent messages
- `POST /api/mission/{id}/approve/{action}` - Approve an action (HITL)
- `POST /api/mission/{id}/cancel` - Cancel mission

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## License

MIT