"""
Auto-Remediation (Stage 9) - Automatic vulnerability fixing.
Generates git-compatible patches and opens PRs with fixes.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Optional imports
try:
    import git
    HAS_GIT = True
except ImportError:
    HAS_GIT = False
    logger.warning("gitpython not installed - auto-remediation will use manual patches")


class AutoRemediation:
    """
    Stage 9: Auto-Remediation from PRD v4.2.
    Generates git-compatible diffs for vulnerabilities and opens PRs.
    """
    
    def __init__(self, working_dir: str = "./remediation_work"):
        self._working_dir = Path(working_dir)
        self._working_dir.mkdir(parents=True, exist_ok=True)
    
    async def generate_fix(
        self,
        vulnerability: dict[str, Any],
        code_context: str,
        llm_client: Any,  # Ollama client
    ) -> dict[str, Any] | None:
        """
        Generate a fix for a vulnerability.
        
        Args:
            vulnerability: Vulnerability details (type, location, severity)
            code_context: Code snippet with vulnerability
            llm_client: LLM client for generating fixes
            
        Returns:
            Fix details with diff and explanation, or None if fix cannot be generated
        """
        vuln_type = vulnerability.get("type", "unknown")
        severity = vulnerability.get("severity", "medium")
        
        # Skip high-complexity fixes for now
        if vuln_type in ["architectural_flaw", "complex_race_condition"]:
            logger.info(f"Skipping auto-fix for complex vulnerability: {vuln_type}")
            return None
        
        prompt = f"""You are a security engineer. Generate a git-compatible unified diff to fix this vulnerability.

Vulnerability Type: {vuln_type}
Severity: {severity}
Location: {vulnerability.get('file', 'unknown')}:{vulnerability.get('line', 0)}

Original Code:
```
{code_context}
```

Requirements:
1. Generate a unified diff (git diff format) that fixes the vulnerability
2. Preserve semantic intent - don't change what the code does, only how it does it
3. Include security best practices (input validation, parameterized queries, etc.)
4. If you cannot generate a safe fix, respond with "CANNOT_FIX" and explain why

Response format:
```diff
--- a/path/to/file
+++ b/path/to/file
@@ -line,offset +line,offset @@
 context lines
-removed line
+added line
 context lines
```

Explanation: Brief explanation of the fix
"""
        
        try:
            # Call LLM for fix generation
            response = await llm_client.chat(
                model="qwen2.5-coder:7b",
                messages=[
                    {"role": "system", "content": "You are a security engineer generating fixes."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
            
            # Parse response
            if "CANNOT_FIX" in response:
                logger.info(f"LLM could not generate fix for {vuln_type}")
                return None
            
            # Extract diff
            diff_match = re.search(r'```diff\n(.*?)\n```', response, re.DOTALL)
            if not diff_match:
                logger.warning(f"No diff found in LLM response for {vuln_type}")
                return None
            
            diff = diff_match.group(1).strip()
            
            # Extract explanation
            explanation_match = re.search(r'Explanation:\s*(.+?)(?:\n\n|$)', response, re.DOTALL)
            explanation = explanation_match.group(1).strip() if explanation_match else "Auto-generated fix"
            
            return {
                "vulnerability": vulnerability,
                "diff": diff,
                "explanation": explanation,
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Failed to generate fix: {e}")
            return None
    
    async def create_patch_file(
        self,
        fix: dict[str, Any],
        scan_id: str,
    ) -> Path | None:
        """
        Create a patch file from a fix.
        
        Args:
            fix: Fix details from generate_fix
            scan_id: Scan identifier
            
        Returns:
            Path to patch file, or None if creation failed
        """
        try:
            vuln_hash = hashlib.md5(
                fix["vulnerability"].get("file", "unknown").encode()
            ).hexdigest()[:8]
            
            patch_filename = f"fix_{scan_id}_{vuln_hash}.patch"
            patch_path = self._working_dir / patch_filename
            
            patch_content = f"""From: VibeCheck Auto-Remediation
