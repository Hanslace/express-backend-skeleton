type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
type Category = 'AUTH' | 'SECURITY' | 'BUSINESS' | 'SYSTEM';

interface LogEntry {
  code: string;
  category: Category;
  severity: Severity;
  note: string;
  userId?: string;
  traceId?: string;
  payload?: unknown;
  service?: string;
}

export function recordLog(entry: LogEntry) {
  console.log(JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
    service: entry.service ?? 'api',
  }));
}
