"""
Regression tests for Blue Team pipeline upgrades.

Tests the core invariants that must hold after any pipeline changes:
1. No duplicate confirmed findings
2. Dedup key excludes source field
3. Cost tracking works
4. Secrets scanner finds expected secrets
5. Semgrep finds expected patterns
6. Behavioral analyzer covers route files even with no prior findings

These tests run against the toy-vulnerable-app fixture without requiring
external services (Redis, FalkorDB, Qdrant, Supabase).
"""

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures" / "toy-vulnerable-app"
EXPECTED_PATH = FIXTURE_DIR / "expected_findings.json"
EXPECTED = json.loads(EXPECTED_PATH.read_text()) if EXPECTED_PATH.exists() else {}


class TestDedupKey:
    """Tests for deduplication key correctness."""

    def test_dedup_key_excludes_source(self):
        """Dedup key must be (file_path, line_start, vuln_type) — NOT include source."""
        from worker.scan_worker import ScanWorker

        worker = ScanWorker(worker_id="test-dedup")

        c1 = {"file_path": "a.ts", "line_start": 10, "vuln_type": "SQL_INJECTION", "source": "semgrep"}
        c2 = {"file_path": "a.ts", "line_start": 10, "vuln_type": "SQL_INJECTION", "source": "llm_lift"}

        key1 = worker._dedup_key(c1)
        key2 = worker._dedup_key(c2)

        assert key1 == key2, (
            "Dedup key must ignore source — semgrep and lifting at same location "
            "should produce one merged candidate, not two"
        )

    def test_different_location_not_deduped(self):
        """Different file+line+type should NOT be deduplicated."""
        from worker.scan_worker import ScanWorker

        worker = ScanWorker(worker_id="test-dedup")

        c1 = {"file_path": "a.ts", "line_start": 10, "vuln_type": "SQL_INJECTION"}
        c2 = {"file_path": "a.ts", "line_start": 20, "vuln_type": "SQL_INJECTION"}

        key1 = worker._dedup_key(c1)
        key2 = worker._dedup_key(c2)

        assert key1 != key2, "Different locations must produce different dedup keys"

    def test_different_type_not_deduped(self):
        """Same location but different vuln_type must NOT be deduplicated."""
        from worker.scan_worker import ScanWorker

        worker = ScanWorker(worker_id="test-dedup")

        c1 = {"file_path": "a.ts", "line_start": 10, "vuln_type": "SQL_INJECTION"}
        c2 = {"file_path": "a.ts", "line_start": 10, "vuln_type": "XSS"}

        key1 = worker._dedup_key(c1)
        key2 = worker._dedup_key(c2)

        assert key1 != key2, "Different vuln_type must produce different dedup keys"


class TestCostTracker:
    """Tests for cost tracking implementation."""

    def test_cost_tracker_initialization(self):
        """CostTracker initializes with correct defaults."""
        from worker.cost_tracker import CostTracker

        tracker = CostTracker()

        assert tracker.MAX_TOTAL_CENTS == 200
        assert tracker.total == 0.0
        assert tracker.spent["semantic"] == 0.0

    def test_cost_tracker_can_spend_respects_stage_cap(self):
        """can_spend returns False when stage cap would be exceeded."""
        from worker.cost_tracker import CostTracker

        tracker = CostTracker()
        tracker.spent["semantic"] = 0.25

        assert tracker.can_spend("semantic", estimated_cents=10) is True
        assert tracker.can_spend("semantic", estimated_cents=10) is False

    def test_cost_tracker_can_spend_respects_total_cap(self):
        """can_spend returns False when total cap would be exceeded."""
        from worker.cost_tracker import CostTracker

        tracker = CostTracker()
        tracker.spent["semantic"] = 1.0
        tracker.spent["verify"] = 1.0

        assert tracker.can_spend("behavioral", estimated_cents=10) is False

    def test_cost_tracker_record(self):
        """record() correctly accumulates costs."""
        from worker.cost_tracker import CostTracker

        tracker = CostTracker()
        tracker.record("verify", input_tokens=1000, output_tokens=500, model="deepseek-r1-distill")

        assert tracker.spent["verify"] > 0
        assert tracker.total > 0


