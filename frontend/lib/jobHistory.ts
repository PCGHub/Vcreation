export type StoredJob = {
  job_id: string;
  label: string;
  source: "upload" | "video" | "jobs";
  status?: string;
  progress?: number;
  output_url?: string;
  outputs?: string[];
  created_at: string;
};

const STORAGE_KEY = "clayme_job_history";

export function getStoredJobs(): StoredJob[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredJobs(jobs: StoredJob[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export function addOrUpdateJob(job: StoredJob) {
  const jobs = getStoredJobs();
  const existingIndex = jobs.findIndex((j) => j.job_id === job.job_id);

  if (existingIndex >= 0) {
    jobs[existingIndex] = { ...jobs[existingIndex], ...job };
  } else {
    jobs.unshift(job);
  }

  saveStoredJobs(jobs.slice(0, 50));
}

export function removeJob(jobId: string) {
  const jobs = getStoredJobs().filter((j) => j.job_id !== jobId);
  saveStoredJobs(jobs);
}

export function clearJobs() {
  saveStoredJobs([]);
}