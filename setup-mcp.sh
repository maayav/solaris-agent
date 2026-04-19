#!/bin/bash
# OpenCode MCP Setup - OPTIMIZED v9.7 (16 enabled)
# chmod +x setup-mcp.sh && ./setup-mcp.sh

echo "📦 Checking and installing npm packages..."
export PUPPETEER_SKIP_DOWNLOAD=true

install_if_missing() {
  local pkg=$1
  if npm list -g "$pkg" --depth=0 &>/dev/null; then
    echo "  ✓ $pkg already installed, skipping"
  else
    echo "  ↓ Installing $pkg..."
    npm install -g "$pkg"
  fi
}

install_if_missing "@modelcontextprotocol/server-filesystem"
install_if_missing "@modelcontextprotocol/server-memory"
install_if_missing "@modelcontextprotocol/server-sequential-thinking"
install_if_missing "@modelcontextprotocol/server-github"
install_if_missing "repomix"
install_if_missing "@upstash/context7-mcp"
install_if_missing "tailwindcss-mcp-server"
install_if_missing "@sherifbutt/shadcn-ui-mcp-server"
install_if_missing "@r-mcp/static-analysis"
install_if_missing "code-auditor-mcp"
install_if_missing "@notprolands/ast-grep-mcp"
install_if_missing "@eslint/mcp"
install_if_missing "fetcher-mcp"
install_if_missing "@mseep/git-mcp-server"
install_if_missing "@_davideast/stitch-mcp"

# ── codebase-memory-mcp (Go binary) ──────────────────────────────────────────
echo ""
echo "📦 Checking codebase-memory-mcp (Go binary)..."
if command -v codebase-memory-mcp &>/dev/null; then
  echo "  ✓ codebase-memory-mcp already installed, skipping"
else
  if command -v go &>/dev/null; then
    echo "  ↓ Installing codebase-memory-mcp via go install..."
    go install github.com/DeusData/codebase-memory-mcp@latest
    echo "  ✓ codebase-memory-mcp installed"
  else
    echo "  ⚠️  Go not found — skipping codebase-memory-mcp"
    echo "     Install Go first: https://go.dev/dl/ then re-run this script"
    SKIP_CODEBASE_MEMORY=true
  fi
fi

# ── API Keys ──────────────────────────────────────────────────────────────────
echo ""
echo "🔑 Enter your GitHub Personal Access Token"
echo "   (github.com → Settings → Developer settings → Personal access tokens)"
echo "   Scopes needed: repo, read:org, read:user"
read -r GITHUB_TOKEN

echo ""
echo "🔑 Enter your Stitch API Key (stitch.withgoogle.com → Settings → API Keys):"
read -r STITCH_API_KEY

echo ""
echo "🔑 Enter your Supabase Personal Access Token"
echo "   (supabase.com/dashboard/account/tokens → Generate new token)"
read -r SUPABASE_ACCESS_TOKEN

echo ""
echo "🔑 Enter your Supabase Project Ref (optional, press Enter to skip)"
echo "   (Project Settings → General → Reference ID)"
read -r PROJECT_REF

if [ -n "$PROJECT_REF" ]; then
  SUPABASE_MCP_URL="https://mcp.supabase.com/mcp?project_ref=$PROJECT_REF"
else
  SUPABASE_MCP_URL="https://mcp.supabase.com/mcp"
fi

# ── Config ────────────────────────────────────────────────────────────────────
echo ""
echo "📝 Checking OpenCode config..."
CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  echo "  ⚠️  Existing config backed up to config.json.bak..."
  cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
fi

# Build codebase-memory block conditionally
CODEBASE_MEMORY_BLOCK=''
if [ "$SKIP_CODEBASE_MEMORY" != "true" ]; then
  CODEBASE_MEMORY_BLOCK='"codebase-memory": {
      "type": "local",
      "enabled": true,
      "command": ["codebase-memory-mcp", "."]
    },'
fi

echo "  → Writing config..."
cat > "$CONFIG_FILE" << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "filesystem": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "memory": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-memory"]
    },
    "sequential-thinking": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    $CODEBASE_MEMORY_BLOCK
    "github": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "environment": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "$GITHUB_TOKEN"
      }
    },
    "fetch": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "fetcher-mcp"]
    },
    "git": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@mseep/git-mcp-server"]
    },
    "repomix": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "repomix", "--mcp"]
    },
    "context7": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@upstash/context7-mcp@latest"]
    },
    "eslint": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@eslint/mcp@latest"]
    },
    "ts-morph": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@r-mcp/static-analysis"]
    },
    "code-auditor": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "code-auditor-mcp"]
    },
    "ast-grep": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@notprolands/ast-grep-mcp"]
    },
    "tailwind": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "tailwindcss-mcp-server"]
    },
    "shadcn": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@sherifbutt/shadcn-ui-mcp-server"]
    },
    "stitch": {
      "type": "remote",
      "enabled": true,
      "url": "https://stitch.googleapis.com/mcp",
      "headers": {
        "X-Goog-Api-Key": "$STITCH_API_KEY"
      }
    },
    "supabase": {
      "type": "remote",
      "enabled": true,
      "url": "$SUPABASE_MCP_URL",
      "headers": {
        "Authorization": "Bearer $SUPABASE_ACCESS_TOKEN"
      }
    }
  }
}
EOF

echo ""
echo "✅ Done!"
echo "📋 MCPs configured:"
echo "   Core memory  : server-memory, sequential-thinking, codebase-memory-mcp"
echo "   Code quality : eslint, ts-morph, code-auditor, ast-grep"
echo "   Navigation   : filesystem, git, repomix, context7, fetch"
echo "   UI/Framework : tailwind, shadcn"
echo "   GitHub       : server-github"
echo "   Remote       : stitch, supabase"
echo ""
echo "💾 Backup: config.json.bak"
echo "🔄 Run: opencode mcp restart"
echo "📋 Verify: opencode mcp list"
cmd.exe /c "opencode mcp list" 2>/dev/null || echo "  ℹ️  Run 'opencode mcp list' in PowerShell to verify"

# First-time codebase indexing reminder
if [ "$SKIP_CODEBASE_MEMORY" != "true" ]; then
  echo ""
  echo "💡 First time using codebase-memory-mcp?"
  echo "   Open your project in OpenCode and say: 'Index this project'"
fi