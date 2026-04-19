# IDOR — Dynamic Overlay

## Metadata
- **Exploit Type**: idor
- **Applies To**: Gamma
- **Loading**: Appended when `exploit_type === "idor"`

---

## OVERLAY_CONTEXT

Insecure Direct Object Reference (IDOR) occurs when an application exposes internal object identifiers in URLs or request parameters without proper authorization checks. Success indicators: accessing another user's resource, horizontal/vertical privilege escalation.

---

## Identification Patterns

### URL-Based
```
/api/users/123/profile     (own profile)
/api/users/456/profile       (another user - IDOR)
/api/orders/789/invoice     (another user's order)
/api/accounts/ABC/settings  (another account)
```

### Parameter-Based
```
POST /api/transfer
{ "from": "account_123", "to": "account_456", "amount": 1000 }
(Can you change "from" to someone else's account?)
```

### Cookie/Session-Based
```
GET /api/profile
Cookie: session=user_abc
(Can you change user_abc to a different ID?)
```

---

## Attack Vectors

### Horizontal IDOR
```
Access level stays same, but different user's data
GET /api/users/123/profile → GET /api/users/456/profile
```

### Vertical IDOR
```
Escalate privileges by accessing admin resources
GET /api/users/123/profile → GET /api/admin/users
```

### Object-level Authorization Bypass
```
PUT /api/documents/123
{ "owner": "attacker", "content": "..." }
(Can you change ownership to your own?)
```

---

## Enumeration Strategies

### Sequential ID Enumeration
```
/api/users/1
/api/users/2
/api/users/3
... (automate with ffuf or curl loop)
```

### UUID/GUID Enumeration
```
/api/orders/a1b2c3d4-e5f6-7890-abcd-ef1234567890
/orders/b2c3d4e5-f6a7-8901-bcde-f23456789012
(Use wordlist of common UUIDs or extracted patterns)
```

### Parameter Tampering
```
Change: user_id=123 → user_id=456
Change: order_id=789 → order_id=999
Change: document_id=ABC → document_id=DEF
```

---

## Constraints

```
- ALWAYS enumerate IDs systematically (1-N or using extracted patterns)
- Test with your own legitimate credentials first
- Horizontal IDOR is often easier to find than vertical
- IDOR in PATCH/PUT/DELETE is often more impactful than GET
- Check for indirect IDOR: changing "role=user" in body vs changing URL param
```

---

*Overlay version: 1.0*
