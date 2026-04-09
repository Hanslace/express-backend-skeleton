import cron from 'node-cron';
import { jobMonitor } from '../integrations/jobMonitor.js';

const JOB_ID = 'example-job';

export function startExampleJob() {
  cron.schedule('5 0 * * *', async () => {
    jobMonitor.start(JOB_ID);
    try {
      // TODO: add job logic
      jobMonitor.succeed(JOB_ID);
    } catch (err) {
      jobMonitor.fail(JOB_ID, err instanceof Error ? err.message : String(err));
    }
  });
}
