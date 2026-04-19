import { getConfig } from '../../../config/index.js';

interface NvdCveArgs {
  cve_id: string;
}

export async function nvdCveFetch(args: NvdCveArgs): Promise<string> {
  const config = getConfig();
  const apiKey = config.NVD_API_KEY;

  if (!args.cve_id) {
    return JSON.stringify({ error: 'cve_id is required' });
  }

  const cveId = args.cve_id.toUpperCase();
  
  if (!cveId.startsWith('CVE-')) {
    return JSON.stringify({ error: 'Invalid CVE ID format. Expected: CVE-YYYY-NNNNN' });
  }

  try {
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['apiKey'] = apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({ 
        error: `NVD API error: ${response.status}`,
        details: errorText 
      });
    }

    const data = await response.json() as Record<string, unknown>;
    
    const vulnerabilities = (data.vulnerabilities || []) as Array<Record<string, unknown>>;
    if (vulnerabilities.length === 0) {
      return JSON.stringify({ error: `CVE not found: ${cveId}` });
    }

    const vuln = vulnerabilities[0];
    if (!vuln) {
      return JSON.stringify({ error: 'Invalid NVD response structure' });
    }
    
    const cve = (vuln.cve || {}) as Record<string, unknown>;
    
    if (!cve) {
      return JSON.stringify({ error: 'Invalid NVD response structure' });
    }
    
    const metrics = cve.metrics as Record<string, unknown> | undefined;
    const cvssV31 = (metrics?.cvssMetricV31 as Array<Record<string, unknown>>)?.[0];
    const cvssDataV31 = cvssV31?.cvssData as Record<string, unknown> | undefined;
    
    const cvssV30 = (metrics?.cvssMetricV30 as Array<Record<string, unknown>>)?.[0];
    const cvssDataV30 = cvssV30?.cvssData as Record<string, unknown> | undefined;
    
    const cvssV2 = (metrics?.cvssMetricV2 as Array<Record<string, unknown>>)?.[0];
    const cvssDataV2 = cvssV2?.cvssData as Record<string, unknown> | undefined;
    
    const cvss = cvssDataV31 || cvssDataV30 || cvssDataV2;
    const severity = (cvssDataV31?.baseSeverity as string) 
      || (cvssDataV30?.baseSeverity as string) 
      || (cvssDataV2?.baseSeverity as string);
    const vector = cvss?.vectorString as string | undefined;
    const baseScore = cvss?.baseScore as number | undefined;

    const descriptions = (cve.descriptions as Array<{ lang: string; value: string }>) || [];
    const englishDesc = descriptions.find(d => d.lang === 'en')?.value 
      || descriptions[0]?.value 
      || 'No description available';

    const affectedVersions: string[] = [];
    const configs = (cve.configurations as Array<Record<string, unknown>>) || [];
    for (const cfg of configs) {
      const nodes = (cfg.nodes as Array<Record<string, unknown>>) || [];
      for (const node of nodes) {
        const matches = (node.cpeMatch as Array<{ criteria: string; vulnerable: boolean }>) || [];
        for (const match of matches) {
          if (match.vulnerable) {
            affectedVersions.push(match.criteria);
          }
        }
      }
    }

    const references = ((cve.references as Array<{ url: string; source?: string }>) || [])
      .slice(0, 10)
      .map(r => ({
        url: r.url,
        source: r.source || 'NVD',
      }));

    const result = {
      id: cveId,
      description: englishDesc.slice(0, 1000) + (englishDesc.length > 1000 ? '...' : ''),
      published: cve.published as string,
      lastModified: cve.lastModified as string,
      severity: severity || 'UNKNOWN',
      baseScore: baseScore ?? null,
      cvssVector: vector || null,
      references,
      affectedProducts: affectedVersions.slice(0, 20),
      totalAffected: affectedVersions.length,
    };

    return JSON.stringify(result, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `NVD fetch failed: ${errorMessage}` });
  }
}
