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
  assigned_to?: string[];
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
   */
  async createJob(job: ZuperJob): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>("/jobs", {
      method: "POST",
      body: JSON.stringify(job),
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
   * Reschedule a job by updating its scheduled times
   * Zuper uses PUT /jobs/schedule with job_uid, from_date, to_date at top level
   */
  async rescheduleJob(
    jobUid: string,
    scheduledStartTime: string,
    scheduledEndTime: string
  ): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>(`/jobs/schedule`, {
      method: "PUT",
      body: JSON.stringify({
        job_uid: jobUid,
        from_date: this.formatZuperDateTime(scheduledStartTime),
        to_date: this.formatZuperDateTime(scheduledEndTime),
      }),
    });
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
      console.log(`[Zuper] Raw response keys: ${Object.keys(result.data).join(", ")}`);
      const slots = Array.isArray(result.data.data) ? result.data.data : [];
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
   */
  async assignJob(
    jobUid: string,
    userUids: string[]
  ): Promise<ZuperApiResponse<ZuperJob>> {
    return this.request<ZuperJob>(`/jobs/${jobUid}/assign`, {
      method: "PUT",
      body: JSON.stringify({ assigned_to: userUids }),
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
      const zuperResponse = result.data;
      const jobs = Array.isArray(zuperResponse.data) ? zuperResponse.data : [];
      return {
        type: "success",
        data: {
          jobs,
          total: zuperResponse.total_records ?? jobs.length,
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
      const timeoffs = Array.isArray(result.data.data) ? result.data.data : [];
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
        jobs = jobs.filter(j => j.assigned_to?.some(u => u.includes(params.teamUid!)));
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
  crew?: string;
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

  // Calculate end time (assuming 8-hour workday starting at 8am)
  const startDate = new Date(`${schedule.date}T08:00:00`);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + schedule.days - 1);
  endDate.setHours(17, 0, 0, 0);

  const job: ZuperJob = {
    job_title: `${categoryNameMap[schedule.type]} - ${project.name}`,
    job_category: categoryUidMap[schedule.type],
    job_type: jobType,
    job_priority: "MEDIUM",
    scheduled_start_time: startDate.toISOString(),
    scheduled_end_time: endDate.toISOString(),
    due_date: endDate.toISOString(),
    customer_address: {
      street: project.address,
      city: project.city,
      state: project.state,
      zip_code: project.zipCode || "",
    },
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
      schedule.crew ? `Requested Crew: ${schedule.crew}` : "",
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
