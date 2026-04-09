interface JobStatus {
  id: string;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  lastRun?: string;
  lastError?: string;
}

const jobs: Map<string, JobStatus> = new Map();

export const jobMonitor = {
  start(id: string) {
    jobs.set(id, { id, status: 'running', lastRun: new Date().toISOString() });
  },
  succeed(id: string) {
    const job = jobs.get(id);
    if (job) jobs.set(id, { ...job, status: 'succeeded' });
  },
  fail(id: string, error: string) {
    const job = jobs.get(id);
    if (job) jobs.set(id, { ...job, status: 'failed', lastError: error });
  },
  getAll(): JobStatus[] {
    return [...jobs.values()];
  },
};
