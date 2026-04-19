# Swarm Mission Test Script
# Run this to verify the swarm mission is working correctly

param(
    [string]$MissionId = "6fc3258b-5cfe-427f-a825-a9fee59a813a",
    [string]$ApiBase = "http://localhost:8000"
)

function Write-Header($text) {
    Write-Host "`n=== $text ===" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
}

function Write-Success($text) {
    Write-Host "[OK] $text" -ForegroundColor Green
}

function Write-Warning($text) {
    Write-Host "[!] $text" -ForegroundColor Yellow
}

function Write-Error($text) {
    Write-Host "[X] $text" -ForegroundColor Red
}

Write-Header "Testing Swarm Mission $MissionId"

# 1. Check mission status
try {
    Write-Header "1. Mission Status"
    $response = Invoke-WebRequest -Uri "$ApiBase/swarm/$MissionId" -UseBasicParsing -ErrorAction Stop
    $mission = $response.Content | ConvertFrom-Json
    
    Write-Host "Mission ID: $($mission.mission_id)" -ForegroundColor White
    Write-Host "Target: $($mission.target)" -ForegroundColor White
    Write-Host "Status: $($mission.status)" -ForegroundColor $(if($mission.status -eq 'running'){'Green'} elseif($mission.status -eq 'pending'){'Yellow'} else{'Red'})
    Write-Host "Progress: $($mission.progress)%" -ForegroundColor White
    Write-Host "Phase: $($mission.current_phase)" -ForegroundColor White
    Write-Host "Iteration: $($mission.iteration)/$($mission.max_iterations)" -ForegroundColor White
    Write-Host "Findings: $($mission.findings_count)" -ForegroundColor White
    
    if ($mission.status -eq 'running') {
        Write-Success "Mission is actively running"
    } elseif ($mission.status -eq 'pending') {
        Write-Warning "Mission is pending - waiting for worker to pick it up"
    } elseif ($mission.status -eq 'completed') {
        Write-Success "Mission completed successfully"
    } else {
        Write-Error "Mission status: $($mission.status)"
    }
} catch {
    Write-Error "Failed to get mission status: $_"
}

# 2. Check agent states
try {
    Write-Header "2. Agent States"
    $response = Invoke-WebRequest -Uri "$ApiBase/swarm/$MissionId/agents" -UseBasicParsing -ErrorAction Stop
    $agents = $response.Content | ConvertFrom-Json
    
    Write-Host "Total Agents: $($agents.Count)" -ForegroundColor White
    Write-Host ""
    
    $statusCounts = @{}
    foreach ($agent in $agents) {
        $status = $agent.status
        if (-not $statusCounts.ContainsKey($status)) {
            $statusCounts[$status] = 0
        }
        $statusCounts[$status]++
    }
    
    Write-Host "Status Breakdown:" -ForegroundColor Yellow
    foreach ($status in $statusCounts.Keys) {
        $count = $statusCounts[$status]
        $color = switch ($status) {
            'running' { 'Green' }
            'complete' { 'Cyan' }
            'idle' { 'Gray' }
            'error' { 'Red' }
            default { 'White' }
        }
        Write-Host "  $status`: $count" -ForegroundColor $color
    }
    
    Write-Host "`nAgent Details:" -ForegroundColor Yellow
    $agents | Select-Object agent_id, agent_name, status, task | Format-Table -AutoSize
} catch {
    Write-Error "Failed to get agent states: $_"
}

# 3. Check recent events
try {
    Write-Header "3. Recent Events (Last 10)"
    $response = Invoke-WebRequest -Uri "$ApiBase/swarm/$MissionId/events?limit=10" -UseBasicParsing -ErrorAction Stop
    $events = $response.Content | ConvertFrom-Json
    
    if ($events.Count -eq 0) {
        Write-Warning "No events found yet"
    } else {
        Write-Success "Found $($events.Count) events"
        Write-Host ""
        $events | Select-Object -Property @{N='Time'; E={[DateTime]$_.created_at}}, agent_name, event_type, message | Format-Table -AutoSize
    }
} catch {
    Write-Error "Failed to get events: $_"
}

# 4. Check findings
try {
    Write-Header "4. Security Findings"
    $response = Invoke-WebRequest -Uri "$ApiBase/swarm/$MissionId/findings" -UseBasicParsing -ErrorAction Stop
    $findings = $response.Content | ConvertFrom-Json
    
    if ($findings.Count -eq 0) {
        Write-Warning "No findings discovered yet"
    } else {
        Write-Success "Found $($findings.Count) vulnerabilities"
        Write-Host ""
        
        # Group by severity
        $severityCounts = @{}
        foreach ($finding in $findings) {
            $sev = $finding.severity
            if (-not $severityCounts.ContainsKey($sev)) {
                $severityCounts[$sev] = 0
            }
            $severityCounts[$sev]++
        }
        
        Write-Host "Severity Breakdown:" -ForegroundColor Yellow
        foreach ($sev in @('critical', 'high', 'medium', 'low', 'info')) {
            if ($severityCounts.ContainsKey($sev)) {
                $color = switch ($sev) {
                    'critical' { 'Red' }
                    'high' { 'DarkYellow' }
                    'medium' { 'Yellow' }
                    'low' { 'Gray' }
                    default { 'White' }
                }
                Write-Host "  $sev`: $($severityCounts[$sev])" -ForegroundColor $color
            }
        }
        
        Write-Host "`nFindings Details:" -ForegroundColor Yellow
        $findings | Select-Object title, severity, confirmed, agent_name | Format-Table -AutoSize
    }
} catch {
    Write-Error "Failed to get findings: $_"
}

# 5. Summary
try {
    Write-Header "5. Summary"
    
    # Re-fetch mission for latest status
    $response = Invoke-WebRequest -Uri "$ApiBase/swarm/$MissionId" -UseBasicParsing -ErrorAction Stop
    $mission = $response.Content | ConvertFrom-Json
    
    Write-Host "Mission Health Check:" -ForegroundColor Yellow
    
    if ($mission.status -in @('pending', 'running', 'completed')) {
        Write-Success "Mission is active"
    } else {
        Write-Error "Mission is not active (status: $($mission.status))"
    }
    
    if ($agents.Count -eq 12) {
        Write-Success "All 12 agents registered"
    } else {
        Write-Warning "Only $($agents.Count)/12 agents registered"
    }
    
    $runningAgents = ($agents | Where-Object { $_.status -eq 'running' }).Count
    if ($runningAgents -gt 0) {
        Write-Success "$runningAgents agents are actively running"
    } else {
        Write-Warning "No agents are currently running"
    }
    
    if ($mission.findings_count -gt 0) {
        Write-Success "$($mission.findings_count) vulnerabilities discovered"
    } else {
        Write-Host "[INFO] No findings yet (this is normal at the start)" -ForegroundColor Gray
    }
    
    Write-Host "`nNext Steps:" -ForegroundColor Cyan
    Write-Host "1. Monitor mission status in Supabase dashboard" -ForegroundColor White
    Write-Host "2. Check Redis for pending messages" -ForegroundColor White
    Write-Host "3. Ensure Red Team agents are running from swarm module" -ForegroundColor White
    
} catch {
    Write-Error "Failed to generate summary: $_"
}

Write-Host "`n" -NoNewline
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
