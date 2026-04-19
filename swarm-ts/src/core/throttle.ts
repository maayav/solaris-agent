import { randomInt } from 'crypto'

const MODES = {
  normal: { rps: 10, jitter_ms: 200 },
  stealth: { rps: 2, jitter_ms: 2000, ua_rotate: true },
  fast: { rps: 50, jitter_ms: 0 },
}

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
]

export interface ThrottleContext {
  ua?: string
  acquired: boolean
}

export class MissionThrottle {
  private config: typeof MODES.normal
  private rng: () => number
  private tokens: number
  private last: number

  constructor(mode: 'normal' | 'stealth' | 'fast' = 'normal') {
    this.config = MODES[mode]
    this.rng = () => randomInt(0, 1000) / 1000
    this.tokens = this.config.rps
    this.last = Date.now()
  }

  async acquire(): Promise<ThrottleContext> {
    while (this.tokens < 1) {
      await new Promise(r => setTimeout(r, 10))
      this.refill()
    }
    
    this.tokens--
    
    const jitter = (this.config.jitter_ms / 1000) * this.rng()
    if (jitter > 0) {
      await new Promise(r => setTimeout(r, jitter))
    }

    return {
      ua: this.config.ua_rotate ? this.rotateUA() : undefined,
      acquired: true,
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.last) / 1000
    const refill = elapsed * this.config.rps
    this.tokens = Math.min(this.config.rps, this.tokens + refill)
    this.last = now
  }

  private rotateUA(): string {
    return STEALTH_USER_AGENTS[randomInt(STEALTH_USER_AGENTS.length)]
  }

  setMode(mode: 'normal' | 'stealth' | 'fast'): void {
    this.config = MODES[mode]
    this.tokens = this.config.rps
    this.last = Date.now()
  }
}
