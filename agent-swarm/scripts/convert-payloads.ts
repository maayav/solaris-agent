#!/usr/bin/env bun
/**
 * Payload Converter
 * Converts PayloadsAllTheThings and SecLists to overlay format
 * Run: bun scripts/convert-payloads.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, readdir } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAYLOADS_DIR = join(__dirname, '..', 'payloads');
const OUTPUT_DIR = join(__dirname, '..', 'prompt-overlays-generated');

const TYPE_MAPPING: Record<string, string> = {
  'SQL Injection': 'sqli',
  'SQL Injection': 'sqli',
  'Cross Site Scripting': 'xss',
  'XSS': 'xss',
  'Command Injection': 'command_injection',
  'Directory Traversal': 'path_traversal',
  'File Inclusion': 'file_inclusion',
  'XXE': 'xxe',
  'SSRF': 'ssrf',
  'Open Redirect': 'open_redirect',
  'OAuth': 'oauth',
  'JWT': 'jwt',
  'IDOR': 'idor',
  'GraphQL Injection': 'graphql',
  ' LDAP Injection': 'ldap_injection',
  'SSTI': 'ssti',
  'Template Injection': 'ssti',
  'Race Condition': 'race_condition',
  'Web Shell': 'webshell',
  'CRLF Injection': 'crlf',
  'HTTP Parameter Pollution': 'hpp',
};

interface ParsedPayload {
  category: string;
  escalation: 'baseline' | 'aggressive' | 'evasive';
  lines: string[];
}

function normalizeType(type: string): string {
  const lower = type.toLowerCase();
  if (TYPE_MAPPING[type]) return TYPE_MAPPING[type];
  
  for (const [key, value] of Object.entries(TYPE_MAPPING)) {
    if (lower.includes(key.toLowerCase())) return value;
  }
  
  return type.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
}

function extractPayloadsFromMarkdown(content: string): ParsedPayload[] {
  const payloads: ParsedPayload[] = [];
  const lines = content.split('\n');
  
  let currentSection = 'General';
  let currentEscalation: 'baseline' | 'aggressive' | 'evasive' = 'baseline';
  let currentLines: string[] = [];
  let inCodeBlock = false;
  
  for (const line of lines) {
    if (line.startsWith('### ') || line.startsWith('## ')) {
      if (currentLines.length > 0) {
        payloads.push({
          category: currentSection,
          escalation: currentEscalation,
          lines: [...currentLines],
        });
        currentLines = [];
      }
      
      let header = line.replace(/^#{1,3}\s*/, '').trim();
      
      if (header.includes('(Baseline)')) {
        currentEscalation = 'baseline';
        header = header.replace(/\s*\(Baseline\)/, '');
      } else if (header.includes('(Aggressive)')) {
        currentEscalation = 'aggressive';
        header = header.replace(/\s*\(Aggressive\)/, '');
      } else if (header.includes('(Evasive)')) {
        currentEscalation = 'evasive';
        header = header.replace(/\s*\(Evasive\)/, '');
      } else if (header.includes('Bypass') || header.includes('Evasion')) {
        currentEscalation = 'aggressive';
      }
      
      currentSection = header;
    }
    
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    
    if (inCodeBlock && line.trim() && !line.startsWith('#')) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length < 500) {
        currentLines.push(trimmed);
      }
    }
  }
  
  if (currentLines.length > 0) {
    payloads.push({
      category: currentSection,
      escalation: currentEscalation,
      lines: currentLines,
    });
  }
  
  return payloads.filter(p => p.lines.length > 0);
}

