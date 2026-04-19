import { Hono } from 'hono'
import { buildRedTeamGraph, createInitialState } from '../../agents/graph.js'
import { getSupabase } from '../../infrastructure/supabase.js'

export const executeRouter = new Hono()

executeRouter.post('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const body = await c.req.json().catch(() => ({}))
  const supabase = getSupabase()
  
  const { data: mission, error: fetchError } = await supabase
    .from('swarm_missions')
    .select('*')
    .eq('mission_id', missionId)
    .single()
  
  if (fetchError || !mission) {
    return c.json({ error: 'Mission not found' }, 404)
  }

  try {
    const initialState = createInitialState({
      mission_id: missionId,
      objective: mission.objective,
      target: mission.target,
      max_iterations: body.max_iterations ?? 5,
      max_cost_usd: body.max_cost_usd ?? 2.0,
      max_duration_seconds: body.max_duration_seconds ?? 3600,
      mode: body.mode ?? 'live',
      authorization: body.authorization,
    })
    
    const graph = buildRedTeamGraph()
    const finalState = await graph.run(initialState)
    
    await supabase
      .from('swarm_missions')
      .update({
        phase: finalState.phase,
        status: finalState.phase === 'complete' ? 'completed' : 'executing',
        completed_at: finalState.phase === 'complete' ? new Date().toISOString() : null,
      })
      .eq('mission_id', missionId)
    
    return c.json({
      mission_id: missionId,
      status: finalState.phase === 'complete' ? 'completed' : 'executing',
      phase: finalState.phase,
      iteration: finalState.iteration,
      findings: {
        recon: finalState.recon_results.length,
        exploits: finalState.exploit_results.length,
        successful: finalState.exploit_results.filter(e => e.success).length,
      },
      coverage_score: finalState.coverage_score,
      cost_usd: finalState.cost_usd,
    })
  } catch (error) {
    await supabase
      .from('swarm_missions')
      .update({
        status: 'failed',
        error: String(error),
      })
      .eq('mission_id', missionId)
    
    return c.json({ 
      error: 'Mission execution failed', 
      details: String(error) 
    }, 500)
  }
})
