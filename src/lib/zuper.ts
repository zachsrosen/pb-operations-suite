/**
 * Zuper FSM API Client
 *
 * Integration with Zuper Field Service Management for:
 * - Site Surveys
 * - Installations
 * - Inspections
 *
 * API Documentation: https://developers.zuper.co
 */

// Types for Zuper API
export interface ZuperJobCategory {
  category_uid: string;
  category_name: string;
  category_color?: string;
  estimated_duration?: {
    days: number;
    hours: number;
    minutes: number;
  };
}

// Zuper assignment format for creating/updating jobs
export interface ZuperAssignment {
  user_uid: string;
  team_uid?: string;
}

export interface ZuperJob {
  job_uid?: string;
  job_title: string;
  job_category?: string | ZuperJobCategory; // Can be UID string (for create) or object (from GET)
  job_priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  job_type?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  due_date?: string;
  customer_uid?: string;
  customer_address?: ZuperAddress;
  // assigned_to format differs between POST (create) and GET (read)
  // For create: array of { user_uid, team_uid? }
  // For read: array of { user: { first_name, last_name, ... } }
  // NOTE: Zuper API only allows setting assigned_to at CREATION time, not updates!
  assigned_to?: ZuperAssignment[] | { user: { first_name?: string; last_name?: string; user_uid?: string } }[];
  job_tags?: string[];
  // custom_fields can be an array (from GET) or object (for POST)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_fields?: any;
  job_notes?: string;
  status?: string;
  // Zuper API returns the actual job status here (not in `status`)
  current_job_status?: {
    status_uid?: string;
    status_name?: string;
    status_color?: string;
  };
}

export interface ZuperAddress {
  street: string;
  city: string;
  state: string;
  zip_code: string;
  country?: string;
  geo_coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface ZuperCustomer {
  customer_uid?: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_company_name?: string;
  customer_address?: ZuperAddress;
}

export interface ZuperUser {
  user_uid: string;
  first_name: string;
  last_name: string;
  email: string;
  role?: string;
  skills?: string[];
  team_uid?: string;
}

export interface ZuperUserFull {
  user_uid: string;
  first_name: string;
  last_name: string;
  email: string;
  designation?: string;
  role?: { role_uid?: string; role_name?: string };
  home_phone_number?: string;
  work_phone_number?: string;
  mobile_phone_number?: string;
  profile_picture?: string;
  is_active?: boolean;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ZuperTeamDetail {
  team_uid: string;
  team_name: string;
  team_description?: string;
  team_color?: string;
  users?: Array<{
    user_uid: string;
    first_name: string;
    last_name: string;
    email?: string;
    designation?: string;
  }>;
}

export interface ZuperApiResponse<T> {
  type: "success" | "error";
  data?: T;
  message?: string;
  error?: string;
}

interface ZuperAssignmentRef {
  userUid: string;
  teamUid?: string;
}

export interface AssistedSchedulingSlot {
  date: string; // YYYY-MM-DD
  start_time: string;
  end_time: string;
  user_uid?: string;
  user_name?: string;
  team_uid?: string;
  team_name?: string;
  available: boolean;
}

export interface TimeOffRequest {
  timeoff_uid: string;
  user_uid: string;
  user_name?: string;
  start_date: string;
  end_date: string;
  start_time?: string;
  end_time?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  all_day?: boolean;
  reason?: string;
}

// Job categories mapping for PB workflows - using Zuper category UIDs
// These UIDs are specific to the photonbrothers Zuper account
export const JOB_CATEGORY_UIDS = {
  SITE_SURVEY: "002bac33-84d3-4083-a35d-50626fc49288",
  CONSTRUCTION: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf",
  INSPECTION: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65",
  SERVICE_VISIT: "cff6f839-c043-46ee-a09f-8d0e9f363437",
  SERVICE_REVISIT: "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de",
  ADDITIONAL_VISIT: "d83c054f-69c1-470c-964c-2b79e88258f4",
  DETACH: "d9d888a1-efc3-4f01-a8d6-c9e867374d71",
  RESET: "43df49e9-3835-48f2-80ca-cc77ad7c3f0d",
  DNR_INSPECTION: "a5e54b76-8b79-4cd7-a960-bad53d24e1c5",
} as const;

// Human-readable category names (for display/logging)
export const JOB_CATEGORIES = {
  SITE_SURVEY: "Site Survey",
  CONSTRUCTION: "Construction",
  INSPECTION: "Inspection",
  SERVICE_VISIT: "Service Visit",
  SERVICE_REVISIT: "Service Revisit",
  ADDITIONAL_VISIT: "Additional Visit",
  DETACH: "Detach",
  RESET: "Reset",
  DNR_INSPECTION: "D&R Inspection",
} as const;

// Job type mapping based on project type
export const JOB_TYPES = {
  SOLAR: "Solar Installation",
  BATTERY: "Battery Installation",
  EV_CHARGER: "EV Charger Installation",
  SOLAR_BATTERY: "Solar + Battery",
  SOLAR_EV: "Solar + EV Charger",
  FULL_SYSTEM: "Full System",
} as const;

export class ZuperClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.ZUPER_API_KEY || "";
    // Zuper uses region-specific API URLs. The correct URL for your account
    // can be retrieved from https://accounts.zuperpro.com/api/config
    // For photonbrothers: https://us-west-1c.zuperpro.com/api
    this.baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

