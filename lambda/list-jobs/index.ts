import { BatchClient, ListJobsCommand, JobStatus } from '@aws-sdk/client-batch';
import { jsonResponse, errorResponse, getEnvOrThrow, logger } from '../utils';

const batch = new BatchClient({});
const VALID_STATUSES: Set<string> = new Set(['SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED']);

interface ListJobsRequest {
  status?: string;
  maxResults?: number;
  nextToken?: string;
}

export async function handler(event: ListJobsRequest) {
  try {
    const status = event.status || 'RUNNING';
    if (!VALID_STATUSES.has(status)) {
      return errorResponse(400, `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`);
    }

    const maxResults = Math.min(event.maxResults || 50, 100);

    const response = await batch.send(new ListJobsCommand({
      jobQueue: getEnvOrThrow('JOB_QUEUE'),
      jobStatus: status as JobStatus,
      maxResults,
      nextToken: event.nextToken,
    }));

    const jobs = (response.jobSummaryList || []).map(job => ({
      batchJobId: job.jobId,
      jobName: job.jobName,
      status: job.status,
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
      stoppedAt: job.stoppedAt ? new Date(job.stoppedAt).toISOString() : null,
    }));

    return jsonResponse(200, {
      jobs,
      count: jobs.length,
      ...(response.nextToken && { nextToken: response.nextToken }),
    });
  } catch (e) {
    logger.error('Failed to list jobs', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
