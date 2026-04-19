# VibeCheck Dashboard

A modern, ChatGPT-style frontend for the VibeCheck security analysis platform.

## Features

- 🎨 **Modern UI**: Clean, dark-themed interface inspired by ChatGPT/Perplexity
- 🔗 **GitHub Integration**: Paste any GitHub repository URL to analyze
- 📊 **Real-time Progress**: Live scan progress with step-by-step updates
- 🛡️ **Vulnerability Display**: Rich vulnerability cards with severity indicators
- 💬 **AI Chat**: Discuss scan results with an AI assistant
- 📱 **Responsive**: Works on desktop and mobile devices

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Markdown**: react-markdown with syntax highlighting
- **Language**: TypeScript

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Backend API running (see main project README)

### Installation

```bash
# Navigate to dashboard directory
cd vibecheck/dashboard

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit .env.local if needed (default should work for local development)
```

### Development

```bash
# Start development server
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm run start
```

## Project Structure

```
dashboard/
├── src/
│   ├── app/
│   │   ├── globals.css    # Global styles
│   │   ├── layout.tsx     # Root layout
│   │   └── page.tsx       # Main page
│   ├── components/
│   │   ├── ChatInput.tsx  # Message input component
│   │   ├── ChatMessage.tsx# Chat message display
│   │   ├── ScanProgress.tsx# Scan progress indicator
│   │   ├── Sidebar.tsx    # Navigation sidebar
│   │   └── WelcomeScreen.tsx# Initial welcome view
│   ├── hooks/
│   │   └── useScan.ts     # Scan state management
│   ├── lib/
│   │   ├── api.ts         # API client
│   │   └── utils.ts       # Utility functions
│   └── types/
│       └── index.ts       # TypeScript types
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## API Integration

The dashboard connects to the FastAPI backend at `http://localhost:8000` by default. Key endpoints:

- `POST /scan/trigger` - Start a new scan
- `GET /scan/{id}/status` - Get scan status
- `GET /report/{id}` - Get scan report
- `GET /report/{id}/vulnerabilities` - List vulnerabilities
- `POST /chat` - Chat with AI assistant

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:8000` |

## Customization

### Theming

Colors can be customized in `tailwind.config.ts`:

```typescript
colors: {
  dark: { ... },      // Background colors
  accent: { ... },    // Primary accent (green)
  vuln: { ... },      // Vulnerability severity colors
}
```

### Adding New Features

1. **New API endpoints**: Add to `src/lib/api.ts`
2. **New components**: Create in `src/components/`
3. **New hooks**: Create in `src/hooks/`
4. **New types**: Add to `src/types/index.ts`

## License

Part of the VibeCheck project.
