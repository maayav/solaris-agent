import { sharedSandboxManager, type ExecResult } from '../core/sandbox-manager.js';
import type { ToolCall } from '../types/index.js';

export interface WebSearchArgs {
  action: 'google' | 'shodan' | 'cve' | 'scrape';
  query?: string;
  target?: string;
  limit?: number;
}

export async function executeWebSearch(args: WebSearchArgs): Promise<ExecResult> {
  const { action, query, target, limit = 10 } = args;

  let pythonCode = '';

  if (action === 'google') {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: 'SERPER_API_KEY not configured',
        command: 'web_search google',
        timed_out: false,
        success: false,
      };
    }
    pythonCode = `
import urllib.request
import json

query = "${query || ''}"
api_key = "${apiKey}"

url = "https://google.serper.dev/search"
data = json.dumps({"q": query}).encode()
req = urllib.request.Request(url, data=data, headers={
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
})

try:
    with urllib.request.urlopen(req, timeout=30) as response:
        results = json.loads(response.read())
        print(json.dumps(results, indent=2))
except Exception as e:
    print(f"Error: {e}")
`;
  } else if (action === 'shodan') {
    const apiKey = process.env.SHODAN_API_KEY;
    if (!apiKey) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: 'SHODAN_API_KEY not configured',
        command: 'web_search shodan',
        timed_out: false,
        success: false,
      };
    }
    pythonCode = `
import urllib.request
import json

query = "${query || ''}"
api_key = "${apiKey}"

url = f"https://api.shodan.io/shodan/host/search?key={api_key}&query={query}"
try:
    with urllib.request.urlopen(url, timeout=30) as response:
        results = json.loads(response.read())
        print(json.dumps(results, indent=2))
except Exception as e:
    print(f"Error: {e}")
`;
  } else if (action === 'cve') {
    pythonCode = `
import urllib.request
import json
import xml.etree.ElementTree as ET

query = "${query || ''}"
url = f"https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={query}"

try:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.loads(response.read())
        for item in data.get("vulnerabilities", [])[:${limit}]:
            cve = item.get("cve", {})
            print(f"CVE: {cve.get('id', 'N/A')}")
            descriptions = cve.get('descriptions', [{}])
            print(f"Description: {descriptions[0].get('value', 'N/A')[:200]}")
            metrics = cve.get('metrics', {}).get('cvssMetricV31', [{}])
            if metrics:
                print(f"CVSS: {metrics[0].get('cvssData', {}).get('baseScore', 'N/A')}")
            print("---")
except Exception as e:
    print(f"Error: {e}")
`;
  } else if (action === 'scrape') {
    pythonCode = `
import urllib.request
import re

url = "${target || ''}"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        html = response.read().decode('utf-8', errors='ignore')
        
        print(f"[*] Status: {response.status}")
        print(f"[*] Content-Length: {len(html)}")
        print()
        
        title_match = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE)
        if title_match:
            print(f"[+] Title: {title_match.group(1)}")
        
        forms = re.findall(r'<form[^>]*action=["\']([^"\']*)["\'][^>]*>', html, re.IGNORECASE)
        if forms:
            print(f"[+] Forms found: {len(forms)}")
            for form in forms[:5]:
                print(f"    - {form}")
        
        inputs = re.findall(r'<input[^>]*type=["\']([^"\']*)["\'][^>]*name=["\']([^"\']*)["\']', html, re.IGNORECASE)
        if inputs:
            print(f"[+] Input fields: {len(inputs)}")
            for inp_type, inp_name in inputs[:10]:
                print(f"    - {inp_type}: {inp_name}")
        
        tech_patterns = [
            (r'Server:\s*([^\s]+)', 'Server'),
            (r'X-Powered-By:\s*([^\s]+)', 'X-Powered-By'),
            (r'react', 'React'),
            (r'vue', 'Vue.js'),
            (r'angular', 'Angular'),
            (r'django', 'Django'),
            (r'flask', 'Flask'),
            (r'express', 'Express'),
            (r'laravel', 'Laravel'),
        ]
        
        print("[+] Technologies detected:")
        for pattern, name in tech_patterns:
            if re.search(pattern, html, re.IGNORECASE):
                match = re.search(pattern, html, re.IGNORECASE)
                print(f"    - {name}: {match.group(1) if match else 'found'}")
                
except Exception as e:
    print(f"Error: {e}")
`;
  }

  return sharedSandboxManager.executePython(pythonCode, 60);
}

export async function executeWebSearchToolCall(toolCall: ToolCall): Promise<ExecResult> {
  const args = toolCall.args as unknown as WebSearchArgs;
  return executeWebSearch({
    action: args.action,
    query: args.query,
    target: args.target,
    limit: args.limit,
  });
}
