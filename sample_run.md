$ cd /run/media/peburu/BIG\ DRIVE/Backup/Projects/Prawin/solaris/solaris-agent/agent-swarm && cat > /tmp/full-query.ts << 'EOF'
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://nesjaodrrkefpmqdqtgv.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc2phb2RycmtlZnBtcWRxdGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMTg0MjcsImV4cCI6MjA4NjY5NDQyN30.zbEAwOcZ7Tn-LVfGC8KdQeh3D3xEyzghZ-Mfg0VgnfE';
const supabase = createClient(supabaseUrl, anonKey);
async function main() {
  // Get all swarm_missions
  const { data: missions } = await supabase
    .from('swarm_missions')
    .select('*')
    .order('created_at', { ascending: false });
  
  console.log(`Total missions: ${missions?.length || 0}`);
  console.log('\n=== Missions ===');
  missions?.forEach(m => {
    console.log(`${m.status.padEnd(15)} | ${m.target} | ${m.id}`);
  });
  // Get all swarm_findings
  const { data: findings } = await supabase
    .from('swarm_findings')
    .select('*')
    .order('created_at', { ascending: false });
  
  console.log(`\nTotal findings: ${findings?.length || 0}`);
  
  if (findings && findings.length > 0) {
    console.log('\n=== Findings by Type ===');
    const byType: Record<string, number> = {};
    findings.forEach(f => {
      byType[f.finding_type] = (byType[f.finding_type] || 0) + 1;
    });
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    console.log('\n=== Findings by Severity ===');
    const bySeverity: Record<string, number> = {};
    findings.forEach(f => {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    });
    Object.entries(bySeverity).sort((a, b) => b[1] - a[1]).forEach(([sev, count]) => {
      console.log(`  ${sev}: ${count}`);
    });
    console.log('\n=== Sample Finding ===');
    console.log(JSON.stringify(findings[0], null, 2));
  }
  // Check scan_queue
  const { data: scanQueue } = await supabase
    .from('scan_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  
  console.log(`\n=== Scan Queue (${scanQueue?.length || 0}) ===`);
  scanQueue?.forEach(s => {
    console.log(`${s.status?.padEnd(15) || 'n/a'} | ${s.target_url?.substring(0, 50)} | ${s.id}`);
  });
  // Check swarm_agent_events
  const { data: events } = await supabase
    .from('swarm_agent_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log(`\n=== Agent Events (${events?.length || 0}) ===`);
}
main().catch(console.error);
EOF
bun run /tmp/full-query.ts 2>&1

[INFO] Checking for pending messages...
14:52:00 [swarm_worker        ] INFO    Received mission: 1774948920967-0
14:52:12 [core.supabase_client] INFO    Red Team Supabase client initialized

============================================================
  PROCESSING MISSION: df7a7513-a6e0-44de-bdc5-98a646ac8116
============================================================
  Action: start
  Target: http://localhost:3000
  Objective: Security audit...
14:52:24 [httpx               ] INFO    HTTP Request: GET http://localhost:6333/collections "HTTP/1.1 200 OK"
14:52:24 [core.qdrant_memory  ] INFO    Episodic memory connected to Qdrant at localhost:6333
14:52:24 [httpx               ] INFO    HTTP Request: GET http://localhost:6333 "HTTP/1.1 200 OK"
14:52:24 [agents.tools.registry] INFO    Tool registered: nmap
14:52:24 [agents.tools.registry] INFO    Tool registered: nuclei
14:52:24 [agents.tools.registry] INFO    Tool registered: curl
14:52:24 [agents.tools.registry] INFO    Tool registered: python
14:52:24 [agents.tools.registry] INFO    Tool registered: jwt_exploit
14:52:24 [agents.tools.registry] INFO    Tool registered: jwt_forge
14:52:24 [agents.tools.registry] INFO    Tool registered: ffuf
14:52:24 [agents.tools.registry] INFO    Tool registered: ffuf_quick
14:52:24 [agents.tools.registry] INFO    Tool registered: sqlmap
14:52:24 [agents.tools.registry] INFO    Tool registered: sqlmap_quick
14:52:24 [agents.tools.registry] INFO    Tool registered: sqlmap_deep
14:52:24 [agents.graph        ] INFO    Creating mission: target=http://localhost:3000, detected_mode=live (explicit_mode=auto)
14:52:24 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_missions "HTTP/2 201 Created"
14:52:24 [agents.graph        ] INFO    Mission df7a7513-a6e0-44de-bdc5-98a646ac8116 created in Supabase

Starting mission execution...
14:52:24 [agents.graph        ] INFO    ============================================================
14:52:24 [agents.graph        ] INFO    BLUE TEAM ENRICHMENT - Querying static analysis findings
14:52:24 [agents.graph        ] INFO    Mission: df7a7513-a6e0-44de-bdc5-98a646ac8116, Target: http://localhost:3000
14:52:24 [agents.graph        ] INFO    ============================================================
14:52:24 [core.blue_team_bridge] INFO    Querying Blue Team findings for target: http://localhost:3000
14:52:24 [core.blue_team_bridge] INFO    Extracted repo name 'juice-shop' from target 'http://localhost:3000'
14:52:24 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=agent_start, agent=commander, title=Mission started — Blue Team enrichment
14:52:25 [httpx               ] INFO    HTTP Request: GET https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/scan_queue?select=id%2Crepo_url&repo_url=ilike.%25juice-shop%25&limit=500 "HTTP/2 200 OK"
14:52:25 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 201 Created"
14:52:25 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:52:25 [core.blue_team_bridge] INFO    Found 84 matching scans for repo: juice-shop
14:52:25 [core.blue_team_bridge] INFO    Querying vulnerabilities table...
14:52:25 [httpx               ] INFO    HTTP Request: PATCH https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_missions?id=eq.df7a7513-a6e0-44de-bdc5-98a646ac8116 "HTTP/2 200 OK"
14:52:25 [httpx               ] INFO    HTTP Request: GET https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/vulnerabilities?select=%2A&scan_id=in.%286bb2a886-8cae-4e90-a630-54b6fa89454a%2C453172c3-f6f3-4612-8ee3-3a5dc0ef3d10%2C8ee29e75-b749-4d3e-bb17-e94ed1fa7d33%2Cf3bd5352-b731-43b8-8616-ec71786d98c0%2C57b679b6-4de8-48f8-ae67-7b2d2298f3c0%2Ceb250274-fdc4-45a2-b428-f3b7048fd207%2C7125be65-1a79-42d1-8e58-ae8c75a17bcb%2C749ebedb-d7c5-4118-8ec0-6e51dbe354a4%2C3220fe25-bdc9-48f9-95be-d81c04b6c602%2C4d7f8f9c-3e9c-45d8-85f5-11601da9c616%2C81d10fa5-a0b3-436f-bd50-07469a719b44%2Cbcc0ac66-145a-46fc-93de-20fb1480f3b5%2Cd1c849fd-6032-43a6-9515-e58f98128b52%2C2b1d51fb-173f-4811-9860-8f5b28b5d1e9%2C0887c35d-c6be-4e70-9f10-4f0744f25e16%2C234d079b-9cdb-459c-ab48-b6c8731e5ea7%2Cf320fd2b-9dbc-47ff-a2c2-7daff5cf9b9f%2C9225b309-30c3-47ef-aafd-5cb2df8c2202%2C8e9c7a42-405c-43d5-9aed-731bf3d596f7%2C0d3efde6-fdc9-4a80-9e84-f18f4ce1556c%2C6252f5d3-4e9f-415d-951b-c29cbba647f1%2C1d627122-4c69-489c-aa0d-a81b0c4a9cae%2Cb95600ab-a1dd-44b2-96ed-a68a34c16ce4%2Cd9f4b3be-d856-4461-bb45-f7e8d88d62a9%2Cb1bec67f-7f14-4750-962e-8164625b6fbe%2C75f72a4f-8373-4617-926b-628c6f49a373%2Cbe67022e-1861-4c82-be64-d8a3b18e0d30%2C74701577-0b91-48a3-942b-c0a99ad5bcfb%2C294d034a-b33a-40b0-ba87-cd6311c2bfc7%2C28e6e763-9a46-478e-a0ae-8ca1e6a9348c%2C9f08018a-d328-4249-b0cd-bd9d8abf2eea%2Cc59a69f1-f6e0-4eaf-8944-44d138c364c8%2Ce9f2e368-644a-4f06-96ba-2b2bb6a91b8b%2C4358969b-e713-4050-97fb-0bac148fae00%2Cc30a96c5-198d-4faf-ba28-56a7a8b74f93%2Cfeb90501-3b8a-4726-a828-8adccb2bf75d%2C9555ed7e-305a-4b34-b468-91efc47e460d%2Ce2861588-8c5e-4386-90ca-db10b29e2926%2C1abf14b8-d4d6-4018-9289-d0ea5590dfb2%2Cdb9fa7cb-0233-4caa-b23b-dced7472cbda%2C0a7662bd-cae1-40b8-8378-98c9457f8206%2Cf7ad9ba7-3d3f-4a49-87de-a9935647c842%2C43e2baf6-8cc6-4b50-9659-7d0ba64e7f36%2C19398c88-f635-4342-a76f-6c39c0746400%2Cc5f3c90b-bf5e-4e8b-9a09-a02ad4eb6754%2C18e605cd-c170-435a-871d-d6e9c9288e92%2Cb7b544fb-6b17-4af5-b8db-4910d95a6121%2Cbef056a8-b4b3-4c81-bb2a-ac0e903cc2fe%2Cdd06902e-fd16-405f-8748-1793ead8c895%2C18c6b648-5ab1-44e1-bd22-fbbf5b60669f%2Cc2811057-addb-44e3-8f31-de746bb16783%2C619f24ea-b4fd-41ff-ab88-f9f33975feab%2C32d12c3e-85ea-4feb-87fc-1ab69dc2b054%2C92430141-76cb-40d3-af75-46ba0dc06d96%2Cede02827-f9cf-4faf-b0d5-ebd2d9d3325f%2C00c88a42-edce-4495-9f3f-d7c229872a85%2C7330c067-85c7-453d-8950-c2faf64bcbed%2C05d4f13f-3032-4f3d-999b-1dd55e0eaf94%2C9f523019-c957-4957-ac44-55d5acf116bc%2Cbf25fa81-6bb7-47fe-8e6d-bba984e0d13e%2Cdd2c110a-4b8f-4485-9867-6b7d19e4c754%2C10082b34-82c3-44e5-a7c6-1055b1143522%2Cae5ffe6a-0960-4070-9b11-5dcc1b922cc7%2C454e37a9-35e1-4507-8bc7-284e1ef20efa%2C5e4c81e2-c906-4295-9d64-2cebd0c7fa4a%2Ce5420ec4-fa71-4e67-a263-eb1ee825b76c%2C00891d31-c154-45fa-b563-40aaf45125e9%2C179012fa-c2a7-416f-b3df-ec02233163d2%2Cc408f8c9-453f-4360-9ce4-278cd2c0316b%2Cee7c97e0-c66f-48e3-95ab-7d40bdc4db18%2C6a3b4668-3e1b-4583-b828-fbdd9e9d18df%2C7eb339a5-b592-4b61-be13-69e3dce679b1%2C5137e287-5439-413e-b065-5b46d0220ca6%2C46fd73a0-4deb-4f66-ba01-a4531b45aff6%2Ce7e3f839-861f-4213-8608-7b09385e3e83%2C836bb283-72b9-448a-9740-6f7d65d6e151%2C6194e13f-d399-4caf-8bf2-ae76d62bf5c6%2C7f7324f1-e617-4131-b083-4f2d48aa19ab%2Cc02d9a41-c726-4e6c-a6fc-1c6e5590e117%2C91db5806-c5c1-4beb-8a52-b3d886d24aa4%2Cf056f55e-3c18-4e49-ac21-0fb869176640%2Cfd2b807e-6249-4591-b768-59703b2a83f6%2C984d49c4-87d1-4054-87a6-d9d42901e7ea%2C10dfe41f-854e-488f-b855-11bf8a0142a5%29&order=severity.desc&limit=500 "HTTP/2 200 OK"  
14:52:25 [core.blue_team_bridge] INFO    Found 500 vulnerabilities matching scan_ids
14:52:25 [core.blue_team_bridge] INFO    Supabase query returned 500 vulnerabilities
14:52:25 [core.blue_team_bridge] INFO    Deduplicated 500 vulnerabilities to 77 unique findings
14:52:25 [core.blue_team_bridge] INFO    Retrieved 77 Blue Team findings for http://localhost:3000
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_team_findings_count
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_team_attack_surface
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_0
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_1
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_2
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_3
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_4
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_5
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_6
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_7
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_8
14:52:25 [agents.a2a.blackboard] INFO    Blackboard [df7a7513-a6e0-44de-bdc5-98a646ac8116] write: blue_finding_9
14:52:25 [core.blue_team_bridge] INFO    Enriched state with 77 Blue Team findings
14:52:25 [agents.graph        ] INFO    ✓ Loaded 77 Blue Team findings
14:52:25 [agents.graph        ] INFO
════════════════════════════════════════════════════════════
BLUE TEAM STATIC ANALYSIS INTELLIGENCE BRIEF
════════════════════════════════════════════════════════════
Total Findings: 77

ATTACK SURFACE ANALYSIS:

  INJECTION POINTS:
    • [HIGH] Xss in
      Endpoint: /api/user-profile
      Code Location: Line 98
      Suggested: Test XSS at lines 98-98
    • [HIGH] Sql Injection in
      Endpoint: /api/Products
      Code Location: Line 17
      Suggested: Test SQL injection at lines 17-21
    • [HIGH] sql_injection:
      Endpoint: /api/Recycles
      Code Location: Line 12
      Suggested: Test SQL injection at lines 12-16
    • [HIGH] sql_injection:
      Endpoint: /api/data-export
      Code Location: Line 53
      Suggested: Test SQL injection at lines 53-53
    • [HIGH] sql_injection:
      Endpoint: /api/captcha
      Code Location: Line 37
      Suggested: Test SQL injection at lines 37-37
    ... and 27 more

  SENSITIVE DATA:
    • [HIGH] hardcoded_secret:
      Endpoint: /
      Code Location: Line 56
      Suggested: Check hardcoded secrets in source code (affects /)
    • [HIGH] hardcoded_secret:
      Endpoint: /
      Code Location: Line 191
      Suggested: Check hardcoded secrets in source code (affects /)

  ACCESS CONTROL:
    • [HIGH] Path Traversal in
      Endpoint: /api/Key
      Code Location: Line 14
      Suggested: Test path traversal at lines 14-14
    • [HIGH] Path Traversal in
      Endpoint: /api/Logs
      Code Location: Line 14
      Suggested: Test path traversal at lines 14-14
    • [HIGH] Path Traversal in
      Endpoint: /api/profile-image-file-upload
      Code Location: Line 43
      Suggested: Test path traversal at lines 43-43
    • [HIGH] Path Traversal in
      Endpoint: /api/file-server
      Code Location: Line 33
      Suggested: Test path traversal at lines 33-33
    • [HIGH] Path Traversal in
      Endpoint: /api/VulnCode
      Code Location: Line 89
      Suggested: Test path traversal at lines 89-89
    ... and 5 more

  CONFIGURATION:
    • [HIGH] Security Misconfiguration in
      Endpoint: /api/user-profile
      Code Location: Line 62
      Suggested: Investigate security_misconfiguration at lines 62-62
    • [HIGH] Security Misconfiguration in
      Endpoint: /api/data-export
      Code Location: Line 53
      Suggested: Investigate security_misconfiguration at lines 53-53
    • [HIGH] Security Misconfiguration in
      Endpoint: /api/delivery
      Code Location: Line 34
      Suggested: Investigate security_misconfiguration at lines 34-34
    • [HIGH] Security Misconfiguration in
      Endpoint: /api/deluxe
      Code Location: Line 25
      Suggested: Investigate security_misconfiguration at lines 25-25
    • [HIGH] Security Misconfiguration in
      Endpoint: /api/order
      Code Location: Line 140
      Suggested: Investigate security_misconfiguration at lines 140-140
    ... and 13 more

  BUSINESS LOGIC:
    • [HIGH] Sql Injection in
      Endpoint: /api/order-history
      Code Location: Line 36
      Suggested: Investigate unconfirmed at lines 36-36
    • [HIGH] Sql Injection in
      Endpoint: /api/Products
      Code Location: Line 17
      Suggested: Investigate unconfirmed at lines 17-21
    • [HIGH] Prototype Pollution in
      Endpoint: /api/track-order
      Code Location: Line 22
      Suggested: Investigate prototype_pollution at lines 22-22
    • [HIGH] open_redirect:
      Endpoint: /redirect
      Code Location: Line 19
      Suggested: Investigate open_redirect at lines 19-19
    • [HIGH] ssrf:
      Endpoint: /api/profile-image-url-upload
      Code Location: Line 24
      Suggested: Investigate ssrf at lines 24-24
    ... and 10 more

EXPLOITATION PRIORITIES:
1. Start with confirmed high/critical findings
2. Use code snippets to craft targeted payloads
3. Test injection points with context-aware payloads
4. Try hardcoded credentials against login endpoints

════════════════════════════════════════════════════════════
14:52:25 [agents.commander    ] INFO    Commander: Planning mission df7a7513-a6e0-44de-bdc5-98a646ac8116
14:52:25 [agents.commander    ] INFO    Using unified LLM client (OpenRouter primary, Ollama fallback)
14:52:25 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:25 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:52:25 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"

14:52:42 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:52:42 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:52:42 [agents.commander    ] INFO    Commander: Issued 4 tasks, strategy: The initial phase will focus on reconnaissance to gather more detailed information about the target
14:52:42 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=task_assignment, agent=commander, title=Commander issued 4 tasks

Phase: recon | Iteration: 0
  [commander] TASK_ASSIGNMENT
  [commander] TASK_ASSIGNMENT
  [commander] TASK_ASSIGNMENT
  [commander] TASK_ASSIGNMENT

Strategy: The initial phase will focus on reconnaissance to gather more detailed information about the target system. We will start with high-priority injection points and sensitive data to identify potential entry points for exploitation.
14:52:42 [agents.alpha_recon  ] INFO    Alpha: Executing recon for mission df7a7513-a6e0-44de-bdc5-98a646ac8116
14:52:42 [agents.alpha_recon  ] INFO    Alpha: Detected mode=live for target=http://localhost:3000
14:52:42 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:42 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 201 Created"
14:52:42 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:52:42 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:52:46 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:52:46 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:52:46 [agents.alpha_recon  ] INFO    Alpha: Running nmap with args: {'target': 'http://localhost:3000', 'mission_id': 'df7a7513-a6e0-44de-bdc5-98a646ac8116'}
14:52:46 [agents.tools.nmap_tool] INFO    Precision nmap: nmap -p 3000 -sV -sC host.docker.internal
14:52:47 [sandbox.sandbox_manager] WARNING Shared sandbox 'vibecheck-sandbox' is exited, starting it...
14:52:47 [sandbox.sandbox_manager] INFO    Shared sandbox 'vibecheck-sandbox' started
14:52:47 [sandbox.sandbox_manager] INFO    Sandbox exec: nmap -p 3000 -sV -sC host.docker.internal


[TOOL OUTPUT] nmap -p 3000 -sV -sC host.docker.internal...
  1: Starting Nmap 7.93 ( https://nmap.org ) at 2026-03-31 09:22 UTC
  2: Nmap scan report for host.docker.internal (192.168.65.254)
  3: Host is up (0.0013s latency).
  4: Other addresses for host.docker.internal (not scanned): fdc4:f303:9324::254
  6: PORT     STATE  SERVICE VERSION
  7: 3000/tcp closed ppp
  9: Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
  10: Nmap done: 1 IP address (1 host up) scanned in 6.55 seconds
  ... (1 more lines)


🔵 ALPHA ACTION: nmap
  1: Starting Nmap 7.93 ( https://nmap.org ) at 2026-03-31 09:22 UTC
  2: Nmap scan report for host.docker.internal (192.168.65.254)
  3: Host is up (0.0013s latency).
  4: Other addresses for host.docker.internal (not scanned): fdc4:f303:9324::254
  6: PORT     STATE  SERVICE VERSION
  7: 3000/tcp closed ppp
  9: Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
  10: Nmap done: 1 IP address (1 host up) scanned in 6.55 seconds
  ... (1 more lines)
  Exit code: 0

14:52:53 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:54 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:52:54 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:52:54 [agents.alpha_recon  ] INFO    Alpha: Running nuclei with args: {'target': 'http://localhost:3000', 'templates': 'cves, misconfig, panels, default-creds', 'mission_
14:52:54 [agents.tools.nuclei_tool] INFO    Ultra-early skip: Localhost training app detected on port 3000

🔵 ALPHA ACTION: nuclei
  1: {"status": "skipped", "reason": "training_app", "message": "Nuclei skipped for localhost:3000 - use ffuf for endpoint di
  Exit code: 0

14:52:54 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:55 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:52:55 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:52:55 [agents.alpha_recon  ] INFO    Alpha: Running nuclei with args: {'target': 'http://localhost:3000/.git/config', 'templates': 'sqli, xss, cves, default-creds', 'miss
14:52:55 [agents.tools.nuclei_tool] INFO    Ultra-early skip: Localhost training app detected on port 3000

🔵 ALPHA ACTION: nuclei
  1: {"status": "skipped", "reason": "training_app", "message": "Nuclei skipped for localhost:3000 - use ffuf for endpoint di
  Exit code: 0

14:52:55 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:56 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:52:56 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:52:56 [agents.alpha_recon  ] INFO    Alpha: 0 new findings from 3 tool calls (skipped 0 blue_team findings)
14:52:56 [agents.gamma_exploit] INFO    Gamma: Executing exploits for mission df7a7513-a6e0-44de-bdc5-98a646ac8116
14:52:56 [agents.gamma_exploit] INFO    Gamma: Detected mode=live for target=http://localhost:3000
14:52:56 [httpx               ] INFO    HTTP Request: POST http://localhost:6333/collections/successful_exploits/points/scroll "HTTP/1.1 200 OK"
14:52:56 [agents.gamma_exploit] INFO    🧠 Gamma: Loaded 10 successful exploits from Qdrant memory
14:52:56 [agents.gamma_exploit] INFO    🧠 Gamma: Total successful exploit types available: {'idor', 'xss', 'sensitive_data_exposure', 'info_disclosure'}
14:52:56 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:52:56 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:52:56 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 201 Created"

  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: text/html; charset=utf-8
  8: Vary: Accept-Encoding
  9: Date: Tue, 31 Mar 2026 09:23:08 GMT
  10: Connection: keep-alive
  ... (53 more lines)
  Exit code: 0

14:53:08 [agents.gamma_exploit] INFO    Critic [40]: Analyzing info_disclosure...
14:53:08 [agents.critic_agent ] INFO    Critic: Analyzing info_disclosure exploit result (exit code: 0)
14:53:08 [agents.critic_agent ] INFO    Critic: Detected hints: {'express': ['Express', 'Express'], 'angular': ['angular', 'angular']}
14:53:08 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:53:08 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.sensitive_data_exposure
14:53:08 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=sensitive_data_exposure on http://localhost:3000/f  
14:53:09 [agents.gamma_exploit] INFO    Gamma [0]: Executing curl (sqli)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/rest/user/login
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/rest/user/login
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"email
14:53:09 [agents.gamma_exploit] INFO    Gamma [1]: Executing curl (sqli)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/rest/user/login
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/rest/user/login
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"email
14:53:09 [agents.gamma_exploit] INFO    Gamma [15]: Executing curl (xss)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/rest/products/search
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/rest/products/search
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"searc
14:53:09 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=info_disclosure, target=http://localhost:8080/api/Users, event_id=666df72a-f6ab-40ec-958d-46fd45df85db
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:09 [agents.gamma_exploit] INFO    Gamma [16]: Executing curl (xss)
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/api/Products/1/reviews
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/api/Products/1/reviews
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"messa
14:53:09 [agents.gamma_exploit] INFO    Gamma [17]: Executing curl (xxe)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/api/Products
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/api/Products
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/xml' -d '<?xml ve

[TOOL OUTPUT] curl -s -i -X GET --max-time 30 http://host.docker.internal:...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 46
  9: ETag: W/"2e-L6sVu9sGTl1bz5RvvXS3eGAg6+A"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [20]: curl (client_side_bypass)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 46
  9: ETag: W/"2e-L6sVu9sGTl1bz5RvvXS3eGAg6+A"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [20]: Analyzing client_side_bypass...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing client_side_bypass exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'success_indicators': ['200 OK']}
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct

[TOOL OUTPUT] curl -s -i -X GET --max-time 30 http://host.docker.internal:...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 13212
  9: ETag: W/"339c-GD1GgZRStHpvvEScMRQ5FSNURlk"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [6]: curl (info_disclosure)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
  8: Content-Length: 13212
  9: ETag: W/"339c-GD1GgZRStHpvvEScMRQ5FSNURlk"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [6]: Analyzing info_disclosure...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing info_disclosure exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'success_indicators': ['"id":', 'success', 'created', 'updated', '200 OK']}
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct

[TOOL OUTPUT] curl -s -i -X GET --max-time 30 http://host.docker.internal:...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 1734
  9: ETag: W/"6c6-noSkHnw1N/zcbyHJPoV+o9WFBCo"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [5]: curl (info_disclosure)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 1734
  9: ETag: W/"6c6-noSkHnw1N/zcbyHJPoV+o9WFBCo"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [5]: Analyzing info_disclosure...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing info_disclosure exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'success_indicators': ['"id":', '"rating":', '"comment":', 'success', 'created', 'updated', 'customer', '200 OK']}
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:53:09 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: sensitive_data_exposure on http://localhost:3000/ftp/legal.md
14:53:09 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=sensitive_data_exposure, target=http://localhost:3000/ftp/legal.md, event_id=8d562270-53b4-4170-af74-52a18fd1b753
14:53:09 [agents.gamma_exploit] INFO    Gamma [18]: Executing curl (file_upload)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/file-upload
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/file-upload
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"file"

[TOOL OUTPUT] curl -s -i -X GET --max-time 30 http://host.docker.internal:...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 59605
  9: ETag: W/"e8d5-5NX2l2dc5Gg71Sbv9mcK0JRkk2Y"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [7]: curl (info_disclosure)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 59605
  9: ETag: W/"e8d5-5NX2l2dc5Gg71Sbv9mcK0JRkk2Y"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [7]: Analyzing info_disclosure...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing info_disclosure exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'jwt': ['jwt', 'jwt'], 'angular': ['Angular', 'Angular'], 'success_indicators': ['"id":', 'Authentication', 'success', 'created', 'updated', 'Admin', 'customer', '200 OK']}
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:53:09 [agents.gamma_exploit] INFO    Gamma [21]: Executing curl (authentication)
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/rest/user/change-password
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/rest/user/change-password
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"curre
14:53:09 [agents.gamma_exploit] INFO    Gamma [22]: Executing curl (authentication)
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Original URL: http://localhost:3000/rest/user/login
14:53:09 [agents.tools.curl_tool] INFO    [curl_tool] Translated URL: http://host.docker.internal:8080/rest/user/login
14:53:09 [sandbox.sandbox_manager] INFO    Sandbox exec: curl -s -i -X POST --max-time 30 -H 'Content-Type: application/json' -d '{"email

[TOOL OUTPUT] curl -s -i -X GET --max-time 30 http://host.docker.internal:...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 1734
  9: ETag: W/"6c6-noSkHnw1N/zcbyHJPoV+o9WFBCo"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [38]: curl (info_disclosure)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 1734
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 799
  9: ETag: W/"31f-+7q5T9jaHA5wse9qxtLIHCvDXEY"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [0]: Analyzing sqli...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing sqli exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'success_indicators': ['"token":', 'authentication', 'admin', '200 OK']}
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:53:09 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=xss, target=http://localhost:3000/rest/products/search, event_id=42be8e6e-ca9c-4226-8919-11eaa9ddbbb8
14:53:09 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: xss on http://localhost:3000/api/Products/1/reviews
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:09 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=xxe, target=http://localhost:3000/api/Products, event_id=1da6d3d8-ced3-4b4b-b25a-2287d14856cf
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:09 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=xss, target=http://localhost:3000/api/Products/1/reviews, event_id=3b52b99d-74e9-4ff5-9e44-e1536da9c61c

[TOOL OUTPUT] curl -s -i -X POST --max-time 30 -H 'Content-Type: applicati...
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 799
  9: ETag: W/"31f-2A4M01TgkwU9Nfr7IMaxsFsUQ14"
  10: Vary: Accept-Encoding
  ... (5 more lines)


🔴 GAMMA [22]: curl (authentication)
  1: HTTP/1.1 200 OK
  2: Access-Control-Allow-Origin: *
  3: X-Content-Type-Options: nosniff
  4: X-Frame-Options: SAMEORIGIN
  5: Feature-Policy: payment 'self'
  6: X-Recruiting: /#/jobs
  7: Content-Type: application/json; charset=utf-8
  8: Content-Length: 799
  9: ETag: W/"31f-2A4M01TgkwU9Nfr7IMaxsFsUQ14"
  10: Vary: Accept-Encoding
  ... (5 more lines)
  Exit code: 0

14:53:09 [agents.gamma_exploit] INFO    Critic [22]: Analyzing authentication...
14:53:09 [agents.critic_agent ] INFO    Critic: Analyzing authentication exploit result (exit code: 0)
14:53:09 [agents.critic_agent ] INFO    Critic: Detected hints: {'success_indicators': ['"token":', 'authentication', 'admin', '200 OK']}
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:09 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:09 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:10 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:10 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:10 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=True, error_type=none, recommendation=stealthier
14:53:10 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.info_disclosure
14:53:10 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=info_disclosure on http://localhost:3000/rest/prod  
14:53:10 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:10 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: info_disclosure on http://localhost:3000/rest/products/1/reviews
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 201 Created"
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:10 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: info_disclosure - ✓
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:10 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=info_disclosure, target=http://localhost:3000/rest/products/1/reviews, event_id=6c7d86ba-0e56-4930-b644-9be527869b3b
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:10 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:11 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:11 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:11 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=True, error_type=none, recommendation=abort
14:53:11 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/tokens.Authorization
14:53:11 [agents.gamma_exploit] INFO    🔗 Token chaining: Stored 'Authorization' in Redis for other exploits
14:53:11 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.sensitive_data_exposure
14:53:11 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=sensitive_data_exposure on http://localhost:3000/.  
14:53:11 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:11 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: sensitive_data_exposure on http://localhost:3000/.git/HEAD
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:11 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: sensitive_data_exposure - ✓
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:11 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=sensitive_data_exposure, target=http://localhost:3000/.git/HEAD, event_id=b184ae16-e321-4cd4-814b-10bf69389adf
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:11 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:13 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:13 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:13 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=False, error_type=none, recommendation=retry
14:53:13 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=info_disclosure on http://localhost:8080/rest/prod  
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:13 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: info_disclosure - ✗
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:13 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=info_disclosure, target=http://localhost:8080/rest/products/4/reviews, event_id=2c307d8f-701d-4a7d-b3ef-83fbc271e89d
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:13 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:14 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:14 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:14 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=True, error_type=none, recommendation=stealthier
14:53:14 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.info_disclosure
14:53:14 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=info_disclosure on http://localhost:8080/rest/prod  
14:53:14 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:14 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: info_disclosure on http://localhost:8080/rest/products/2/reviews
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:14 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: info_disclosure - ✓
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:14 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=info_disclosure, target=http://localhost:8080/rest/products/2/reviews, event_id=fcfe654e-f7b1-450c-814d-3b116f55d4a1
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:14 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:15 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:15 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:15 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=True, error_type=none, recommendation=stealthier
14:53:15 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/tokens.Authorization
14:53:15 [agents.gamma_exploit] INFO    🔗 Token chaining: Stored 'Authorization' in Redis for other exploits
14:53:15 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.sensitive_data_exposure
14:53:15 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=sensitive_data_exposure on http://localhost:8080/.  
14:53:15 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:15 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: sensitive_data_exposure on http://localhost:8080/.git/config
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:15 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: sensitive_data_exposure - ✓
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:15 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=sensitive_data_exposure, target=http://localhost:8080/.git/config, event_id=abfc4e71-8ace-4076-96a3-e71ef7fc4dd3
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:15 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:16 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:16 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:16 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=True, error_type=none, recommendation=abort
14:53:16 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/owasp_successes.info_disclosure
14:53:16 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=info_disclosure on http://localhost:8080/rest/prod  
14:53:16 [httpx               ] INFO    HTTP Request: PUT http://localhost:6333/collections/successful_exploits/points?wait=true "HTTP/1.1 200 OK"
14:53:16 [core.qdrant_memory  ] INFO    Stored successful exploit in memory: info_disclosure on http://localhost:8080/rest/products/6/reviews
14:53:16 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:16 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:16 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:16 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: info_disclosure - ✓
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:17 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=info_disclosure, target=http://localhost:8080/rest/products/6/reviews, event_id=3d9a1e6c-f172-4c77-aaad-901b21fc0379
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:53:17 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:17 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:17 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=False, error_type=none, recommendation=retry
14:53:17 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/tokens.Authorization
14:53:17 [agents.gamma_exploit] INFO    🔗 Token chaining: Stored 'Authorization' in Redis for other exploits
14:53:17 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=sensitive_data_exposure on http://localhost:8080/.  
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:17 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: sensitive_data_exposure - ✗
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:17 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:53:17 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=sensitive_data_exposure, target=http://localhost:8080/.git/index, event_id=c57d6368-ab3f-41ed-8799-aba7360576dc
14:53:18 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:19 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:53:19 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:53:19 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=False, error_type=server_error, recommendation=stealthier
14:53:19 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=info_disclosure on http://localhost:8080/api/
14:53:37 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
14:53:37 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
2 201 Created"
14:54:00 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_findings "HTTP/2 201 Created"
14:54:01 [httpx               ] INFO    HTTP Request: POST http://localhost:11434/api/chat "HTTP/1.1 200 OK"
14:54:01 [core.llm_client     ] INFO    ✅ LLM [Ollama/qwen2.5-coder:7b-instruct] responded
14:54:01 [agents.critic_agent ] INFO    Critic: Evaluation complete - success=False, error_type=auth_failure, recommendation=retry
14:54:01 [core.redis_bus      ] INFO    📦 Findings store: df7a7513-a6e0-44de-bdc5-98a646ac8116/tokens.Authorization
14:54:01 [agents.gamma_exploit] INFO    🔗 Token chaining: Stored 'Authorization' in Redis for other exploits
14:54:01 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=exploit_attempt, agent=gamma, title=auth_bypass on http://localhost:3000/admin
14:54:01 [agents.gamma_exploit] INFO    Gamma: Completed 43 exploits in parallel, 29 successful

✅ GAMMA: Parallel execution complete - 29/43 exploits successful

  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
  [agent_gamma] EXPLOIT_RESULT
14:54:01 [agents.gamma_exploit] INFO    HITL Gate: Checking exploit results for mission df7a7513-a6e0-44de-bdc5-98a646ac8116
14:54:01 [agents.commander    ] INFO    Commander: Observing results — iteration 0/5
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'sqli' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🔓 Commander: Endpoint 'http://localhost:3000/rest/user/login' marked as COMPROMISED
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'info_disclosure' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'sensitive_data_exposure' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'xss' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'client_side_bypass' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'authentication' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    🎯 Commander: New successful vector 'idor' added to Strategy Memory
14:54:01 [agents.commander    ] INFO    Using unified LLM client (OpenRouter primary, Ollama fallback)
14:54:01 [core.llm_client     ] INFO    🦙 Using Ollama model directly: qwen2.5-coder:7b-instruct
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_events "HTTP/2 201 Created"
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:54:01 [core.supabase_client] INFO    [DEBUG] Logging swarm event: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, event_type=critic_analysis, agent=critic, title=Critic: auth_bypass - ✗
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_agent_states?on_conflict=mission_id%2Cagent_id "HTTP/2 200 OK"
14:54:01 [core.supabase_client] INFO    [DEBUG] Logging exploit attempt: mission_id=df7a7513-a6e0-44de-bdc5-98a646ac8116, exploit_type=auth_bypass, target=http://localhost:3000/admin, event_id=c931b00c-4109-4120-8b8f-9385b69d2613
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_events "HTTP/2 201 Created"
14:54:01 [httpx               ] INFO    HTTP Request: POST https://nesjaodrrkefpmqdqtgv.supabase.co/rest/v1/swarm_exploit_attempts "HTTP/2 201 Created"
.
.
.
.
so on
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Final report:
============================================================
14:58:41 [agents.graph        ] INFO    MISSION COMPLETE - Generating Report
14:58:41 [agents.graph        ] INFO    ============================================================
14:58:41 [agents.report_generator] INFO    Deduplicated 0 findings to 0
14:58:41 [agents.report_generator] INFO    Deduplicated 233 exploits to 45 (kept best per endpoint)

╔══════════════════════════════════════════════════════════════════════════════╗
║                    VIBECHECK ENTERPRISE SECURITY                             ║
║                  AUTONOMOUS RED TEAM ASSESSMENT                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  CONFIDENTIAL - PROPRIETARY SECURITY INTELLIGENCE                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

Report ID:      df7a7513-a6e0-44de-bdc5-98a646ac8116
Generated:      2026-03-31T09:28:41.055684+00:00
Target:         http://localhost:3000
Classification: CONFIDENTIAL - EXECUTIVE REVIEW

┌──────────────────────────────────────────────────────────────────────────────┐
│                         CYBER-THREAT LANDSCAPE                               │
└──────────────────────────────────────────────────────────────────────────────┘

  ► Mission Objective: Security audit
  ► Kill Chain Progress: 71.4% (weaponization, exploitation, installation, c2, actions_on_objectives)
  ► Attack Vectors Tested: 196
  ► Successful Compromises: 130
  ► Critical Findings: 0
  ► Risk Level: HIGH

================================================================================
EXECUTIVE SUMMARY
================================================================================

⚠️  CRITICAL: 130 successful exploitation(s) confirmed. Immediate
   remediation is required to prevent unauthorized access and data exfiltration.

Strategy: Based on the analysis, the next phase should focus on exploiting the vulnerabilities identified. This involves developing and deploying payloads that take advantage of the weaknesses found in the application. 
The goal is to escalate privileges or gai...

--------------------------------------------------------------------------------
MISSION DETAILS
--------------------------------------------------------------------------------
Final Phase: exploitation
Iterations Completed: 5/5

--------------------------------------------------------------------------------
KILL CHAIN PROGRESS
--------------------------------------------------------------------------------
  Reconnaissance:     ○ PENDING
  Weaponization:      ✓ COMPLETE
  Exploitation:       ✓ COMPLETE
  Installation:       ✓ COMPLETE
  C2:                 ✓ COMPLETE
  Actions on Obj:     ✓ COMPLETE
  Overall Progress:   71.4%

================================================================================
KILL CHAIN NARRATIVE (Attack Progression)
================================================================================

  Attack Chain: Finding → Asset → Exploit → Impact

  Step 2: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/api/Feedbacks
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 3: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/api/Products
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 4: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/api/Challenges
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 5: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/products/1/reviews
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 6: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/languages
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 7: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/ftp/legal.md
    ├─ Vector:  SENSITIVE_DATA_EXPOSURE
    └─ Result:  ✓ SUCCESS (Sensitive File Exposure)

  Step 10: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/api/Challenges/?name=Score%20Board
    ├─ Vector:  CLIENT_SIDE_BYPASS
    └─ Result:  ✓ SUCCESS (Client-Side Security Bypass)

  Step 12: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/products/2/reviews
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 13: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/products/3/reviews
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 16: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/products/6/reviews
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 23: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/api/Feedbacks
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 24: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/api/Products
    ├─ Vector:  INFO_DISCLOSURE
    └─ Result:  ✓ SUCCESS (Information Leakage)

  Step 28: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/user/security-question?email=admin@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 31: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/user/security-question?email=jim@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 32: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/user/security-question?email=bender@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 33: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/user/security-question?email=morty@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 34: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:8080/rest/user/security-question?email=admin@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 35: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/user/security-question?email=jim@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 36: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/user/security-question?email=bender@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Step 37: EXPLOITATION
    ├─ Finding: Discovered weakness...
    ├─ Asset:   http://localhost:3000/rest/user/security-question?email=morty@juice-sh.op
    ├─ Vector:  IDOR
    └─ Result:  ✓ SUCCESS (Unauthorized Data Access)

  Chain Summary: INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → SENSITIVE_DATA_EXPOSURE → CLIENT_SIDE_BYPASS → INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → INFO_DISCLOSURE → IDOR → IDOR → IDOR → IDOR → IDOR → IDOR → IDOR → IDOR


--------------------------------------------------------------------------------
RECONNAISSANCE FINDINGS
--------------------------------------------------------------------------------
  No reconnaissance findings recorded.

--------------------------------------------------------------------------------
EXPLOITATION RESULTS
--------------------------------------------------------------------------------

┌─────────────────────────┬─────────┬──────┬──────────┐
│ Exploit                 │ Status  │ Time │ Severity │
├─────────────────────────┼─────────┼──────┼──────────┤
│ sqli                    │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ✅ WIN   │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ❌ FAIL  │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ✅ WIN   │ 0.0s │ N/A      │
│ xss                     │ ✅ WIN   │ 0.0s │ N/A      │
│ xss                     │ ✅ WIN   │ 0.0s │ N/A      │
│ xxe                     │ ❌ FAIL  │ 0.0s │ N/A      │
│ file_upload             │ ❌ FAIL  │ 0.0s │ N/A      │
│ client_side_bypass      │ ✅ WIN   │ 0.0s │ N/A      │
│ client_side_bypass      │ ❌ FAIL  │ 0.0s │ N/A      │
│ authentication          │ ❌ FAIL  │ 0.0s │ N/A      │
│ authentication          │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ✅ WIN   │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ✅ WIN   │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ❌ FAIL  │ 0.0s │ N/A      │
│ sensitive_data_exposure │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ❌ FAIL  │ 0.0s │ N/A      │
│ info_disclosure         │ ✅ WIN   │ 0.0s │ N/A      │
│ auth_bypass             │ ❌ FAIL  │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
│ idor                    │ ✅ WIN   │ 0.0s │ N/A      │
└─────────────────────────┴─────────┴──────┴──────────┘

📊 SUMMARY: 31/45 exploits successful (69% success rate)


  [1] [✓ SUCCESS] SQLI
      Target:   http://localhost:3000/rest/user/login
      Evidence: HTTP 200 OK response with authentication token...

  [2] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:3000/metrics
      Evidence: HTTP 404 - Endpoint not found...

  [3] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:3000/api/Feedbacks
      Evidence: HTTP 200 OK response with application/json content type containing user feedback data...

  [4] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:3000/api/Products
      Evidence: HTTP 200 OK response with application/json content type, indicating successful data retrieval....

  [5] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:3000/api/Challenges
      Evidence: HTTP 200 OK response with application/json content type indicates successful data retrieval....

  [6] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:3000/rest/products/1/reviews
      Evidence: HTTP 200 response with JSON data containing product reviews...

  [7] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:3000/rest/languages
      Evidence: HTTP 200 OK response with application/json content type, indicating successful data retrieval....

  [8] [✓ SUCCESS] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:3000/ftp/legal.md
      Evidence: HTTP 200 OK on FTP endpoint with file content - sensitive data exposure confirmed....

  [9] [✗ FAILED] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:3000/ftp/package.json.bak
      Evidence: HTTP 403 - Authentication/Authorization required...

  [10] [✓ SUCCESS] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:3000/.git/HEAD
      Evidence: The response contains the contents of the .git/HEAD file, which indicates sensitive data exposure....

  [11] [✓ SUCCESS] XSS
      Target:   http://localhost:3000/rest/products/search
      Evidence: Reflected XSS payload triggered unhandled exception in input parser — server-side execution confirmed (HTTP 500)....

  [12] [✓ SUCCESS] XSS
      Target:   http://localhost:3000/api/Products/1/reviews
      Evidence: Reflected XSS payload triggered unhandled exception in input parser — server-side execution confirmed (HTTP 500)....

  [13] [✗ FAILED] XXE
      Target:   http://localhost:3000/api/Products
      Evidence: HTTP 401 - Authentication/Authorization required...

  [14] [✗ FAILED] FILE_UPLOAD
      Target:   http://localhost:3000/file-upload
      Evidence: HTTP/1.1 400 Bad Request with error message 'File is not passed'...

  [15] [✓ SUCCESS] CLIENT_SIDE_BYPASS
      Target:   http://localhost:3000/api/Challenges/?name=Score%20Board
      Evidence: HTTP 200 OK response with JSON data indicating success...

  [16] [✗ FAILED] CLIENT_SIDE_BYPASS
      Target:   http://localhost:3000/rest/captcha
      Evidence: HTTP 200 OK response with JSON data...

  [17] [✗ FAILED] AUTHENTICATION
      Target:   http://localhost:3000/rest/user/change-password
      Evidence: HTTP 500 Internal Server Error with unexpected path message...

  [18] [✓ SUCCESS] AUTHENTICATION
      Target:   http://localhost:3000/rest/user/login
      Evidence: HTTP 200 OK response with authentication token...

  [19] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/rest/products/2/reviews
      Evidence: HTTP 200 response with JSON data containing product reviews...

  [20] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/rest/products/3/reviews
      Evidence: HTTP 200 response with JSON data containing product reviews...

  [21] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/rest/products/4/reviews
      Evidence: HTTP 200 OK response with empty data array...

  [22] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/rest/products/5/reviews
      Evidence: HTTP 200 OK with empty data array...

  [23] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/rest/products/6/reviews
      Evidence: HTTP 200 response with JSON data indicating successful retrieval of product reviews....

  [24] [✓ SUCCESS] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:8080/.git/config
      Evidence: The server responded with a 200 OK status, indicating that the .git/config file was successfully retrieved....

  [25] [✓ SUCCESS] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:8080/.git/logs/HEAD
      Evidence: The response contains HTML content, indicating that the file was successfully retrieved....

  [26] [✗ FAILED] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:8080/.git/index
      Evidence: The response contains the HTML content of the Juice Shop homepage, indicating that the file retrieval was unsuccessful....

  [27] [✓ SUCCESS] SENSITIVE_DATA_EXPOSURE
      Target:   http://localhost:8080/.git/refs/heads/main
      Evidence: The server responded with a 200 OK status, indicating that the file was successfully retrieved....

  [28] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Users
      Evidence: HTTP 401 - Authentication/Authorization required...

  [29] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Orders
      Evidence: HTTP 500 Internal Server Error with stack trace indicating unexpected path...

  [30] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Feedbacks
      Evidence: HTTP 200 response with JSON data containing product feedbacks...

  [31] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Products
      Evidence: HTTP 200 OK response with application/json content type, indicating successful data retrieval....

  [32] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Reviews
      Evidence: HTTP 500 Internal Server Error with stack trace indicating unexpected path...

  [33] [✗ FAILED] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Addresses
      Evidence: HTTP 500 Internal Server Error with error message 'Unexpected path: /api/Addresses'...

  [34] [✓ SUCCESS] INFO_DISCLOSURE
      Target:   http://localhost:8080/api/Challenges
      Evidence: HTTP 200 OK response with application/json content type indicates successful data retrieval....

  [35] [✗ FAILED] AUTH_BYPASS
      Target:   http://localhost:3000/admin
      Evidence: HTTP 200 OK response with no indication of successful auth bypass...

  [36] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/rest/user/security-question?email=admin@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [37] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/rest/basket/1
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [38] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/api/Users
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [39] [✓ SUCCESS] IDOR
      Target:   http://localhost:8080/rest/user/security-question?email=jim@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [40] [✓ SUCCESS] IDOR
      Target:   http://localhost:8080/rest/user/security-question?email=bender@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [41] [✓ SUCCESS] IDOR
      Target:   http://localhost:8080/rest/user/security-question?email=morty@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [42] [✓ SUCCESS] IDOR
      Target:   http://localhost:8080/rest/user/security-question?email=admin@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [43] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/rest/user/security-question?email=jim@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [44] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/rest/user/security-question?email=bender@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

  [45] [✓ SUCCESS] IDOR
      Target:   http://localhost:3000/rest/user/security-question?email=morty@juice-sh.op
      Evidence: HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource....

--------------------------------------------------------------------------------
MISSION STATISTICS
--------------------------------------------------------------------------------
  Total Messages:          211
  Intelligence Reports:    0
  Exploit Attempts:        196
  Successful Exploits:     130
  High Confidence Findings: 0

================================================================================
PRIORITY REMEDIATION RECOMMENDATIONS
================================================================================

  🚨 CRITICAL: Successful exploits detected - immediate remediation required
  •   - info_disclosure on http://localhost:3000/api/Feedbacks
  •   - info_disclosure on http://localhost:3000/api/Products
  •   - info_disclosure on http://localhost:3000/api/Challenges
  •   - info_disclosure on http://localhost:3000/rest/products/1/reviews
  •   - info_disclosure on http://localhost:3000/rest/languages
  •   - sensitive_data_exposure on http://localhost:3000/ftp/legal.md
  •   - client_side_bypass on http://localhost:3000/api/Challenges/?name=Score%20Board
  •   - info_disclosure on http://localhost:8080/rest/products/2/reviews
  •   - info_disclosure on http://localhost:8080/rest/products/3/reviews
  •   - info_disclosure on http://localhost:8080/rest/products/6/reviews
  •   - info_disclosure on http://localhost:8080/api/Feedbacks
  •   - info_disclosure on http://localhost:8080/api/Products
  •   - idor on http://localhost:3000/rest/user/security-question?email=admin@juice-sh.op
  •   - idor on http://localhost:8080/rest/user/security-question?email=jim@juice-sh.op
  •   - idor on http://localhost:8080/rest/user/security-question?email=bender@juice-sh.op
  •   - idor on http://localhost:8080/rest/user/security-question?email=morty@juice-sh.op
  •   - idor on http://localhost:8080/rest/user/security-question?email=admin@juice-sh.op
  •   - idor on http://localhost:3000/rest/user/security-question?email=jim@juice-sh.op
  •   - idor on http://localhost:3000/rest/user/security-question?email=bender@juice-sh.op
  •   - idor on http://localhost:3000/rest/user/security-question?email=morty@juice-sh.op


╔══════════════════════════════════════════════════════════════════════════════╗
║          © 2025 VibeCheck Enterprise Security - All Rights Reserved          ║
║        This report contains confidential security information.             ║
║        Distribution limited to authorized personnel only.                  ║
╚══════════════════════════════════════════════════════════════════════════════╝

Report Generated by VibeCheck Autonomous Red Team Platform
For inquiries: security@vibecheck.enterprise

================================================================================
END OF REPORT
================================================================================
