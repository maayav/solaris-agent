import { getConfig } from '../../config/index.js';

export interface TavilySearchOptions {
  query: string;
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
}

export interface TavilyResult {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
  sources: string[];
}

export async function tavilySearch(options: TavilySearchOptions): Promise<TavilyResult> {
  const config = getConfig();
  const apiKey = config.TAVILY_API_KEY;
  
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not configured');
  }

  const searchDepth = options.searchDepth || 'basic';
  const maxResults = options.maxResults || 5;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: options.query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    answer?: string;
    results: Array<{ title: string; url: string; content: string }>;
  };

  return {
    query: options.query,
    answer: data.answer,
    results: data.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content.slice(0, 500) + (r.content.length > 500 ? '...' : ''),
    })),
    sources: data.results.map(r => r.url),
  };
}

export interface NvdCveResult {
  id: string;
  description: string;
  published: string;
  lastModified: string;
  severity: string;
  baseScore: number | null;
  cvssVector: string | null;
  references: Array<{ url: string; source: string }>;
  affectedProducts: string[];
  totalAffected: number;
}

export async function nvdCveFetch(cveId: string): Promise<NvdCveResult> {
  const config = getConfig();
  const apiKey = config.NVD_API_KEY;

  const normalizedCveId = cveId.toUpperCase();
  
  if (!normalizedCveId.startsWith('CVE-')) {
    throw new Error('Invalid CVE ID format. Expected: CVE-YYYY-NNNNN');
  }

  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(normalizedCveId)}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  if (apiKey) {
    headers['apiKey'] = apiKey;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NVD API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
    
  const vulnerabilities = (data.vulnerabilities || []) as Array<Record<string, unknown>>;
  if (vulnerabilities.length === 0) {
    throw new Error(`CVE not found: ${normalizedCveId}`);
  }

  const vuln = vulnerabilities[0];
  if (!vuln) {
    throw new Error('Invalid NVD response structure');
  }
  
  const cve = (vuln.cve || {}) as Record<string, unknown>;
  
  const metrics = (cve.metrics || {}) as Record<string, unknown>;
  const cvssV31 = (metrics.cvssMetricV31 as Array<Record<string, unknown>>)?.[0];
  const cvssDataV31 = (cvssV31?.cvssData || {}) as Record<string, unknown>;
  
  const cvssV30 = (metrics.cvssMetricV30 as Array<Record<string, unknown>>)?.[0];
  const cvssDataV30 = (cvssV30?.cvssData || {}) as Record<string, unknown>;
  
  const cvssV2 = (metrics.cvssMetricV2 as Array<Record<string, unknown>>)?.[0];
  const cvssDataV2 = (cvssV2?.cvssData || {}) as Record<string, unknown>;
  
  const cvss = cvssDataV31 || cvssDataV30 || cvssDataV2;
  const severity = (cvssDataV31.baseSeverity as string) 
    || (cvssDataV30.baseSeverity as string) 
    || (cvssDataV2.baseSeverity as string) 
    || 'UNKNOWN';
  const vector = cvss.vectorString as string | undefined;
  const baseScore = cvss.baseScore as number | undefined;

  const descriptions = (cve.descriptions as Array<{ lang: string; value: string }>) || [];
  const englishDesc = descriptions.find(d => d.lang === 'en')?.value 
    || descriptions[0]?.value 
    || 'No description available';

  const affectedProducts: string[] = [];
  const configs = (cve.configurations as Array<Record<string, unknown>>) || [];
  for (const config of configs) {
    const nodes = (config.nodes as Array<Record<string, unknown>>) || [];
    for (const node of nodes) {
      const matches = (node.cpeMatch as Array<{ criteria: string; vulnerable: boolean }>) || [];
      for (const match of matches) {
        if (match.vulnerable) {
          affectedProducts.push(match.criteria);
        }
      }
    }
  }

  const refs = (cve.references as Array<{ url: string; source?: string }>) || [];

  return {
    id: normalizedCveId,
    description: englishDesc.slice(0, 1000) + (englishDesc.length > 1000 ? '...' : ''),
    published: (cve.published as string) || '',
    lastModified: (cve.lastModified as string) || '',
    severity,
    baseScore: baseScore ?? null,
    cvssVector: vector || null,
    references: refs.slice(0, 10).map(r => ({
      url: r.url,
      source: r.source || 'NVD',
    })),
    affectedProducts: affectedProducts.slice(0, 20),
    totalAffected: affectedProducts.length,
  };
}

export interface ExploitDbSearchResult {
  id: number;
  file: string;
  description: string;
  date: string;
  author: string;
  platform: string;
  port: string;
  type: string;
}

export async function exploitDbSearch(query: string, limit = 10): Promise<ExploitDbSearchResult[]> {
  const response = await fetch(
    `https://www.exploit-db.com/search?query=${encodeURIComponent(query)}`,
    {
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Exploit-DB search error: ${response.status}`);
  }

  const data = await response.json() as {
    results: Array<{
      id: number;
      iFile: string;
      description: string;
      date: string;
      author: string;
      platform: string;
      port: string;
      type: string;
    }>;
  };

  return (data.results || []).slice(0, limit).map(r => ({
    id: r.id,
    file: r.iFile,
    description: r.description,
    date: r.date,
    author: r.author,
    platform: r.platform,
    port: r.port,
    type: r.type,
  }));
}

export interface CisaKevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
}

export async function fetchCisaKev(): Promise<CisaKevEntry[]> {
  const response = await fetch(
    'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
  );

  if (!response.ok) {
    throw new Error(`CISA KEV fetch error: ${response.status}`);
  }

  const data = await response.json() as { vulnerabilities: CisaKevEntry[] };
  return data.vulnerabilities || [];
}

export async function searchCisaKev(query: string): Promise<CisaKevEntry[]> {
  const all = await fetchCisaKev();
  const lowerQuery = query.toLowerCase();
  
  return all.filter(
    entry =>
      entry.cveID.toLowerCase().includes(lowerQuery) ||
      entry.vulnerabilityName.toLowerCase().includes(lowerQuery) ||
      entry.product.toLowerCase().includes(lowerQuery) ||
      entry.shortDescription.toLowerCase().includes(lowerQuery)
  );
}

export async function jinaFetch(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  
  const response = await fetch(jinaUrl, {
    headers: {
      'Accept': 'text/plain',
    },
  });

  if (!response.ok) {
    throw new Error(`Jina fetch error: ${response.status}`);
  }

  return response.text();
}
