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

export interface ZuperApiResponse<T> {
  type: "success" | "error";
  data?: T;
  message?: string;
  error?: string;
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
  CONSTRUCTION: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf", // Zuper calls it "Construction", not "Installation"
  INSPECTION: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65",
  SERVICE: "cff6f839-c043-46ee-a09f-8d0e9f363437",
} as const;

// Human-readable category names (for display/logging)
export const JOB_CATEGORIES = {
  SITE_SURVEY: "Site Survey",
  CONSTRUCTION: "Construction",
  INSPECTION: "Inspection",
  SERVICE: "Service Visit",
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
    options: RequestInit = {}
  ): Promise<ZuperApiResponse<T>> {
    if (!this.apiKey) {
      return { type: "error", error: "Zuper API key not configured" };
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          type: "error",
          error: data.message || `HTTP ${response.status}`,
        };
      }

      return { type: "success", data };
    } catch (error) {
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
      // Get team UID from the job if not provided
      let resolvedTeamUid = teamUid;
      if (!resolvedTeamUid) {
        console.log(`[Zuper] No team UID provided, fetching from existing job...`);
        const jobResult = await this.getJob(jobUid);
        if (jobResult.type === "success" && jobResult.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const jobData = jobResult.data as any;
          resolvedTeamUid = jobData.assigned_to_team?.[0]?.team?.team_uid;
          console.log(`[Zuper] Got team_uid from job: ${resolvedTeamUid}`);
        }
      }

      if (!resolvedTeamUid) {
        console.error(`[Zuper] Cannot assign user: No team_uid available`);
        assignmentFailed = true;
        assignmentError = "No team_uid available - assign user manually in Zuper";
      } else {
        console.log(`[Zuper] Assigning users to job ${jobUid}:`, userUids, `team: ${resolvedTeamUid}`);
        console.log(`[Zuper] Assignment request: jobUid=${jobUid}, userUids=${JSON.stringify(userUids)}, teamUid=${resolvedTeamUid}`);
        const assignResult = await this.assignJob(jobUid, userUids, resolvedTeamUid);
        console.log(`[Zuper] Assignment response:`, JSON.stringify(assignResult));
        if (assignResult.type === "error") {
          console.error(`[Zuper] Failed to assign users:`, assignResult.error);
          assignmentFailed = true;
          assignmentError = assignResult.error || "Assignment failed - assign user manually in Zuper";
        } else {
          console.log(`[Zuper] Assignment successful`);
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
   * Get all users/technicians
   */
  async getUsers(): Promise<ZuperApiResponse<ZuperUser[]>> {
    return this.request<ZuperUser[]>("/users");
  }

  /**
   * Get user by ID
   */
  async getUser(userUid: string): Promise<ZuperApiResponse<ZuperUser>> {
    return this.request<ZuperUser>(`/users/${userUid}`);
  }

  /**
   * Get users by team
   */
  async getUsersByTeam(teamUid: string): Promise<ZuperApiResponse<ZuperUser[]>> {
    return this.request<ZuperUser[]>(`/teams/${teamUid}/users`);
  }

  /**
   * Get all teams
   * Useful for finding team UIDs for assignment
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

  if (schedule.startTime && schedule.endTime) {
    // Use specific time slot (e.g., "08:00" to "09:00" for site surveys)
    // Convert from local timezone to UTC for Zuper
    startDateTime = localToUtc(schedule.date, schedule.startTime);
    endDateTime = localToUtc(schedule.date, schedule.endTime);
  } else {
    // Default to 8am-4pm local time for multi-day jobs
    startDateTime = localToUtc(schedule.date, "08:00");

    // Calculate end date
    const [year, month, day] = schedule.date.split('-').map(Number);
    const endDay = day + schedule.days - 1;
    const endDateObj = new Date(year, month - 1, endDay);
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
      status: job.status || "unknown",
      completedDate: job.status === "COMPLETED" ? job.scheduled_end_time : undefined,
    },
  };
}
