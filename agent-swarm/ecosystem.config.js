const getAgentScript = (agent) => {
  return `bun run src/agents/${agent}.ts`;
};

const commonEnv = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  FALKORDB_HOST: process.env.FALKORDB_HOST || 'localhost',
  FALKORDB_PORT: process.env.FALKORDB_PORT || '6379',
  FALKORDB_USERNAME: process.env.FALKORDB_USERNAME || 'falkordb',
  FALKORDB_PASSWORD: process.env.FALKORDB_PASSWORD || '',
  SQLITE_EVENTS_PATH: process.env.SQLITE_EVENTS_PATH || './solaris-events.db',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  OLLAMA_ENABLED: process.env.OLLAMA_ENABLED || 'true',
};

const configs = [
  {
    name: 'commander',
    script: getAgentScript('commander'),
    env: { AGENT_ROLE: 'commander', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'verifier',
    script: getAgentScript('verifier'),
    env: { AGENT_ROLE: 'verifier', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'gamma-1',
    script: getAgentScript('gamma'),
    env: { AGENT_ROLE: 'gamma', INSTANCE_ID: '1', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'gamma-2',
    script: getAgentScript('gamma'),
    env: { AGENT_ROLE: 'gamma', INSTANCE_ID: '2', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
  },
  {
    name: 'gamma-3',
    script: getAgentScript('gamma'),
    env: { AGENT_ROLE: 'gamma', INSTANCE_ID: '3', ...commonEnv },
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    instance_var: 'INSTANCE_ID',
  },
];

module.exports = configs;
