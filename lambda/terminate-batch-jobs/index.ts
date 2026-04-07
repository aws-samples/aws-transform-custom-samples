import { BatchClient, DescribeJobsCommand, TerminateJobCommand } from '@aws-sdk/client-batch';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse, errorResponse, getEnvOrThrow, assertJobQueue, JobQueueMismatchError, logger } from '../utils';

const batch = new BatchClient({});
const s3 = new S3Client({});
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED']);

interface TerminateBatchJobsRequest {
  batchId: string;
}

export async function handler(event: TerminateBatchJobsRequest) {
  try {
    if (!event.batchId) return errorResponse(400, 'Missing batchId');

    let batchData: any;
    try {
      const response = await s3.send(new GetObjectCommand({
        Bucket: getEnvOrThrow('OUTPUT_BUCKET'),
        Key: `batch-jobs/${event.batchId}-output.json`,
      }));
      batchData = JSON.parse(await response.Body!.transformToString());
    } catch (e: any) {
      if (e.name === 'NoSuchKey') return errorResponse(404, `Batch ${event.batchId} not found`);
      throw e;
    }

    const jobIds = batchData.jobs.filter((j: any) => j.batchJobId).map((j: any) => j.batchJobId);
    const activeJobIds: string[] = [];
    let alreadyComplete = 0;

    for (let i = 0; i < jobIds.length; i += 100) {
      const { jobs } = await batch.send(new DescribeJobsCommand({ jobs: jobIds.slice(i, i + 100) }));
      for (const job of jobs || []) {
        try { assertJobQueue(job.jobQueue); } catch { continue; }
        if (TERMINAL_STATUSES.has(job.status!)) alreadyComplete++;
        else activeJobIds.push(job.jobId!);
      }
    }

    let terminated = 0, failed = 0;
    for (const jobId of activeJobIds) {
      try {
        await batch.send(new TerminateJobCommand({ jobId, reason: 'Batch terminated by user' }));
        terminated++;
      } catch { failed++; }
    }

    return jsonResponse(200, { batchId: event.batchId, terminated, alreadyComplete, failed, terminatedAt: new Date().toISOString() });
  } catch (e) {
    logger.error('Failed to terminate batch', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
