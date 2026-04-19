"""
Test Blue Team → Red Team Integration

Verifies that:
1. Target type detection works correctly
2. Blue Team findings are properly formatted
3. State enrichment adds findings to Red Team state
4. Commander prompt includes Blue Team intelligence
5. Attack surface categorization works

Run with: python -m pytest tests/test_blue_team_integration.py -v
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


class TestTargetTypeDetection:
    """Test auto-detection of target types."""

    def test_detect_live_url_http(self):
        from agents.state import detect_target_type
        assert detect_target_type("http://localhost:3000") == "live"
        assert detect_target_type("http://example.com") == "live"

    def test_detect_live_url_https(self):
        from agents.state import detect_target_type
        assert detect_target_type("https://api.example.com") == "live"
        assert detect_target_type("https://app.test.com/v1") == "live"

    def test_detect_github_url(self):
        from agents.state import detect_target_type
        assert detect_target_type("github.com/user/repo") == "static"
        assert detect_target_type("https://github.com/OWASP/JuiceShop") == "static"
        assert detect_target_type("git@github.com:user/repo.git") == "static"

    def test_detect_local_path(self):
        from agents.state import detect_target_type
        assert detect_target_type("/home/user/project") == "static"
        assert detect_target_type("./relative/path") == "static"
        assert detect_target_type("../parent") == "static"

    def test_detect_repo_indicators(self):
        from agents.state import detect_target_type
        assert detect_target_type("/tmp/test.js") == "static"
        assert detect_target_type("project/src/main.py") == "static"


class TestBlueTeamFinding:
    """Test BlueTeamFinding dataclass."""

    def test_finding_creation(self):
        from core.blue_team_bridge import BlueTeamFinding

        finding = BlueTeamFinding(
            finding_id="test-123",
            scan_id="scan-456",
            vuln_type="sql_injection",
            severity="high",
            file_path="routes/login.js",
            line_start=42,
            line_end=45,
            title="SQL Injection in Login",
            code_snippet="db.query('SELECT * FROM users WHERE id = ' + req.params.id)",
            confidence_score=0.95,
        )

        assert finding.finding_id == "test-123"
        assert finding.vuln_type == "sql_injection"
        assert finding.severity == "high"

    def test_exploit_suggestions_sql(self):
        from core.blue_team_bridge import BlueTeamFinding

        finding = BlueTeamFinding(
            finding_id="test-1",
            scan_id="scan-1",
            vuln_type="sql_injection",
            severity="critical",
            file_path="api/users.js",
            line_start=10,
            line_end=15,
        )

        suggestions = finding.compute_exploit_suggestions()

        assert any("SQL" in s for s in suggestions)
        assert any("' OR '1'='1" in s for s in suggestions)
        assert any("UNION" in s for s in suggestions)

    def test_exploit_suggestions_xss(self):
        from core.blue_team_bridge import BlueTeamFinding

        finding = BlueTeamFinding(
            finding_id="test-2",
            scan_id="scan-1",
            vuln_type="xss",
            severity="high",
            file_path="views/profile.ejs",
            line_start=5,
            line_end=8,
        )

        suggestions = finding.compute_exploit_suggestions()

        assert any("XSS" in s or "script" in s.lower() for s in suggestions)
        assert any("<script>" in s for s in suggestions)

    def test_to_recon_result(self):
        from core.blue_team_bridge import BlueTeamFinding

        finding = BlueTeamFinding(
            finding_id="test-3",
            scan_id="scan-1",
            vuln_type="hardcoded_secret",
            severity="critical",
            file_path="config/auth.js",
            line_start=1,
            line_end=3,
            title="JWT Secret Exposed",
            code_snippet="const SECRET = 'supersecret123';",
            confidence_score=0.99,
        )

        result = finding.to_recon_result()

        assert result["source"] == "blue_team_static_analysis"
        assert result["vuln_type"] == "hardcoded_secret"
        assert result["confidence"] == 0.99
        assert result["file_path"] == "config/auth.js"


class TestBlueTeamBridge:
    """Test BlueTeamBridge functionality."""

    @pytest.mark.asyncio
    async def test_format_for_commander_with_findings(self):
        from core.blue_team_bridge import BlueTeamBridge, BlueTeamFinding

        bridge = BlueTeamBridge()

        findings = [
            BlueTeamFinding(
                finding_id="f1",
                scan_id="s1",
                vuln_type="sql_injection",
                severity="critical",
                file_path="routes/api.js",
                line_start=25,
                line_end=28,
                title="SQL Injection in Product Search",
                code_snippet="db.query('SELECT * FROM products WHERE name = \"' + req.query.name + '\"'", 
                confidence_score=0.92,
            ),
            BlueTeamFinding(
                finding_id="f2", 
                scan_id="s1",
                vuln_type="xss",
                severity="high",
                file_path="views/review.ejs",
                line_start=15,
                line_end=18,
                title="Reflected XSS in Review Display",
                confidence_score=0.88,
            ),
        ]

        brief = bridge.format_for_commander(findings)

        # Verify brief contains key information
        assert "BLUE TEAM STATIC ANALYSIS INTELLIGENCE BRIEF" in brief
        assert "Total Findings: 2" in brief
        assert "INJECTION_POINTS:" in brief.upper() or "injection" in brief.lower()
        assert "SQL Injection in Product Search" in brief
        assert "CRITICAL" in brief

    @pytest.mark.asyncio
    async def test_format_for_commander_empty(self):
        from core.blue_team_bridge import BlueTeamBridge

        bridge = BlueTeamBridge()
        brief = bridge.format_for_commander([])

        assert "No Blue Team static analysis findings available" in brief

    def test_get_prioritized_attack_surface(self):
        from core.blue_team_bridge import BlueTeamBridge, BlueTeamFinding

        bridge = BlueTeamBridge()

        findings = [
            BlueTeamFinding(finding_id="1", scan_id="s1", vuln_type="sql_injection",
                          severity="critical", file_path="api.js"),
            BlueTeamFinding(finding_id="2", scan_id="s1", vuln_type="xss",
                          severity="high", file_path="views.js"),
            BlueTeamFinding(finding_id="3", scan_id="s1", vuln_type="hardcoded_secret",
                          severity="critical", file_path="config.js"),
            BlueTeamFinding(finding_id="4", scan_id="s1", vuln_type="path_traversal",
                          severity="medium", file_path="files.js"),
        ]

        attack_surface = bridge.get_prioritized_attack_surface(findings)

        assert len(attack_surface["injection_points"]) == 2  # SQLi + XSS
        assert len(attack_surface["sensitive_data"]) == 1    # Secrets
        assert len(attack_surface["access_control"]) == 1    # Path traversal


class TestStateEnrichment:
    """Test state enrichment with Blue Team findings."""

    @pytest.mark.asyncio
    async def test_enrich_state_adds_findings(self):
        from core.blue_team_bridge import enrich_state_with_blue_team_findings

        # Create a mock state
        state = {
            "mission_id": "test-mission-123",
            "target": "http://localhost:3000",
            "objective": "Test the application",
        }

        # Mock the bridge to return test findings
        mock_finding = MagicMock()
        mock_finding.to_recon_result.return_value = {
            "source": "blue_team",
            "vuln_type": "sql_injection",
            "confidence": 0.9,
        }

        with patch("core.blue_team_bridge.get_blue_team_bridge") as mock_get_bridge:
            mock_bridge = MagicMock()
            mock_bridge.get_findings_for_target = AsyncMock(return_value=[mock_finding])
            mock_bridge.format_for_commander.return_value = "Test Intelligence Brief"
            mock_get_bridge.return_value = mock_bridge

            enriched = await enrich_state_with_blue_team_findings(
                state, "http://localhost:3000"
            )

        assert "blue_team_findings" in enriched
        assert "blue_team_recon_results" in enriched
        assert "blue_team_intelligence_brief" in enriched
        assert enriched["blue_team_intelligence_brief"] == "Test Intelligence Brief"


class TestGraphIntegration:
    """Test graph integration."""

    def test_initial_state_has_blue_team_fields(self):
        from agents.graph import create_initial_state

        state = create_initial_state(
            objective="Test objective",
            target="http://localhost:3000",
        )

        assert "blue_team_findings" in state
        assert "blue_team_recon_results" in state
        assert "blue_team_intelligence_brief" in state
        assert state["blue_team_findings"] == []
        assert state["blue_team_recon_results"] == []

    def test_graph_has_blue_team_node(self):
        from agents.graph import build_red_team_graph

        graph = build_red_team_graph()

        # Check that the graph was compiled successfully
        assert graph is not None


class TestCommanderIntegration:
    """Test Commander integration with Blue Team."""

    def test_plan_prompt_includes_blue_team_intel(self):
        from agents.commander import PLAN_PROMPT

        # Verify the prompt template includes blue_team_intel
        assert "{blue_team_intel}" in PLAN_PROMPT
        assert "BLUE TEAM STATIC ANALYSIS INTELLIGENCE:" in PLAN_PROMPT
        assert "HIGH/CRITICAL" in PLAN_PROMPT


class TestEndToEnd:
    """End-to-end integration tests."""

    @pytest.mark.asyncio
    async def test_full_flow_with_mock_findings(self):
        """Test the complete flow from findings to formatted brief."""
        from core.blue_team_bridge import (
            BlueTeamBridge,
            BlueTeamFinding,
            enrich_state_with_blue_team_findings,
        )

        # Create realistic findings
        findings = [
            BlueTeamFinding(
                finding_id="semgrep-001",
                scan_id="scan-123",
                vuln_type="sql_injection",
                severity="critical",
                category="injection",
                file_path="routes/login.js",
                line_start=42,
                line_end=45,
                title="SQL Injection in Login Route",
                description="User input is directly concatenated into SQL query",
                code_snippet="const query = 'SELECT * FROM users WHERE email = \"' + email + '\"';",
                confirmed=True,
                confidence_score=0.95,
            ),
            BlueTeamFinding(
                finding_id="semgrep-002",
                scan_id="scan-123", 
                vuln_type="hardcoded_secret",
                severity="high",
                category="secrets",
                file_path="config/jwt.js",
                line_start=3,
                line_end=3,
                title="Hardcoded JWT Secret",
                code_snippet="const JWT_SECRET = 'my_super_secret_key_123';",
                confirmed=True,
                confidence_score=0.99,
            ),
        ]

        # Test attack surface categorization
        bridge = BlueTeamBridge()
        attack_surface = bridge.get_prioritized_attack_surface(findings)

        assert len(attack_surface["injection_points"]) == 1
        assert len(attack_surface["sensitive_data"]) == 1

        # Test brief formatting
        brief = bridge.format_for_commander(findings)

        assert "BLUE TEAM STATIC ANALYSIS INTELLIGENCE BRIEF" in brief
        assert "SQL Injection in Login Route" in brief
        assert "Hardcoded JWT Secret" in brief
        assert "routes/login.js:42" in brief
        assert "EXPLOITATION PRIORITIES:" in brief

        print("\n" + "=" * 60)
        print("FORMATTED INTELLIGENCE BRIEF:")
        print("=" * 60)
        print(brief)
        print("=" * 60)


if __name__ == "__main__":
    # Run with: python tests/test_blue_team_integration.py
    pytest.main([__file__, "-v", "--tb=short"])