Date: {datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S +0000')}
Subject: [PATCH] security: Fix {fix['vulnerability'].get('type', 'vulnerability')}

{fix['explanation']}

---
{fix['diff']}
"""
            
            patch_path.write_text(patch_content)
            logger.info(f"Created patch file: {patch_path}")
            return patch_path
        except Exception as e:
            logger.error(f"Failed to create patch file: {e}")
            return None
    
    async def apply_fix_to_repo(
        self,
        repo_path: str | Path,
        fix: dict[str, Any],
        branch_name: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Apply a fix to a git repository.
        
        Args:
            repo_path: Path to git repository
            fix: Fix details from generate_fix
            branch_name: Optional branch name (auto-generated if not provided)
            
        Returns:
            Result dict with branch name and commit hash, or None if failed
        """
        if not HAS_GIT:
            logger.warning("GitPython not available - cannot apply fix to repo")
            return None
        
        try:
            repo = git.Repo(repo_path)
            
            # Generate branch name if not provided
            if not branch_name:
                vuln_type = fix["vulnerability"].get("type", "fix")
                timestamp = datetime.utcnow().strftime("%Y%m%d")
                branch_name = f"security/vibecheck-{vuln_type}-{timestamp}"
            
            # Create and checkout branch
            current = repo.create_head(branch_name)
            current.checkout()
            
            # Apply diff
            diff = fix["diff"]
            repo.git.apply("-", stdin=diff)
            
            # Stage changes
            repo.git.add(".")
            
            # Commit
            commit_message = f"""security(vibecheck): Fix {fix['vulnerability'].get('type', 'vulnerability')}

{fix['explanation']}

Auto-generated by VibeCheck Stage 9 Auto-Remediation
"""
            commit = repo.index.commit(commit_message)
            
            logger.info(f"Applied fix to branch {branch_name}, commit {commit.hexsha[:8]}")
            
            return {
                "branch": branch_name,
                "commit": commit.hexsha,
                "success": True,
            }
        except Exception as e:
            logger.error(f"Failed to apply fix to repo: {e}")
            return None
    
    async def generate_pr_description(
        self,
        fixes: list[dict[str, Any]],
        llm_client: Any,
    ) -> str:
        """
        Generate a PR description for multiple fixes.
        
        Args:
            fixes: List of fix details
            llm_client: LLM client
            
        Returns:
            PR description markdown
        """
        vuln_list = "\n".join([
            f"- **{f['vulnerability'].get('type', 'Unknown')}**: {f['vulnerability'].get('file', 'unknown')}"
            for f in fixes
        ])
        
        prompt = f"""Generate a Pull Request description for these security fixes:

Vulnerabilities Fixed:
{vuln_list}

Format:
```markdown
## Security Fixes

This PR addresses {len(fixes)} security vulnerability(ies) identified by VibeCheck.

### Changes
- List each fix with brief explanation

### Testing
- [ ] Review each change for correctness
- [ ] Run security tests
- [ ] Verify no regressions

### Auto-Generated Notice
This PR was automatically generated by VibeCheck Auto-Remediation (Stage 9).
"""

        try:
            response = await llm_client.chat(
                model="qwen2.5-coder:7b",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
            )
            return response
        except Exception as e:
            logger.error(f"Failed to generate PR description: {e}")
            return f"## Security Fixes\n\nAuto-generated fixes for {len(fixes)} vulnerabilities."
    
    async def remediate_scan(
        self,
        scan_id: str,
        vulnerabilities: list[dict[str, Any]],
        repo_path: str | Path | None,
        llm_client: Any,
    ) -> dict[str, Any]:
        """
        Main entry point for Stage 9 auto-remediation.
        
        Args:
            scan_id: Scan identifier
            vulnerabilities: List of vulnerabilities to fix
            repo_path: Optional path to git repo
            llm_client: LLM client
            
        Returns:
            Remediation result summary
        """
        results = {
            "scan_id": scan_id,
            "total_vulns": len(vulnerabilities),
            "fixes_generated": 0,
            "fixes_applied": 0,
            "patches_created": [],
            "errors": [],
        }
        
        fixes_to_apply = []
        
        # Generate fixes for each vulnerability
        for vuln in vulnerabilities:
            # Skip non-fixable vulnerabilities
            if vuln.get("severity") not in ["low", "medium", "high"]:
                continue
            
            code_context = vuln.get("code_snippet", "")
            if not code_context:
                continue
            
            fix = await self.generate_fix(vuln, code_context, llm_client)
            if fix:
                results["fixes_generated"] += 1
                fixes_to_apply.append(fix)
                
                # Create patch file
                patch_path = await self.create_patch_file(fix, scan_id)
                if patch_path:
                    results["patches_created"].append(str(patch_path))
        
        # Apply fixes to repo if available
        if repo_path and HAS_GIT and fixes_to_apply:
            try:
                branch_name = f"security/vibecheck-auto-{scan_id[:8]}"
                
                for fix in fixes_to_apply:
                    result = await self.apply_fix_to_repo(repo_path, fix, branch_name)
                    if result and result.get("success"):
                        results["fixes_applied"] += 1
                
                results["branch"] = branch_name
            except Exception as e:
                results["errors"].append(f"Failed to apply fixes: {e}")
        
        logger.info(
            f"Auto-remediation complete: {results['fixes_generated']} fixes generated, "
            f"{results['fixes_applied']} applied"
        )
        
        return results


# Singleton instance
_remediation_instance: AutoRemediation | None = None


def get_auto_remediation(working_dir: str = "./remediation_work") -> AutoRemediation:
    """Get or create auto-remediation singleton."""
    global _remediation_instance
    if _remediation_instance is None:
        _remediation_instance = AutoRemediation(working_dir)
    return _remediation_instance
