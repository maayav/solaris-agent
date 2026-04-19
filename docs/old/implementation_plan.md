# Migrate Chat Page & Dashboard Page from gman-updates

Copy the updated Chat and Dashboard pages from `solaris-agent-gman-updates/` into the main `frontend/` codebase, along with all supporting components, libraries, and configuration.

## User Review Required

> [!IMPORTANT]
> The [App.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/App.tsx) will be replaced with a React Router version (lazy loading, URL-based navigation). This changes how navigation works throughout the app — from `useState`-based to URL-based routing.

> [!IMPORTANT]
> The new TeamChat requires **Supabase** for chat persistence and realtime updates. The [.env](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/.env) file needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured.

> [!WARNING]
> The [sendChatMessage](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts#472-478) function signature in [api.ts](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts) differs between the two codebases. The gman-updates version uses a simpler [(message, agent, team)](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/components/TeamChatMessage.tsx#210-213) signature, while the main codebase uses `{messages: ChatMessage[]}`. The new TeamChat page **bypasses the api helper entirely** — it does a direct [fetch()](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts#63-96) to `/chat/stream`. I will add the simpler [sendChatMessage](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts#472-478) from gman-updates as an additional export to the main [api.ts](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts) without removing the existing one.

## Proposed Changes

### Dependencies & Config

#### [MODIFY] [package.json](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/package.json)
Add missing packages:
- `@supabase/supabase-js` — chat persistence
- `react-router-dom` + `@types/react-router-dom` — URL routing
- `react-markdown` — markdown rendering in chat messages

#### [MODIFY] [index.html](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/index.html)
Copy the `<head>` font preloads and Syne font from gman-updates version.

---

### Infrastructure — Routing & Styling

#### [MODIFY] [main.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/main.tsx)
Wrap `<App />` in `<BrowserRouter>` for React Router.

#### [MODIFY] [App.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/App.tsx)
Replace with gman-updates version — uses `react-router-dom` `Routes`/`Route`, lazy-loaded pages, Suspense skeleton, tubelight navbar, ErrorBoundary.

#### [MODIFY] [index.css](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/index.css)
Replace with gman-updates version adding animation keyframes (`glow-pulse`, `glow-breathe`, `pulse-glow`), fluid typography utilities, and reduced-motion media query.

---

### Libraries

#### [NEW] [supabase.ts](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/supabase.ts)
Copy from gman-updates — Supabase client init + [ChatMessageFromDB](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/lib/supabase.ts#13-21) and [Conversation](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/lib/supabase.ts#23-29) types.

#### [MODIFY] [api.ts](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts)
Add the simpler [sendChatMessage(message, agent, team)](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts#472-478) function from gman-updates as an additional named export. Keep existing Chat API functions intact.

---

### Components

#### [NEW] [ErrorBoundary.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ErrorBoundary.tsx)
Copy from gman-updates — React error boundary with retry button.

#### [NEW] [TeamChatMessage.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/TeamChatMessage.tsx)
Copy from gman-updates — message component with thinking/response parsing, markdown rendering, streaming support.

---

### UI Components (all new/updated)

#### [NEW] [number-ticker.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/number-ticker.tsx)
#### [NEW] [animated-beam.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/animated-beam.tsx)
#### [NEW] [hash-scramble-text.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/hash-scramble-text.tsx)
#### [NEW] [magnetic-button.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/magnetic-button.tsx)
#### [NEW] [pulsating-button.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/pulsating-button.tsx)
#### [MODIFY] [tubelight-navbar.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/tubelight-navbar.tsx)
#### [MODIFY] [Card.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/components/ui/Card.tsx)

All copied/replaced from gman-updates versions.

---

### Pages

#### [MODIFY] [Dashboard.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/Dashboard.tsx)
Replace with gman-updates version — real API data, severity charts, animated metrics.

The Dashboard imports [listScans](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/lib/api.ts#73-82) and [getScanResults](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/lib/api.ts#83-90) from `./lib/api`. These already exist in the main [api.ts](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts) but have slightly different signatures ([listScans](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/solaris-agent-gman-updates/solaris-agent/frontend/src/lib/api.ts#73-82) in main returns [ScanListResponse](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/lib/api.ts#438-449) with `.scans` array; gman-updates returns `Scan[]` directly). I'll adapt the Dashboard to work with the main codebase's existing API functions.

#### [MODIFY] [TeamChat.tsx](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/frontend/src/pages/TeamChat.tsx)
Replace with gman-updates version — Supabase-backed conversations, streaming, sidebar, team switching, stop/abort.

---

## Backend

No backend changes needed — the `/chat/` and `/chat/stream` endpoints already exist in [vibecheck/api/routes/chat.py](file:///d:/Backup/Projects/Prawin/solaris/solaris-agent/vibecheck/api/routes/chat.py).

## Verification Plan

### Automated Tests
- Run `npm run lint` (tsc --noEmit) in `frontend/` to verify TypeScript compiles without errors

### Manual Verification
1. Run `npm run dev` in `frontend/` and open `http://localhost:3000`
2. Verify the app loads with the tubelight navbar
3. Click "Dashboard" — should load dashboard with metrics
4. Click "Team Chat" — should load the chat interface with sidebar
5. Verify team switching (Red ↔ Blue) works in chat