class TestSecretsScanner:
    """Tests for the secrets scanner."""

    def test_aws_key_pattern_detected(self):
        """AWS AKIA... pattern is matched by secrets scanner."""
        from worker.secrets_scanner import SecretsScanner

        scanner = SecretsScanner()
        content = "AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'"

        findings = scanner.scan_file("config/secrets.ts", content)

        aws_findings = [f for f in findings if f.get("secret_type") == "AWS_ACCESS_KEY"]
        assert len(aws_findings) >= 1, "AWS AKIA pattern should be detected"

    def test_github_token_pattern_detected(self):
        """GitHub token pattern ghp_... is matched."""
        from worker.secrets_scanner import SecretsScanner

        scanner = SecretsScanner()
        content = "GITHUB_TOKEN = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz'"

        findings = scanner.scan_file("config/secrets.ts", content)

        gh_findings = [f for f in findings if f.get("secret_type") == "GITHUB_TOKEN"]
        assert len(gh_findings) >= 1, "GitHub token pattern should be detected"

    def test_jwt_secret_pattern_detected(self):
        """JWT_SECRET = '...' pattern is matched."""
        from worker.secrets_scanner import SecretsScanner

        scanner = SecretsScanner()
        content = "JWT_SECRET = 'ultra-secure-512-bit-secret-key-here'"

        findings = scanner.scan_file("config/secrets.ts", content)

        jwt_findings = [f for f in findings if f.get("secret_type") == "JWT_SECRET"]
        assert len(jwt_findings) >= 1, "JWT_SECRET pattern should be detected"

    def test_stripe_key_pattern_detected(self):
        """Stripe sk_live_... pattern is matched."""
        from worker.secrets_scanner import SecretsScanner

        scanner = SecretsScanner()
        content = "STRIPE_SECRET_KEY = 'sk_live_4ft6f8d9s7h6j5k3l2p1q0z'"

        findings = scanner.scan_file("config/secrets.ts", content)

        stripe_findings = [f for f in findings if f.get("secret_type") == "STRIPE_SECRET_KEY"]
        assert len(stripe_findings) >= 1, "Stripe sk_live_ pattern should be detected"

    def test_no_false_positives_on_safe_content(self):
        """Safe code with no secrets should produce zero findings."""
        from worker.secrets_scanner import SecretsScanner

        scanner = SecretsScanner()
        content = """
        const AWS_REGION = process.env.AWS_REGION;
        const dbPassword = process.env.DB_PASSWORD;
        const apiKey = getApiKeyFromVault();
        """

        findings = scanner.scan_file("safe.ts", content)

        assert len(findings) == 0, "Environment variables and function calls should not be flagged"


class TestSemgrepRules:
    """Tests for Semgrep rule coverage on the fixture."""

    @pytest.mark.asyncio
    async def test_idor_rule_fires_on_orders_route(self):
        """express-idor rule should fire on orders.ts line 8 (IDOR)."""
        from worker.semgrep_runner import SemgrepRunner

        runner = SemgrepRunner(rules_dir=str(Path(__file__).parent.parent / "rules"))

        orders_file = FIXTURE_DIR / "src" / "routes" / "orders.ts"
        if not orders_file.exists():
            pytest.skip("Fixture file not found")

        findings = await runner.run_semgrep(str(orders_file))

        idor_findings = [
            f for f in findings
            if f.get("check_id", "").startswith("express-idor")
        ]
        assert len(idor_findings) >= 1, "IDOR rule should fire on orders.ts"

    def test_semgrep_rule_express_taint_exists(self):
        """express-taint.yaml rule file must exist."""
        rules_dir = Path(__file__).parent.parent / "rules"
        taint_rule = rules_dir / "express-taint.yaml"

        assert taint_rule.exists(), f"express-taint.yaml not found at {rules_dir}"

    def test_semgrep_rule_express_idor_exists(self):
        """express-idor.yaml rule file must exist."""
        rules_dir = Path(__file__).parent.parent / "rules"
        idor_rule = rules_dir / "express-idor.yaml"

        assert idor_rule.exists(), f"express-idor.yaml not found at {rules_dir}"