    if (!this.apiKey) {
      console.warn("ZUPER_API_KEY not configured - Zuper integration disabled");
    }
  }

  /**
   * Get the web app URL for a Zuper job
   * The web app uses the same region-specific domain as the API
   */
  static getJobWebUrl(jobUid: string): string {
    // Use environment variable if set, otherwise derive from API URL
    const webBaseUrl = process.env.ZUPER_WEB_URL ||
      (process.env.ZUPER_API_URL?.replace("/api", "") || "https://us-west-1c.zuperpro.com");
    return `${webBaseUrl}/app/job/${jobUid}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 30000
  ): Promise<ZuperApiResponse<T>> {
    if (!this.apiKey) {
      return { type: "error", error: "Zuper API key not configured" };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        return {
          type: "error",
          error: data.message || `HTTP ${response.status}`,
        };
      }

      return { type: "success", data };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.error(`Zuper API timeout after ${timeoutMs}ms:`, endpoint);
        return { type: "error", error: `Request timeout after ${timeoutMs}ms` };
      }
      console.error("Zuper API error:", error);
      return {
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ========== JOB OPERATIONS ==========

  /**
   * Create a new job/work order in Zuper
   * Note: Zuper API expects the job to be wrapped in a "job" object
   * Note: assigned_to can ONLY be set during creation, not on updates!
   */
  async createJob(job: ZuperJob): Promise<ZuperApiResponse<ZuperJob>> {
    console.log(`[ZuperClient.createJob] Creating job with payload:`, JSON.stringify({ job }, null, 2));
    return this.request<ZuperJob>("/jobs", {
      method: "POST",
      body: JSON.stringify({ job }),
    });
  }

  /**
   * Get a job by ID
   */
  async getJob(jobUid: string): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>(`/jobs/${jobUid}`);
  }

  /**
   * Update an existing job
   * Zuper uses PUT /jobs with job object containing job_uid
   */
  async updateJob(
    jobUid: string,
    updates: Partial<ZuperJob>
  ): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>(`/jobs`, {
      method: "PUT",
      body: JSON.stringify({
        job: {
          job_uid: jobUid,
          ...updates,
        },
      }),
    });
  }

  /**
   * Format a date for Zuper API (uses "YYYY-MM-DD HH:mm:ss" format, not ISO)
   */
  private formatZuperDateTime(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private extractAssignedUserUids(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jobData: any
  ): string[] {
    const assignedTo = jobData?.assigned_to;
    if (!Array.isArray(assignedTo)) return [];
    return assignedTo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((a: any) => a?.user?.user_uid || a?.user_uid)
      .filter((uid: unknown): uid is string => typeof uid === "string" && uid.length > 0);
  }

  private isJobUnscheduled(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jobData: any
  ): boolean {
    const statusName = String(jobData?.current_job_status?.status_name || jobData?.status || "").toUpperCase();
    const statusImpliesUnscheduled = statusName.includes("UNSCHEDULED");
    const noStart = !jobData?.scheduled_start_time;
    const noEnd = !jobData?.scheduled_end_time;
    return statusImpliesUnscheduled || (noStart && noEnd);
  }

  /**
   * Reschedule a job by updating its scheduled times and optionally assign users
   * Zuper uses PUT /jobs/schedule with job_uid, from_date, to_date at top level
   */
  async rescheduleJob(
    jobUid: string,
    scheduledStartTime: string,
    scheduledEndTime: string,
    userUids?: string[],
    teamUid?: string
  ): Promise<ZuperApiResponse<ZuperJob>> {
    // First reschedule the job times
    const scheduleResult = await this.request<ZuperJob>(`/jobs/schedule`, {
      method: "PUT",
      body: JSON.stringify({
        job_uid: jobUid,
        from_date: this.formatZuperDateTime(scheduledStartTime),
        to_date: this.formatZuperDateTime(scheduledEndTime),
      }),
    });

    // If we have user UIDs to assign, try to assign (but don't fail the whole operation)
    let assignmentFailed = false;
    let assignmentError = "";
    if (scheduleResult.type === "success" && userUids && userUids.length > 0) {
      // Get team UID and current assignments from the job
      let resolvedTeamUid = teamUid;
      let currentAssignments: ZuperAssignmentRef[] = [];
      const jobResult = await this.getJob(jobUid);
      if (jobResult.type === "success" && jobResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobData = jobResult.data as any;
        if (!resolvedTeamUid) {
          resolvedTeamUid = jobData.assigned_to_team?.[0]?.team?.team_uid;
          console.log(`[Zuper] Got team_uid from job: ${resolvedTeamUid}`);
        }
        // Collect currently-assigned users so we can unassign by user/team.
        const assignedTo = jobData.assigned_to as Array<{
          user?: { user_uid?: string };
          team_uid?: string;
          team?: { team_uid?: string };
        }> | undefined;
        if (assignedTo?.length) {
          currentAssignments = assignedTo
            .map((a) => ({
              userUid: a.user?.user_uid || "",
              teamUid: a.team_uid || a.team?.team_uid || resolvedTeamUid,
            }))
            .filter((a) => !!a.userUid);
        }
      }

      // Unassign any currently-assigned users that are NOT in the new list
      const usersToRemove = currentAssignments.filter((a) => !userUids.includes(a.userUid));
      if (usersToRemove.length > 0) {
        console.log(`[Zuper] Unassigning previous users from job ${jobUid}:`, usersToRemove.map((a) => a.userUid));
        const unassignResult = await this.unassignJob(jobUid, usersToRemove);
        if (unassignResult.type === "error") {
          console.warn(`[Zuper] Failed to unassign previous users:`, unassignResult.error);
        }
      }

      // Now assign the new users (skip any that are already assigned)
      const currentUserUids = currentAssignments.map((a) => a.userUid);
      const usersToAdd = userUids.filter(uid => !currentUserUids.includes(uid));
      if (usersToAdd.length > 0) {
        if (!resolvedTeamUid) {
          console.error(`[Zuper] Cannot assign user: No team_uid available`);
          assignmentFailed = true;
          assignmentError = "No team_uid available - assign user manually in Zuper";
        } else {
          console.log(`[Zuper] Assigning users to job ${jobUid}:`, usersToAdd, `team: ${resolvedTeamUid}`);
          const assignResult = await this.assignJob(jobUid, usersToAdd, resolvedTeamUid);
          console.log(`[Zuper] Assignment response:`, JSON.stringify(assignResult));
          if (assignResult.type === "error") {
            console.error(`[Zuper] Failed to assign users:`, assignResult.error);
            assignmentFailed = true;
            assignmentError = assignResult.error || "Assignment failed - assign user manually in Zuper";
          } else {
            console.log(`[Zuper] Assignment successful`);
          }
        }
      } else {
        console.log(`[Zuper] New users already assigned, no change needed`);
      }

      // Verify assignment state to catch API no-op responses.
      const verifyResult = await this.getJob(jobUid);
      if (verifyResult.type === "success" && verifyResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const verifyJob = verifyResult.data as any;
        const actualAssigned = this.extractAssignedUserUids(verifyJob);
        const missingUsers = userUids.filter((uid) => !actualAssigned.includes(uid));
        const staleUsers = actualAssigned.filter((uid) => !userUids.includes(uid));
        if (missingUsers.length > 0 || staleUsers.length > 0) {
          assignmentFailed = true;
          assignmentError = `Assignment verification mismatch (missing: ${missingUsers.join(",") || "none"}, stale: ${staleUsers.join(",") || "none"})`;
          console.warn("[Zuper] %s", assignmentError);
        }
      }
    }

    // Return success - schedule succeeded even if assignment failed
    // Caller can check assignmentFailed flag to show warning
    if (scheduleResult.type === "success") {
      return {
        type: "success",
        data: {
          ...scheduleResult.data,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(assignmentFailed && { _assignmentFailed: true, _assignmentError: assignmentError } as any),
        },
      };
    }

    return scheduleResult;
  }

  /**
   * Unschedule a job by clearing its scheduled times and unassigning users
   */
  async unscheduleJob(jobUid: string): Promise<ZuperApiResponse<ZuperJob>> {
    // First, unassign users from the job (do this before status change)
    try {
      const jobResult = await this.getJob(jobUid);
      if (jobResult.type === "success" && jobResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobData = jobResult.data as any;
        const assignedUsers = jobData.assigned_to as Array<{
          user?: { user_uid?: string };
          team_uid?: string;
          team?: { team_uid?: string };
        }> | undefined;
        const defaultTeamUid = jobData.assigned_to_team?.[0]?.team?.team_uid;

        if (assignedUsers?.length) {
          const assignments = assignedUsers
            .map((a) => ({
              userUid: a.user?.user_uid || "",
              teamUid: a.team_uid || a.team?.team_uid || defaultTeamUid,
            }))
            .filter((a) => !!a.userUid);

          if (assignments.length > 0) {
            console.log("[Zuper] Unassigning users from job %s:", jobUid, assignments.map((a) => a.userUid));
            await this.unassignJob(jobUid, assignments);
          }
        }
      }
    } catch (err) {
      console.warn("[Zuper] Failed to unassign users from job %s:", jobUid, err);
    }

    // Try both known unschedule mechanisms because behavior varies across tenants.
    let lastResult: ZuperApiResponse<ZuperJob> = { type: "error", error: "No unschedule attempt made" };

    // Set job status to UNSCHEDULED.
    const statusResult = await this.updateJobStatus(jobUid, "UNSCHEDULED");
    lastResult = statusResult;
    if (statusResult.type === "error") {
      console.warn("[Zuper] Failed to set UNSCHEDULED status for job %s: %s", jobUid, statusResult.error);
    }

    // Fallback for accounts where status-only change does not clear schedule.
    const clearScheduleResult = await this.request<ZuperJob>(`/jobs/schedule`, {
      method: "PUT",
      body: JSON.stringify({
        job_uid: jobUid,
        from_date: "",
        to_date: "",
      }),
    });
    if (clearScheduleResult.type === "success") {
      lastResult = clearScheduleResult;
    } else if (statusResult.type === "error") {
      console.warn("[Zuper] Failed to clear schedule via /jobs/schedule for %s: %s", jobUid, clearScheduleResult.error);
      // Try null payload variant for stricter schemas.
      const clearScheduleNullResult = await this.request<ZuperJob>(`/jobs/schedule`, {
        method: "PUT",
        body: JSON.stringify({
          job_uid: jobUid,
          from_date: null,
          to_date: null,
        }),
      });
      if (clearScheduleNullResult.type === "success") {
        lastResult = clearScheduleNullResult;
      }
    }

    // Verify both unscheduled state and no remaining assignees.
    const verifyResult = await this.getJob(jobUid);
    if (verifyResult.type === "success" && verifyResult.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verifyJob = verifyResult.data as any;
      const assigned = this.extractAssignedUserUids(verifyJob);
      const unscheduled = this.isJobUnscheduled(verifyJob);
      if (assigned.length === 0 && unscheduled) {
        return lastResult.type === "success" ? lastResult : { type: "success", data: verifyResult.data };
      }
      return {
        type: "error",
        error: `Unschedule verification failed (assigned=${assigned.length}, unscheduled=${unscheduled})`,
      };
    }

    return lastResult;
  }

  /**
   * Unassign users from a job
   */
  async unassignJob(
    jobUid: string,
    assignments: ZuperAssignmentRef[]
  ): Promise<ZuperApiResponse<ZuperJob>> {
    const payload = {
      job: assignments.map(({ userUid, teamUid }) => ({
        type: "UNASSIGN",
        user_uid: userUid,
        ...(teamUid ? { team_uid: teamUid } : {}),
      })),
    };

    const endpoint = `/jobs/${jobUid}/update?job_uid=${jobUid}&notify_users=false&update_all_jobs=false`;
    console.log("[Zuper] Unassigning job %s via %s:", jobUid, endpoint, JSON.stringify(payload));

    const result = await this.request<ZuperJob>(endpoint, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    // Some accounts reject UNASSIGN payloads with team_uid. Retry once without team.
    if (result.type === "error" && assignments.some((a) => !!a.teamUid)) {
      const retryPayload = {
        job: assignments.map(({ userUid }) => ({
          type: "UNASSIGN",
          user_uid: userUid,
        })),
      };
      console.warn("[Zuper] Retry unassign without team_uid for job %s", jobUid);
      return this.request<ZuperJob>(endpoint, {
        method: "PUT",
        body: JSON.stringify(retryPayload),
      });
    }

    return result;
  }

  /**
   * Get unscheduled jobs
   */
  async getUnscheduledJobs(): Promise<ZuperApiResponse<ZuperJob[]>> {
    return this.request<ZuperJob[]>("/jobs/unscheduled");
  }

  /**
   * Get available time slots via Assisted Scheduling
   * This queries Zuper for available slots based on date range, location, and job requirements
   */
  async getAssistedSchedulingSlots(params: {
    fromDate: string; // YYYY-MM-DD
    toDate: string; // YYYY-MM-DD
    jobCategory?: string; // Category UID
    teamUid?: string; // Team UID to filter by
    duration?: number; // Duration in minutes
    latitude?: number;
    longitude?: number;
  }): Promise<ZuperApiResponse<AssistedSchedulingSlot[]>> {
    const queryParams = new URLSearchParams();
    // Zuper expects datetime format: YYYY-MM-DD HH:mm:ss
    queryParams.append("from_date", `${params.fromDate} 00:00:00`);
    queryParams.append("to_date", `${params.toDate} 23:59:59`);
    if (params.jobCategory) queryParams.append("job_category", params.jobCategory);
    if (params.teamUid) queryParams.append("team_uid", params.teamUid);
    if (params.duration) queryParams.append("duration", String(params.duration));
    if (params.latitude) queryParams.append("latitude", String(params.latitude));
    if (params.longitude) queryParams.append("longitude", String(params.longitude));

    const endpoint = `/assisted_scheduling?${queryParams.toString()}`;
    console.log(`[Zuper] Calling assisted_scheduling: ${endpoint}`);

    const result = await this.request<{ type: string; data: AssistedSchedulingSlot[] }>(
      endpoint
    );

    console.log(`[Zuper] Assisted scheduling response type: ${result.type}`);
    if (result.type === "success" && result.data) {
      // Log raw response structure for debugging
      console.log(`[Zuper] Raw response keys: ${Object.keys(result.data ?? {}).join(", ")}`);
      const slots = Array.isArray(result.data?.data) ? result.data.data : [];
      console.log(`[Zuper] Parsed ${slots.length} availability slots`);
      if (slots.length > 0) {
        console.log(`[Zuper] Sample slot: ${JSON.stringify(slots[0])}`);
      }
      return {
        type: "success",
        data: slots,
      };
    }

    console.log(`[Zuper] Assisted scheduling error: ${result.error}`);
    return {
      type: result.type,
      error: result.error,
      data: [],
    };
  }

  /**
   * Assign technicians to a job
   * Uses PUT /jobs/{job_uid}/update endpoint with job array payload
   * Format discovered from working dev example
   */
  async assignJob(
    jobUid: string,
    userUids: string[],
    teamUid: string // Required - caller must provide team_uid
  ): Promise<ZuperApiResponse<ZuperJob>> {
    // Build job array for the update endpoint
    // Format: {"job":[{"type":"ASSIGN","user_uid":"...","team_uid":"...","is_primary":false}]}
    const payload = {
      job: userUids.map(userUid => ({
        type: "ASSIGN",
        user_uid: userUid,
        team_uid: teamUid,
        is_primary: false,
      })),
    };

    const endpoint = `/jobs/${jobUid}/update?job_uid=${jobUid}&notify_users=true&update_all_jobs=false`;
    console.log(`[Zuper] Assigning job ${jobUid} via ${endpoint}:`, JSON.stringify(payload));

    return this.request<ZuperJob>(endpoint, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobUid: string,
    status: string
  ): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>(`/jobs/${jobUid}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  /**
   * Search jobs with filters
   */
  async searchJobs(filters: {
    status?: string;
    category?: string;
    assigned_to?: string;
    customer_uid?: string;
    from_date?: string;
    to_date?: string;
    page?: number;
    limit?: number;
    search?: string; // Search by job title, customer name, etc.
  }): Promise<ZuperApiResponse<{ jobs: ZuperJob[]; total: number }>> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) {
        // Zuper uses "count" instead of "limit" for pagination
        const paramName = key === "limit" ? "count" : key;
        params.append(paramName, String(value));
      }
    });

    // Zuper API returns { type: "success", data: [...], total_records, ... }
    // The request() method wraps this in another { type, data } structure
    // So result.data contains the full Zuper response with its own data array
    const result = await this.request<{ type: string; data: ZuperJob[]; total_records?: number }>(`/jobs?${params.toString()}`);

    if (result.type === "success" && result.data) {
      // result.data is the Zuper response: { type, data: [...], total_records }
      const zuperResponse = result.data ?? {};
      const jobs = Array.isArray(zuperResponse?.data) ? zuperResponse.data : [];
      return {
        type: "success",
        data: {
          jobs,
          total: zuperResponse?.total_records ?? jobs.length,
        },
      };
    }

    return {
      type: result.type,
      error: result.error,
      data: { jobs: [], total: 0 },
    };
  }

  // ========== CUSTOMER OPERATIONS ==========

  /**
   * Create a new customer
   */
  async createCustomer(
    customer: ZuperCustomer
  ): Promise<ZuperApiResponse<ZuperCustomer>> {
    return this.request<ZuperCustomer>("/customers", {
      method: "POST",
      body: JSON.stringify(customer),
    });
  }

  /**
   * Search customers
   */
  async searchCustomers(
    query: string
  ): Promise<ZuperApiResponse<ZuperCustomer[]>> {
    return this.request<ZuperCustomer[]>(
      `/customers?search=${encodeURIComponent(query)}`
    );
  }

  /**
   * Get customer by ID
   */
  async getCustomer(
    customerUid: string
  ): Promise<ZuperApiResponse<ZuperCustomer>> {
    return this.request<ZuperCustomer>(`/customers/${customerUid}`);
  }

  // ========== USER/TECHNICIAN OPERATIONS ==========

  /**
   * Get all users/technicians (legacy /users endpoint)
   */
  async getUsers(): Promise<ZuperApiResponse<ZuperUser[]>> {
    return this.request<ZuperUser[]>("/users");
  }

  /**
   * Get ALL users via /user/all endpoint
   * Returns full user details including email, role, status, etc.
   */
  async getAllUsers(): Promise<ZuperApiResponse<ZuperUserFull[]>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.request<any>("/user/all");
    if (result.type === "success" && result.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = result.data as any;
      const users = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return { type: "success", data: users };
    }
    return { type: result.type, error: result.error, data: [] };
  }

  /**
   * Get user by ID via /user/{user_uid}
   */
  async getUser(userUid: string): Promise<ZuperApiResponse<ZuperUserFull>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.request<any>(`/user/${userUid}`);
    if (result.type === "success" && result.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = result.data as any;
      return { type: "success", data: raw?.data ?? raw };
    }
    return { type: result.type, error: result.error };
  }

  /**
   * Get users by team
   */
  async getUsersByTeam(teamUid: string): Promise<ZuperApiResponse<ZuperUser[]>> {
    return this.request<ZuperUser[]>(`/teams/${teamUid}/users`);
  }

  /**
   * Get all teams summary
   */
  async getTeams(): Promise<ZuperApiResponse<{ team_uid: string; team_name: string }[]>> {
    const result = await this.request<{ type: string; data: { team_uid: string; team_name: string }[] }>(
      `/teams/summary`
    );

    if (result.type === "success" && result.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = result.data as any;
      return { type: "success", data: data?.data ?? data ?? [] };
    }
    return result as unknown as ZuperApiResponse<{ team_uid: string; team_name: string }[]>;
  }

  /**
   * Get team detail with members via /team/{team_uid}
   */
  async getTeamDetail(teamUid: string): Promise<ZuperApiResponse<ZuperTeamDetail>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.request<any>(`/team/${teamUid}`);
    if (result.type === "success" && result.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = result.data as any;
      return { type: "success", data: raw?.data ?? raw };
    }
    return { type: result.type, error: result.error };
  }

  // ========== TIME OFF / AVAILABILITY ==========

  /**
   * Get time-off requests for users in a date range
   * Used to determine when technicians are unavailable
   */
  async getTimeOffRequests(params: {
    fromDate: string; // YYYY-MM-DD
    toDate: string; // YYYY-MM-DD
    userUid?: string; // Optional specific user
  }): Promise<ZuperApiResponse<TimeOffRequest[]>> {
    const queryParams = new URLSearchParams();
    queryParams.append("filter.from_date", params.fromDate);
    queryParams.append("filter.to_date", params.toDate);
    if (params.userUid) {
      queryParams.append("filter.user_uid", params.userUid);
    }

    const result = await this.request<{ type: string; data: TimeOffRequest[] }>(
      `/timesheets/request/timeoff?${queryParams.toString()}`
    );

    if (result.type === "success" && result.data) {
      const timeoffs = Array.isArray(result.data?.data) ? result.data.data : [];
      return { type: "success", data: timeoffs };
    }

    return {
      type: result.type,
      error: result.error,
      data: [],
    };
  }

  /**
   * Get scheduled jobs for a date range to determine busy times
   */
  async getScheduledJobsForDateRange(params: {
    fromDate: string;
    toDate: string;
    teamUid?: string;
    userUid?: string;
    categoryUid?: string;
  }): Promise<ZuperApiResponse<ZuperJob[]>> {
    const result = await this.searchJobs({
      from_date: params.fromDate,
      to_date: params.toDate,
      category: params.categoryUid,
      limit: 500,
    });

    if (result.type === "success" && result.data) {
      let jobs = result.data.jobs;
      // Filter by team or user if specified
      if (params.teamUid) {
        jobs = jobs.filter(j => j.assigned_to?.some(u => {
          // Handle both assignment formats (POST vs GET response)
          if (typeof u === 'object' && 'team_uid' in u) {
            return u.team_uid === params.teamUid;
          }
          if (typeof u === 'object' && 'user' in u) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (u as any).team?.team_uid === params.teamUid;
          }
          return false;
        }));
      }
      // Filter by category if specified (in case API doesn't filter properly)
      if (params.categoryUid) {
        jobs = jobs.filter(j => {
          const jobCategory = typeof j.job_category === 'string'
            ? j.job_category
            : j.job_category?.category_uid;
          return jobCategory === params.categoryUid;
        });
      }
      return { type: "success", data: jobs };
    }

    return { type: result.type, error: result.error, data: [] };
  }

  // ========== CACHED LOOKUPS ==========

  private static userCache: { data: Map<string, { userUid: string; teamUid?: string }>; fetchedAt: number } | null = null;
  private static teamCache: { data: Map<string, string>; fetchedAt: number } | null = null;
  private static userCachePromise: Promise<Map<string, { userUid: string; teamUid?: string }>> | null = null;
  private static teamCachePromise: Promise<Map<string, string>> | null = null;
  private static readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  /**
   * Get all Zuper users as a name→{userUid, teamUid} map, cached for 10 minutes.
   * Pulls from /team endpoint which returns teams with embedded user arrays.
   * Keys are lowercase full names ("drew perry"), first names ("rolando"), etc.
   */
  async getCachedUsers(): Promise<Map<string, { userUid: string; teamUid?: string }>> {
    const now = Date.now();
    if (ZuperClient.userCache && (now - ZuperClient.userCache.fetchedAt) < ZuperClient.CACHE_TTL) {
      return ZuperClient.userCache.data;
    }

    // Deduplicate in-flight requests
    if (ZuperClient.userCachePromise) return ZuperClient.userCachePromise;

    ZuperClient.userCachePromise = (async () => {
      try {
        // Zuper's /users endpoint doesn't exist; users are embedded in /team response
        const result = await this.request<{ type: string; data: Array<{ team_uid: string; team_name: string; users: Array<{ user_uid: string; first_name: string; last_name: string; email?: string }> }> }>("/team");
        const map = new Map<string, { userUid: string; teamUid?: string }>();

        if (result.type === "success" && result.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawData = result.data as any;
          const teams = Array.isArray(rawData) ? rawData : (rawData?.data ?? []);
          const seen = new Set<string>();

          for (const team of teams) {
            // Skip backoffice teams for user resolution — they contain admin/office users
            // that shouldn't be matched to field crew names
            const teamName = (team.team_name || "").toLowerCase();
            if (teamName.startsWith("backoffice")) continue;

            for (const user of (team.users || [])) {
              if (!user.user_uid || seen.has(user.user_uid)) continue;
              seen.add(user.user_uid);

              const entry = { userUid: user.user_uid, teamUid: team.team_uid };
              const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim().toLowerCase();
              const firstName = (user.first_name || "").trim().toLowerCase();

              if (fullName) map.set(fullName, entry);
              // Also index by first name only (for entries like "Rolando")
              if (firstName && !map.has(firstName)) map.set(firstName, entry);
            }
          }

          console.log(`[Zuper] Cached ${seen.size} users (${map.size} name entries) from ${teams.length} teams`);
        } else {
          console.warn(`[Zuper] Failed to fetch users for cache: ${result.error}`);
        }

        ZuperClient.userCache = { data: map, fetchedAt: Date.now() };
        return map;
      } finally {
        ZuperClient.userCachePromise = null;
      }
    })();

    return ZuperClient.userCachePromise;
  }

  /**
   * Get all Zuper teams as a name→teamUid map, cached for 10 minutes.
   * Keys are lowercase team names.
   */
  async getCachedTeams(): Promise<Map<string, string>> {
    const now = Date.now();
    if (ZuperClient.teamCache && (now - ZuperClient.teamCache.fetchedAt) < ZuperClient.CACHE_TTL) {
      return ZuperClient.teamCache.data;
    }

    if (ZuperClient.teamCachePromise) return ZuperClient.teamCachePromise;

    ZuperClient.teamCachePromise = (async () => {
      try {
        const result = await this.getTeams();
        const map = new Map<string, string>();

        if (result.type === "success" && result.data) {
          const teams = Array.isArray(result.data) ? result.data : [];
          for (const team of teams) {
            if (team.team_uid && team.team_name) {
              map.set(team.team_name.toLowerCase(), team.team_uid);
            }
          }
          console.log(`[Zuper] Cached ${teams.length} teams: ${[...map.keys()].join(", ")}`);
        } else {
          console.warn(`[Zuper] Failed to fetch teams for cache: ${result.error}`);
        }

        ZuperClient.teamCache = { data: map, fetchedAt: Date.now() };
        return map;
      } finally {
        ZuperClient.teamCachePromise = null;
      }
    })();

    return ZuperClient.teamCachePromise;
  }

  /**
   * Resolve a crew member name to their Zuper user_uid and team_uid.
   * Matches by full name, first name, or partial match (case-insensitive).
   */
  async resolveUserUid(name: string): Promise<{ userUid: string; teamUid?: string } | null> {
    if (!this.isConfigured()) return null;
    const users = await this.getCachedUsers();
    const lower = name.toLowerCase().trim();

    // 1. Exact full name match
    if (users.has(lower)) return users.get(lower)!;

    // 2. First name only match (e.g. "Rolando")
    const firstName = lower.split(" ")[0];
    if (users.has(firstName)) return users.get(firstName)!;

    // 3. Partial/contains match
    for (const [key, val] of users) {
      if (key.includes(lower) || lower.includes(key)) return val;
    }

    console.warn(`[Zuper] Could not resolve user UID for "${name}"`);
    return null;
  }

  /**
   * Resolve a team/location name to a Zuper team_uid.
   * Matches by exact name or partial match (case-insensitive).
   */
  async resolveTeamUid(name: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const teams = await this.getCachedTeams();
    const lower = name.toLowerCase().trim();

    // 1. Exact match
    if (teams.has(lower)) return teams.get(lower)!;

    // 2. Partial/contains match
    for (const [key, val] of teams) {
      if (key.includes(lower) || lower.includes(key)) return val;
    }

    console.warn(`[Zuper] Could not resolve team UID for "${name}"`);
    return null;
  }

  // ========== HELPER METHODS ==========

  /**
   * Check if Zuper integration is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

// Export singleton instance
export const zuper = new ZuperClient();

// ========== PB OPERATIONS SUITE HELPERS ==========

/**
 * Create a job from a PB project scheduling action
 */
