export interface ConstructionSchedulerProject {
  id: string;
  name: string;
  location: string;
  installStatus: string;
}

export interface ConstructionEventProject extends ConstructionSchedulerProject {
  dayNum: number;
  totalDays: number;
}

export interface ConstructionDayAvailability {
  date: string;
  availableSlots: Array<{
    start_time: string;
    end_time: string;
    display_time?: string;
    user_uid?: string;
    user_name?: string;
    location?: string;
  }>;
  timeOffs: Array<{
    user_name?: string;
    all_day?: boolean;
    start_time?: string;
    end_time?: string;
  }>;
  scheduledJobs: Array<{
    job_title: string;
    start_time?: string;
    end_time?: string;
  }>;
  hasAvailability: boolean;
  isFullyBooked: boolean;
}