class TestBehavioralAnalyzer:
    """Tests for behavioral flow analyzer priority and scope."""

    def test_behavioral_priority_high_incoming_calls(self):
        """Functions with high CALLS count should get higher behavioral priority."""
        from worker.behavioral_flow_analyzer import BehavioralFlowAnalyzer

        analyzer = BehavioralFlowAnalyzer()

        functions = [
            {"name": "login", "file": "routes/auth.ts", "incoming_calls": 5},
            {"name": "deleteUser", "file": "routes/admin.ts", "incoming_calls": 2},
            {"name": "helper", "file": "utils/helpers.ts", "incoming_calls": 20},
        ]

        priority_queue = analyzer._compute_priority(functions)

        assert priority_queue[0]["name"] == "helper", (
            "Function with most incoming calls should be analyzed first"
        )

    def test_behavioral_includes_route_files_without_prior_findings(self):
        """Behavioral analyzer must include route files even if Semgrep found nothing."""
        from worker.behavioral_flow_analyzer import BehavioralFlowAnalyzer

        analyzer = BehavioralFlowAnalyzer()

        semgrep_findings = []
        route_files = [
            "routes/auth.ts",
            "routes/login.ts",
            "routes/orders.ts",
            "routes/admin.ts",
        ]

        eligible = analyzer._eligible_for_analysis(semgrep_findings, route_files)

        assert "routes/auth.ts" in eligible, (
            "Route files should be eligible even with no Semgrep findings — "
            "missing auth gaps hide in routes that pass structural analysis"
        )


class TestFixtureCompleteness:
    """Tests that the toy-vulnerable-app fixture is complete."""

    def test_fixture_has_required_files(self):
        """Fixture must have all required source files."""
        required = [
            "src/routes/auth.ts",
            "src/routes/login.ts",
            "src/routes/orders.ts",
            "src/middleware/auth.ts",
            "src/config/secrets.ts",
            "src/app.ts",
            "infrastructure/main.tf",
            "Dockerfile",
            "expected_findings.json",
        ]

        for rel_path in required:
            full_path = FIXTURE_DIR / rel_path
            assert full_path.exists(), f"Fixture missing required file: {rel_path}"

    def test_expected_findings_json_valid(self):
        """expected_findings.json must be valid JSON with required stages."""
        assert EXPECTED_PATH.exists(), "expected_findings.json not found"

        required_stages = ["semgrep", "semantic_lifting", "secrets_scanner"]
        for stage in required_stages:
            assert stage in EXPECTED.get("stages", {}), (
                f"expected_findings.json missing stage: {stage}"
            )

    def test_secrets_fixture_has_hardcoded_secrets(self):
        """secrets.ts must contain hardcoded secrets for the scanner to find."""
        secrets_file = FIXTURE_DIR / "src" / "config" / "secrets.ts"
        if not secrets_file.exists():
            pytest.skip("secrets.ts not found")

        content = secrets_file.read_text()

        assert "AKIA" in content, "secrets.ts must have AWS key"
        assert "JWT_SECRET" in content, "secrets.ts must have JWT secret"
        assert "ghp_" in content, "secrets.ts must have GitHub token"

    def test_auth_route_is_unprotected(self):
        """auth.ts POST /admin/delete-user must NOT use authMiddleware."""
        auth_route = FIXTURE_DIR / "src" / "routes" / "auth.ts"
        if not auth_route.exists():
            pytest.skip("auth.ts not found")

        content = auth_route.read_text()

        assert "authMiddleware" not in content, (
            "auth.ts must NOT use authMiddleware — it is the vulnerable fixture"
        )

    def test_iac_fixture_has_open_cidr_block(self):
        """main.tf must have 0.0.0.0/0 CIDR block for IaC scanner to find."""
        tf_file = FIXTURE_DIR / "infrastructure" / "main.tf"
        if not tf_file.exists():
            pytest.skip("main.tf not found")

        content = tf_file.read_text()

        assert "0.0.0.0/0" in content, "main.tf must have open 0.0.0.0/0 rule"


class TestNeedsVerificationBypass:
    """Tests for the needs_llm_verification bypass fix."""

    def test_skip_verify_candidates_split_before_llm_loop(self):
        """Candidates with needs_llm_verification=False must be auto-confirmed, not sent to LLM."""
        from worker.scan_worker import ScanWorker

        worker = ScanWorker(worker_id="test-bypass")

        candidates = [
            {"file_path": "a.ts", "line_start": 10, "vuln_type": "SECRET", "needs_llm_verification": False},
            {"file_path": "b.ts", "line_start": 20, "vuln_type": "SQL_INJECTION", "needs_llm_verification": True},
        ]

        skip_verify, needs_verify = worker._split_candidates(candidates)

        assert len(skip_verify) == 1
        assert skip_verify[0]["file_path"] == "a.ts"
        assert len(needs_verify) == 1
        assert needs_verify[0]["file_path"] == "b.ts"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
