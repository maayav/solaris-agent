import { createClient, SupabaseClient as SupabaseSDK } from "@supabase/supabase-js";

interface SupabaseClientOptions {
  url: string;
  serviceKey: string;
}

export class SupabaseClient {
  private client: SupabaseSDK | null = null;
  private _isConnected = false;

  constructor(private options: SupabaseClientOptions) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    this.client = createClient(
      this.options.url,
      this.options.serviceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
    this._isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this._isConnected = false;
  }

  from(table: string) {
    if (!this.client) throw new Error("Client not connected");
    return this.client.from(table);
  }

  async insert<T = Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ): Promise<T | null> {
    if (!this.client) throw new Error("Client not connected");

    const { data: result, error } = await this.client.from(table).insert(data as Record<string, unknown>).select().single();

    if (error) {
      console.error("Supabase insert error:", error);
      return null;
    }

    return result as T;
  }

  async insertMany<T = Record<string, unknown>>(
    table: string,
    data: Partial<T>[]
  ): Promise<T[] | null> {
    if (!this.client) throw new Error("Client not connected");

    const { data: result, error } = await this.client.from(table).insert(data as Record<string, unknown>[]).select();

    if (error) {
      console.error("Supabase insertMany error:", error);
      return null;
    }

    return result as T[];
  }

  update<T = Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ) {
    if (!this.client) throw new Error("Client not connected");
    return this.client.from(table).update(data as Record<string, unknown>);
  }

  delete(table: string) {
    if (!this.client) throw new Error("Client not connected");
    return this.client.from(table).delete();
  }

  async query<T = Record<string, unknown>>(
    table: string,
    options?: {
      select?: string;
      where?: Record<string, unknown>;
      limit?: number;
      orderBy?: { column: string; ascending?: boolean };
    }
  ): Promise<T[]> {
    if (!this.client) throw new Error("Client not connected");

    let query = this.client.from(table).select(options?.select || "*");

    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        query = query.eq(key, value);
      }
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? true,
      });
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase query error:", error);
      return [];
    }

    return data as T[];
  }

  async listSwarmMissions(limit = 20, offset = 0) {
    return this.query("swarm_missions", {
      orderBy: { column: "created_at", ascending: false },
      limit,
    });
  }

  async createSwarmMission(missionId: string, target: string, objective: string, mode: string, maxIterations: number, scanId?: string) {
    return this.insert("swarm_missions", {
      id: missionId,
      target,
      objective,
      mode,
      max_iterations: maxIterations,
      scan_id: scanId,
      status: "pending",
      progress: 0,
      iteration: 0,
    });
  }

  async getSwarmMission(missionId: string) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("swarm_missions").select("*").eq("id", missionId).single();
    if (error) return null;
    return data;
  }

  async updateSwarmMission(missionId: string, updates: Record<string, unknown>) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("swarm_missions").update(updates).eq("id", missionId).select().single();
    if (error) return null;
    return data;
  }

  async getSwarmAgentStates(missionId: string) {
    return this.query("swarm_agent_states", {
      where: { mission_id: missionId },
      orderBy: { column: "created_at", ascending: true },
    });
  }

  async createSwarmAgentState(
    missionId: string,
    agentId: string,
    agentName: string,
    agentTeam: string,
    status: string,
    iter: string,
    task: string
  ) {
    return this.insert("swarm_agent_states", {
      mission_id: missionId,
      agent_id: agentId,
      agent_name: agentName,
      agent_team: agentTeam,
      status,
      iter,
      task,
      last_updated: new Date().toISOString(),
    });
  }

  async getSwarmAgentEvents(missionId: string, limit = 100, agentName?: string) {
    if (!this.client) throw new Error("Client not connected");
    let q = this.client.from("swarm_agent_events").select("*").eq("mission_id", missionId).order("created_at", { ascending: false }).limit(limit);
    if (agentName) q = q.eq("agent_name", agentName);
    const { data, error } = await q;
    if (error) return [];
    return data;
  }

  async getSwarmFindings(missionId: string) {
    return this.query("swarm_findings", { where: { mission_id: missionId } });
  }

  async getSwarmEvents(missionId: string, limit = 100, eventType?: string, agentName?: string, iteration?: number) {
    if (!this.client) throw new Error("Client not connected");
    let q = this.client.from("swarm_events").select("*").eq("mission_id", missionId).order("created_at", { ascending: false }).limit(limit);
    if (eventType) q = q.eq("event_type", eventType);
    if (agentName) q = q.eq("agent_name", agentName);
    if (iteration !== undefined) q = q.eq("iteration", iteration);
    const { data, error } = await q;
    if (error) return [];
    return data;
  }

  async getMissionTimeline(missionId: string) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("mission_timeline").select("*").eq("mission_id", missionId).order("created_at", { ascending: true });
    if (error) return [];
    return data;
  }

  async getMissionStatistics(missionId: string) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("mission_statistics").select("*").eq("mission_id", missionId).single();
    if (error) return null;
    return data;
  }

  async getScanStatus(scanId: string) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("scan_queue").select("*").eq("id", scanId).single();
    if (error) return null;
    return data;
  }

  async updateScanStatus(
    scanId: string,
    status: string,
    progress: number = 0,
    errorMessage?: string,
    currentStage?: string,
    stageOutput?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.client) throw new Error("Client not connected");

    const updateData: Record<string, unknown> = {
      status,
      progress,
    };

    if (status === "running" && progress === 0) {
      updateData.started_at = new Date().toISOString();
    } else if (status === "completed" || status === "failed") {
      updateData.completed_at = new Date().toISOString();
    }

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    if (currentStage) {
      updateData.current_stage = currentStage;
    }

    if (stageOutput) {
      updateData.stage_output = stageOutput;
    }

    const { error } = await this.client.from("scan_queue").update(updateData).eq("id", scanId);
    return !error;
  }

  async createScan(scanId: string, repoUrl: string, triggeredBy: string = "unknown") {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("scan_queue").insert({
      id: scanId,
      repo_url: repoUrl,
      triggered_by: triggeredBy,
      status: "pending",
      progress: 0,
    }).select().single();

    if (error) return null;
    return data;
  }

  async getVulnerabilities(scanId: string) {
    if (!this.client) throw new Error("Client not connected");
    const { data, error } = await this.client.from("vulnerabilities").select("*").eq("scan_id", scanId);
    if (error) return [];
    return data || [];
  }

  async insertVulnerability(scanId: string, vuln: Record<string, unknown>) {
    if (!this.client) throw new Error("Client not connected");
    const vulnData = { ...vuln, scan_id: scanId };
    const { data, error } = await this.client.from("vulnerabilities").insert(vulnData).select().single();
    if (error) return null;
    return data;
  }

  async insertVulnerabilitiesBatch(scanId: string, vulns: Record<string, unknown>[]) {
    if (!this.client) throw new Error("Client not connected");
    if (!vulns.length) return [];

    const scanCheck = await this.client.from("scan_queue").select("id").eq("id", scanId).single();
    if (scanCheck.error || !scanCheck.data) {
      throw new Error(`Scan ID ${scanId} not found in scan_queue table`);
    }

    const vulnsData = vulns.map(v => ({ ...v, scan_id: scanId }));
    const { data, error } = await this.client
      .from("vulnerabilities")
      .upsert(vulnsData, { onConflict: "scan_id,file_path,line_start" })
      .select();

    if (error) throw error;
    return data || [];
  }

  async getReport(scanId: string) {
    if (!this.client) throw new Error("Client not connected");

    const { data: scan, error: scanError } = await this.client
      .from("scan_queue")
      .select("*")
      .eq("id", scanId)
      .single();

    if (scanError || !scan) return null;

    const { data: vulns, error: vulnsError } = await this.client
      .from("vulnerabilities")
      .select("*")
      .eq("scan_id", scanId);

    return {
      scan,
      vulnerabilities: vulns || [],
    };
  }

  async listScans(status?: string, limit: number = 50, offset: number = 0) {
    if (!this.client) throw new Error("Client not connected");

    let query = this.client.from("scan_queue").select("*", { count: "exact" });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: scans, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return { scans: [], total: 0 };
    }

    return {
      scans: scans || [],
      total: count ?? scans?.length ?? 0,
    };
  }

  async getSwarmExploitAttempts(missionId: string, limit = 500, exploitType?: string, success?: boolean) {
    if (!this.client) throw new Error("Client not connected");
    let q = this.client.from("swarm_exploit_attempts").select("*").eq("mission_id", missionId).order("created_at", { ascending: false }).limit(limit);
    if (exploitType) q = q.eq("exploit_type", exploitType);
    if (success !== undefined) q = q.eq("success", success);
    const { data, error } = await q;
    if (error) return [];
    return data;
  }
}

export const supabaseClient = new SupabaseClient({
  url: process.env.SUPABASE_URL || "",
  serviceKey: process.env.SUPABASE_SERVICE_KEY || "",
});