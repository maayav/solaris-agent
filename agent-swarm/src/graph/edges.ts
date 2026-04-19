import { z } from 'zod';

export const EdgeType = {
  PART_OF: 'PART_OF',
  DEPENDS_ON: 'DEPENDS_ON',
  UNLOCKS: 'UNLOCKS',
  AUTHENTICATED_VIA: 'AUTHENTICATED_VIA',
  HAS_CREDENTIAL: 'HAS_CREDENTIAL',
  FOUND_AT: 'FOUND_AT',
  LED_TO: 'LED_TO',
  EXPLOITS: 'EXPLOITS',
  EXTRACTED_FROM: 'EXTRACTED_FROM',
  CHAINS_INTO: 'CHAINS_INTO',
  NEXT_IN_CHAIN: 'NEXT_IN_CHAIN',
  ENRICHES: 'ENRICHES',
  IMPERSONATES: 'IMPERSONATES',
  ESCALATES_TO: 'ESCALATES_TO',
  FAILED_WITH: 'FAILED_WITH',
  RESOLVED_BY: 'RESOLVED_BY',
  AFFECTS: 'AFFECTS',
  LINKED_TO: 'LINKED_TO',
  BRIEF_FOR: 'BRIEF_FOR',
  SPECIALIZES: 'SPECIALIZES',
  BELIEF_EVIDENCE: 'BELIEF_EVIDENCE',
  CLAIMED_BY: 'CLAIMED_BY',
} as const;

export type EdgeType = typeof EdgeType[keyof typeof EdgeType];

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.nativeEnum(EdgeType),
  properties: z.record(z.unknown()).optional(),
});

export type Edge = z.infer<typeof EdgeSchema>;