export async function createJobFromProject(project: {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode?: string;
  systemSizeKw?: number;
  batteryCount?: number;
  projectType?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}, schedule: {
  type: "survey" | "installation" | "inspection";
  date: string;
  days: number;
  startTime?: string; // Optional specific start time (e.g., "12:00")
  endTime?: string; // Optional specific end time (e.g., "13:00")
  crew?: string; // Zuper user UID
  teamUid?: string; // Zuper team UID (required for user assignment)
  timezone?: string; // IANA timezone for the slot (e.g. "America/Los_Angeles" for CA)
  notes?: string;
}): Promise<ZuperApiResponse<ZuperJob>> {
  // Determine job category - use UIDs for creating jobs
  const categoryUidMap = {
    survey: JOB_CATEGORY_UIDS.SITE_SURVEY,
    installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
    inspection: JOB_CATEGORY_UIDS.INSPECTION,
  };
  const categoryNameMap = {
    survey: JOB_CATEGORIES.SITE_SURVEY,
    installation: JOB_CATEGORIES.CONSTRUCTION,
    inspection: JOB_CATEGORIES.INSPECTION,
  };

  // Determine job type based on project
  let jobType: string = JOB_TYPES.SOLAR;
  const types = project.projectType?.toLowerCase() || "";
  if (types.includes("battery") && types.includes("solar")) {
    jobType = JOB_TYPES.SOLAR_BATTERY;
  } else if (types.includes("battery")) {
    jobType = JOB_TYPES.BATTERY;
  } else if (types.includes("ev") || types.includes("charger")) {
    jobType = JOB_TYPES.EV_CHARGER;
  }

  // Calculate schedule times
  // Slot times are in the crew member's local timezone (e.g. Mountain for CO, Pacific for CA)
  // Zuper expects UTC, so we convert using the timezone provided by the caller
  const slotTimezone = schedule.timezone || "America/Denver";

  // Helper to convert local time to UTC
  const localToUtc = (dateStr: string, timeStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = (timeStr + ":00").split(':').map(Number);

    // Determine the UTC offset for this timezone on this date
    const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const localFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: slotTimezone,
      timeZoneName: 'longOffset'
    });
    const parts = localFormatter.formatToParts(testDate);
    const tzOffsetStr = parts.find(p => p.type === 'timeZoneName')?.value || '';
    // Parse offset like "GMT-07:00" or "GMT-06:00"
    const offsetMatch = tzOffsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
    let offsetHours: number;
    if (offsetMatch) {
      const sign = offsetMatch[1] === '-' ? 1 : -1; // Negative UTC offset means ADD hours to get UTC
      offsetHours = sign * parseInt(offsetMatch[2]);
    } else {
      // Fallback: use short name for common US timezones
      const shortFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: slotTimezone,
        timeZoneName: 'short'
      });
      const shortParts = shortFormatter.formatToParts(testDate);
      const shortTzName = shortParts.find(p => p.type === 'timeZoneName')?.value || '';
      const tzOffsets: Record<string, number> = {
        'MST': 7, 'MDT': 6, 'PST': 8, 'PDT': 7, 'CST': 6, 'CDT': 5, 'EST': 5, 'EDT': 4,
      };
      offsetHours = tzOffsets[shortTzName] || 7;
    }

    // Add the offset to convert local time to UTC
    let utcHours = hours + offsetHours;
    let utcDay = day;
    let utcMonth = month;
    let utcYear = year;

    // Handle day overflow
    if (utcHours >= 24) {
      utcHours -= 24;
      utcDay += 1;
      const daysInMonth = new Date(year, month, 0).getDate();
      if (utcDay > daysInMonth) {
        utcDay = 1;
        utcMonth += 1;
        if (utcMonth > 12) {
          utcMonth = 1;
          utcYear += 1;
        }
      }
    }

    return `${utcYear}-${String(utcMonth).padStart(2, '0')}-${String(utcDay).padStart(2, '0')} ${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  };

  let startDateTime: string;
  let endDateTime: string;

  if (schedule.type === "inspection") {
    // Inspections always use a fixed 8am-4pm same-day window
    // The slot selection only determines the inspector assignment, not the time window
    startDateTime = localToUtc(schedule.date, "08:00");
    endDateTime = localToUtc(schedule.date, "16:00");
  } else if (schedule.startTime && schedule.endTime) {
    // Use specific time slot (e.g., "08:00" to "09:00" for site surveys)
    // Convert from local timezone to UTC for Zuper
    startDateTime = localToUtc(schedule.date, schedule.startTime);
    endDateTime = localToUtc(schedule.date, schedule.endTime);
  } else {
    // Default to 8am-4pm local time for multi-day jobs (construction)
    startDateTime = localToUtc(schedule.date, "08:00");

    // Calculate end date — ensure at least same-day (days < 1 means partial day, still same day)
    const [year, month, day] = schedule.date.split('-').map(Number);
    const extraDays = Math.max(Math.ceil(schedule.days) - 1, 0); // 0.25d → 0 extra, 1d → 0 extra, 2d → 1 extra
    const endDateObj = new Date(year, month - 1, day + extraDays);
    const endYear = endDateObj.getFullYear();
    const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
    const endDayStr = String(endDateObj.getDate()).padStart(2, '0');
    const endDateStr = `${endYear}-${endMonth}-${endDayStr}`;
    endDateTime = localToUtc(endDateStr, "16:00");
  }

  // Build assigned_to array if crew user UID is provided
  // IMPORTANT: Zuper API only allows setting assigned_to at creation time, not on updates!
  // This is the ONLY way to assign a user to a job in Zuper.
  let assignedTo: ZuperAssignment[] | undefined;
  if (schedule.crew) {
    // schedule.crew is a Zuper user UID (e.g., "f203f99b-4aaf-488e-8e6a-8ee5e94ec217")
    // schedule.teamUid is the Zuper team UID (required for assignment to work)
    assignedTo = [{
      user_uid: schedule.crew,
      ...(schedule.teamUid && { team_uid: schedule.teamUid }),
    }];
    console.log(`[createJobFromProject] Assigning job to user: ${schedule.crew}, team: ${schedule.teamUid || 'none'}`);
  }

  const job: ZuperJob = {
    job_title: `${categoryNameMap[schedule.type]} - ${project.name}`,
    job_category: categoryUidMap[schedule.type],
    job_type: jobType,
    job_priority: "MEDIUM",
    scheduled_start_time: startDateTime,
    scheduled_end_time: endDateTime,
    due_date: endDateTime,
    customer_address: {
      street: project.address,
      city: project.city,
      state: project.state,
      zip_code: project.zipCode || "",
    },
    // Assign to user at creation time (only way to do this in Zuper!)
    ...(assignedTo && { assigned_to: assignedTo }),
    job_tags: [
      `hubspot-${project.id}`,
      // Add PROJ number tag for future matching (e.g. "proj-7637")
      ...(project.name?.match(/PROJ-\d+/i) ? [project.name.match(/PROJ-\d+/i)![0].toLowerCase()] : []),
      schedule.type,
      project.systemSizeKw ? `${project.systemSizeKw}kw` : "",
      project.batteryCount ? `${project.batteryCount}-batteries` : "",
    ].filter(Boolean),
    job_notes: [
      schedule.notes,
      `HubSpot Deal ID: ${project.id}`,
      project.systemSizeKw ? `System Size: ${project.systemSizeKw} kW` : "",
      project.batteryCount ? `Batteries: ${project.batteryCount}` : "",
      schedule.crew ? `Assigned to: ${schedule.crew}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    custom_fields: {
      hubspot_deal_id: project.id,
      system_size_kw: project.systemSizeKw,
      battery_count: project.batteryCount,
      project_type: project.projectType,
    },
  };

  console.log(`[createJobFromProject] Creating job with assigned_to:`, job.assigned_to);
  return zuper.createJob(job);
}

/**
 * Sync job status back to indicate completion
 */
export async function getJobStatusForProject(
  hubspotDealId: string
): Promise<ZuperApiResponse<{ status: string; completedDate?: string } | null>> {
  const result = await zuper.searchJobs({
    limit: 1,
  });

  if (result.type === "error") {
    return { type: "error", error: result.error };
  }

  // Find job with matching HubSpot ID in tags
  const job = result.data?.jobs.find((j) =>
    j.job_tags?.includes(`hubspot-${hubspotDealId}`)
  );

  if (!job) {
    return { type: "success", data: null };
  }

  return {
    type: "success",
    data: {
      status: job.current_job_status?.status_name || job.status || "unknown",
      completedDate: (job.current_job_status?.status_name || job.status || "").toUpperCase() === "COMPLETED" ? job.scheduled_end_time : undefined,
    },
  };
}
