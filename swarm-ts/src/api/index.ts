import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { missionsRouter } from './routes/missions.js'
import { executeRouter } from './routes/execute.js'
import { eventsRouter } from './routes/events.js'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
}))

app.route('/api/missions', missionsRouter)
app.route('/api/missions', executeRouter)
app.route('/api/events', eventsRouter)

app.get('/health', (c) => c.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
  service: 'swarm-api'
}))

app.get('/', (c) => c.json({
  name: 'VibeCheck SWARM API',
  version: '1.0.0',
  docs: '/docs',
}))

export default app