function convertPayloadsAllTheThings(): void {
  const baseDir = join(PAYLOADS_DIR, 'PayloadsAllTheThings');
  
  if (!existsSync(baseDir)) {
    console.warn('[converter] PayloadsAllTheThings not found at', baseDir);
    return;
  }
  
  const categories = readdirSync(baseDir).filter(f => {
    if (f.startsWith('.') || f.startsWith('README')) return false;
    const fullPath = join(baseDir, f);
    try {
      readdirSync(fullPath);
      return true;
    } catch {
      return false;
    }
  });
  
  console.log(`[converter] Processing ${categories.length} categories from PayloadsAllTheThings`);
  
  for (const category of categories) {
    const categoryDir = join(baseDir, category);
    const mdFiles = readdirSync(categoryDir).filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) continue;
    
    const normalizedType = normalizeType(category);
    const outputFile = join(OUTPUT_DIR, `${normalizedType}.json`);
    
    const allPayloads: ParsedPayload[] = [];
    
    for (const mdFile of mdFiles) {
      const filePath = join(categoryDir, mdFile);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const payloads = extractPayloadsFromMarkdown(content);
        allPayloads.push(...payloads);
      } catch (e) {
        console.warn(`[converter] Failed to read ${mdFile}:`, e.message);
      }
    }
    
    if (allPayloads.length > 0) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const jsonContent = JSON.stringify({
        source: 'PayloadsAllTheThings',
        exploit_type: normalizedType,
        original_category: category,
        payloads: allPayloads,
        converted_at: new Date().toISOString(),
      }, null, 2);
      writeFileSync(outputFile, jsonContent);
      
      if (normalizedType === 'sqli') {
        writeFileSync(join(OUTPUT_DIR, 'sql_injection.json'), jsonContent);
      }
      if (normalizedType === 'xss') {
        writeFileSync(join(OUTPUT_DIR, 'cross_site_scripting.json'), jsonContent);
      }
      if (normalizedType === 'command_injection') {
        writeFileSync(join(OUTPUT_DIR, 'commandinjection.json'), jsonContent);
      }
      if (normalizedType === 'path_traversal') {
        writeFileSync(join(OUTPUT_DIR, 'directory_traversal.json'), jsonContent);
      }
      if (normalizedType === 'json_web_token') {
        writeFileSync(join(OUTPUT_DIR, 'jwt.json'), jsonContent);
      }
      if (normalizedType === 'ssti') {
        writeFileSync(join(OUTPUT_DIR, 'server_side_template_injection.json'), jsonContent);
      }
      console.log(`  ✓ ${category} -> ${normalizedType}.json (${allPayloads.length} payloads)`);
    }
  }
}

function convertSecLists(): void {
  const baseDir = join(PAYLOADS_DIR, 'SecLists', 'Fuzzing');
  
  if (!existsSync(baseDir)) {
    console.warn('[converter] SecLists/Fuzzing not found');
    return;
  }
  
  const fuzzFiles = readdirSync(baseDir).filter(f => f.endsWith('.txt') || f.endsWith('.lst'));
  
  console.log(`[converter] Processing ${fuzzFiles.length} wordlists from SecLists/Fuzzing`);
  
  for (const fuzzFile of fuzzFiles) {
    const filePath = join(baseDir, fuzzFile);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#'));
      
      if (lines.length < 3) continue;
      
      const baseName = fuzzFile.replace(/\.(txt|lst)$/i, '');
      const normalizedType = normalizeType(baseName);
      const outputFile = join(OUTPUT_DIR, `${normalizedType}_wordlist.json`);
      
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(outputFile, JSON.stringify({
        source: 'SecLists',
        type: 'wordlist',
        name: baseName,
        payloads: [{
          category: baseName,
          escalation: 'baseline',
          lines: lines.slice(0, 500),
        }],
        converted_at: new Date().toISOString(),
      }, null, 2));
      console.log(`  ✓ ${fuzzFile} -> ${normalizedType}_wordlist.json (${lines.length} entries)`);
    } catch (e) {
      console.warn(`[converter] Failed to process ${fuzzFile}:`, e.message);
    }
  }
}

function main(): void {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║         Payload Converter                          ║');
  console.log('║  PayloadsAllTheThings + SecLists -> Overlays       ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  
  console.log('Input dirs:');
  console.log('  ', join(PAYLOADS_DIR, 'PayloadsAllTheThings'));
  console.log('  ', join(PAYLOADS_DIR, 'SecLists'));
  console.log('Output dir:', OUTPUT_DIR);
  console.log();
  
  mkdirSync(OUTPUT_DIR, { recursive: true });
  
  console.log('Converting PayloadsAllTheThings...');
  convertPayloadsAllTheThings();
  
  console.log('\nConverting SecLists wordlists...');
  convertSecLists();
  
  const outputFiles = readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
  console.log(`\n✓ Conversion complete: ${outputFiles.length} overlay files generated`);
  console.log('Output:', OUTPUT_DIR);
  
  console.log('\nSample files:');
  for (const f of outputFiles.slice(0, 5)) {
    console.log('  -', f);
  }
}

main();
