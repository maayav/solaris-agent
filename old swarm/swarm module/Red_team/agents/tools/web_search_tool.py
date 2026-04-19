"""
Web Search and OSINT tools for Alpha reconnaissance.

Provides:
- Google Search API integration (via Serper.dev or similar)
- Shodan API integration for exposed services
- Website scraping with BeautifulSoup
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)

# API Keys from environment
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")


async def search_google(query: str, num_results: int = 10, **kwargs: Any) -> ExecResult:
    """
    Search Google using Serper.dev API.
    
    Args:
        query: Search query string
        num_results: Number of results to return (max 100)
    
    Returns:
        ExecResult with JSON search results
    """
    if not SERPER_API_KEY:
        logger.warning("SERPER_API_KEY not set - using mock search results")
        # Return a mock result for testing
        return ExecResult(
            exit_code=0,
            stdout=json.dumps({
                "searchParameters": {"q": query, "num": num_results},
                "answerBox": {"snippet": f"Mock search results for: {query}"},
                "organic": [
                    {
                        "title": f"Result 1 for {query}",
                        "link": "https://example.com/result1",
                        "snippet": f"This is a mock search result for {query}"
                    },
                    {
                        "title": f"Result 2 for {query}",
                        "link": "https://example.com/result2",
                        "snippet": f"Another mock result for {query}"
                    }
                ]
            }, indent=2),
            stderr="",
            command=f"google_search({query})",
        )
    
    # Build curl command for Serper API
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json"
    }
    data = {"q": query, "num": min(num_results, 100)}
    
    # Execute via curl in sandbox
    cmd = [
        "curl", "-s", "-X", "POST",
        "-H", f"X-API-KEY: {SERPER_API_KEY}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(data),
        url
    ]
    
    result = await shared_sandbox_manager.execute(cmd)
    return result


async def search_shodan(query: str, **kwargs: Any) -> ExecResult:
    """
    Search Shodan for exposed services and vulnerabilities.
    
    Args:
        query: Shodan search query (e.g., "apache", "port:3306", "hostname:target.com")
    
    Returns:
        ExecResult with JSON Shodan results
    """
    if not SHODAN_API_KEY:
        logger.warning("SHODAN_API_KEY not set - using mock Shodan results")
        return ExecResult(
            exit_code=0,
            stdout=json.dumps({
                "total": 2,
                "matches": [
                    {
                        "ip_str": "192.168.1.100",
                        "port": 80,
                        "hostnames": ["target.example.com"],
                        "org": "Example Corp",
                        "data": f"Mock Shodan result for: {query}",
                        "vulns": ["CVE-2021-44228"]
                    },
                    {
                        "ip_str": "192.168.1.101",
                        "port": 443,
                        "hostnames": ["api.example.com"],
                        "org": "Example Corp",
                        "data": f"Another mock result for: {query}",
                        "vulns": []
                    }
                ]
            }, indent=2),
            stderr="",
            command=f"shodan_search({query})",
        )
    
    # Build curl command for Shodan API
    url = f"https://api.shodan.io/shodan/host/search?key={SHODAN_API_KEY}&query={query}"
    
    cmd = ["curl", "-s", url]
    result = await shared_sandbox_manager.execute(cmd)
    return result


async def scrape_website(url: str, **kwargs: Any) -> ExecResult:
    """
    Scrape website content using BeautifulSoup via Python in sandbox.
    
    Args:
        url: Target URL to scrape
    
    Returns:
        ExecResult with extracted content including:
        - Title
        - Meta tags
        - Links
        - Forms
        - Technology fingerprints
    """
    # Python script to run in sandbox
    scrape_script = f'''
import json
import urllib.request
from bs4 import BeautifulSoup

try:
    # Fetch the page
    req = urllib.request.Request(
        "{url}",
        headers={{
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }}
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        html = response.read().decode("utf-8", errors="ignore")
    
    # Parse with BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    
    # Extract information
    result = {{
        "url": "{url}",
        "title": soup.title.string if soup.title else "No title",
        "meta_tags": {{}},
        "links": [],
        "forms": [],
        "scripts": [],
        "technologies": [],
        "emails": [],
        "comments": []
    }}
    
    # Extract meta tags
    for meta in soup.find_all("meta"):
        name = meta.get("name", meta.get("property", ""))
        content = meta.get("content", "")
        if name and content:
            result["meta_tags"][name] = content
    
    # Extract links
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True)
        result["links"].append({{"href": href, "text": text[:100]}})
    
    # Extract forms
    for form in soup.find_all("form"):
        form_info = {{
            "action": form.get("action", ""),
            "method": form.get("method", "GET").upper(),
            "inputs": []
        }}
        for inp in form.find_all(["input", "textarea", "select"]):
            form_info["inputs"].append({{
                "type": inp.get("type", inp.name),
                "name": inp.get("name", ""),
                "id": inp.get("id", "")
            }})
        result["forms"].append(form_info)
    
    # Extract scripts (for fingerprinting)
    for script in soup.find_all("script", src=True):
        result["scripts"].append(script["src"])
    
    # Technology fingerprinting
    html_lower = html.lower()
    if "wp-content" in html_lower:
        result["technologies"].append("WordPress")
    if "drupal" in html_lower:
        result["technologies"].append("Drupal")
    if "jquery" in html_lower:
        result["technologies"].append("jQuery")
    if "react" in html_lower:
        result["technologies"].append("React")
    if "angular" in html_lower:
        result["technologies"].append("Angular")
    if "django" in html_lower or "csrfmiddlewaretoken" in html_lower:
        result["technologies"].append("Django")
    if "express" in html_lower:
        result["technologies"].append("Express.js")
    
    # Extract emails (simple regex)
    import re
    emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{{2,}}', html)
    result["emails"] = list(set(emails))[:10]  # Unique, max 10
    
    # Extract HTML comments (often contain sensitive info)
    for comment in soup.find_all(string=lambda text: isinstance(text, str) and text.strip().startswith("<!--")):
        comment_text = comment.strip()
        if len(comment_text) > 10:
            result["comments"].append(comment_text[:200])
    
    print(json.dumps(result, indent=2))
    
except Exception as e:
    print(json.dumps({{"error": str(e), "url": "{url}"}}))
'''
    
    result = await shared_sandbox_manager.execute_python(scrape_script)
    return result


async def search_cve(query: str, **kwargs: Any) -> ExecResult:
    """
    Search CVE database for vulnerabilities.
    
    Args:
        query: Search term (e.g., "apache", "CVE-2021-44228", "log4j")
    
    Returns:
        ExecResult with CVE information
    """
    # Use NVD API (National Vulnerability Database)
    url = f"https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={query}&resultsPerPage=10"
    
    cmd = ["curl", "-s", "--max-time", "30", url]
    result = await shared_sandbox_manager.execute(cmd)
    return result


# Tool registration helper
def register_web_search_tools(registry):
    """Register web search tools with the tool registry."""
    from agents.tools.registry import ToolSpec
    
    registry.register(ToolSpec(
        name="google_search",
        description="Search Google for information about target. Use for OSINT gathering.",
        args_schema={
            "query": "Search query string",
            "num_results": "Number of results to return (default: 10)"
        },
        execute=search_google
    ))
    
    registry.register(ToolSpec(
        name="shodan_search",
        description="Search Shodan for exposed services and vulnerabilities. Use for finding open ports and services.",
        args_schema={
            "query": "Shodan search query (e.g., 'apache', 'port:3306')"
        },
        execute=search_shodan
    ))
    
    registry.register(ToolSpec(
        name="scrape_website",
        description="Scrape website content and extract forms, links, technology stack. Use for reconnaissance.",
        args_schema={
            "url": "Target URL to scrape"
        },
        execute=scrape_website
    ))
    
    registry.register(ToolSpec(
        name="search_cve",
        description="Search CVE database for known vulnerabilities. Use for vulnerability research.",
        args_schema={
            "query": "Search term (e.g., 'apache', 'log4j')"
        },
        execute=search_cve
    ))
    
    logger.info("Web search tools registered: google_search, shodan_search, scrape_website, search_cve")
