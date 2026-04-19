import { Hono } from 'hono'
import { getSupabase } from '../../infrastructure/supabase.js'

export const missionsRouter = new Hono()

missionsRouter.post('/', async (c) => {
  const body = await c.req.json()
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_missions')
    .insert({
      objective: body.objective,
      target: body.target,
      phase: 'planning',
      status: 'pending',
      mission_id: body.mission_id,
    })
    .select()
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json(data, 201)
})

missionsRouter.get('/', async (c) => {
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_missions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json(data || [])
})

missionsRouter.get('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_missions')
    .select('*')
    .eq('mission_id', missionId)
    .single()
  
  if (error) {
    return c.json({ error: 'Mission not found' }, 404)
  }
  
  return c.json(data)
})

missionsRouter.put('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const body = await c.req.json()
  const supabase = getSupabase()
  
  const { data, error } = await supabase
    .from('swarm_missions')
    .update(body)
    .eq('mission_id', missionId)
    .select()
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json(data)
})

missionsRouter.delete('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const supabase = getSupabase()
  
  const { error } = await supabase
    .from('swarm_missions')
    .delete()
    .eq('mission_id', missionId)
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json({ success: true })
})
