import { Hono } from 'hono'
import { getSupabase } from '../../infrastructure/supabase.js'

export const eventsRouter = new Hono()

eventsRouter.get('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_events')
    .select('*')
    .eq('mission_id', missionId)
    .order('timestamp', { ascending: true })
    .limit(100)
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json(data || [])
})

eventsRouter.post('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const body = await c.req.json()
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_events')
    .insert({
      mission_id: missionId,
      event_type: body.event_type,
      event_data: body.event_data,
      agent: body.agent,
    })
    .select()
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json(data, 201)
})
