#!/usr/bin/env bun
/**
 * OSINT Utilities Test Script
 * Run: bun test-osint.ts
 */

import { tavilySearch, nvdCveFetch, searchCisaKev, jinaFetch } from './src/utils/osint/index.js';

async function testTavily() {
  console.log('\n=== Testing Tavily Search ===');
  try {
    const result = await tavilySearch({
      query: 'Log4j CVE-2021-44228 exploit',
      searchDepth: 'basic',
      maxResults: 3,
    });
    console.log('✓ TavilySearch works');
    console.log('  Answer:', result.answer?.slice(0, 200) + '...');
    console.log('  Sources:', result.sources.length);
    return true;
  } catch (error) {
    console.error('✗ TavilySearch failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function testNvdCve() {
  console.log('\n=== Testing NVD CVE Fetch ===');
  try {
    const result = await nvdCveFetch('CVE-2021-44228');
    console.log('✓ NVD CVE Fetch works');
    console.log('  ID:', result.id);
    console.log('  Severity:', result.severity);
    console.log('  CVSS:', result.baseScore);
    console.log('  Description:', result.description.slice(0, 100) + '...');
    return true;
  } catch (error) {
    console.error('✗ NVD CVE Fetch failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function testCisaKev() {
  console.log('\n=== Testing CISA KEV Search ===');
  try {
    const results = await searchCisaKev('microsoft');
    console.log('✓ CISA KEV Search works');
    console.log('  Found:', results.length, 'entries');
    if (results.length > 0) {
      console.log('  First:', results[0].cveID, '-', results[0].vulnerabilityName.slice(0, 50));
    }
    return true;
  } catch (error) {
    console.error('✗ CISA KEV Search failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function testJinaFetch() {
  console.log('\n=== Testing Jina Fetch ===');
  try {
    const content = await jinaFetch('https://example.com');
    console.log('✓ Jina Fetch works');
    console.log('  Content length:', content.length);
    console.log('  First 100 chars:', content.slice(0, 100).replace(/\n/g, ' '));
    return true;
  } catch (error) {
    console.error('✗ Jina Fetch failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     OSINT Utilities Test Suite        ║');
  console.log('╚════════════════════════════════════════╝');

  const results = await Promise.all([
    testTavily(),
    testNvdCve(),
    testCisaKev(),
    testJinaFetch(),
  ]);

  const passed = results.filter(Boolean).length;
  const failed = results.filter(r => !r).length;

  console.log('\n╔════════════════════════════════════════╗');
  console.log(`║     Results: ${passed} passed, ${failed} failed         ║`);
  console.log('╚════════════════════════════════════════╝');

  process.exit(failed > 0 ? 1 : 0);
}

main();
