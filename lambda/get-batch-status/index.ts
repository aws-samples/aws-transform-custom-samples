import { BatchClient, DescribeJobsCommand } from '@aws-sdk/client-batch';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse, errorResponse, getEnvOrThrow, logger } from '../utils';

const batch = new BatchClient({});
const s3 = new S3Client({});

interface GetBatchStatusRequest {
  batchId: string;
}

export async function handler(event: GetBatchStatusRequest) {
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
    if (!jobIds.length) {
      return jsonResponse(200, { batchId: event.batchId, batchName: batchData.batchName, status: 'FAILED', totalJobs: batchData.jobs.length, submissionFailures: batchData.jobs.length, progress: 100, statusCounts: {}, submittedAt: batchData.submittedAt, failedJobs: [] });
    }

    const statusMap: Record<string, string> = {};
    for (let i = 0; i < jobIds.length; i += 100) {
      const { jobs } = await batch.send(new DescribeJobsCommand({ jobs: jobIds.slice(i, i + 100) }));
      for (const job of jobs || []) statusMap[job.jobId!] = job.status!;
    }

    const statusCounts: Record<string, number> = {};
    const submissionFailures = batchData.jobs.filter((j: any) => !j.batchJobId).length;
    for (const job of batchData.jobs) {
      if (!job.batchJobId) continue; // submission failures tracked separately
      const status = statusMap[job.batchJobId] || 'UNKNOWN';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    const completedJobs = (statusCounts['SUCCEEDED'] || 0) + (statusCounts['FAILED'] || 0);
    const total = batchData.jobs.length;
    const progress = total > 0 ? Math.round(((completedJobs + submissionFailures) / total) * 1000) / 10 : 0;

    let status = 'PROCESSING';
    if (completedJobs + submissionFailures === total) status = 'COMPLETED';
    else if (statusCounts['RUNNING'] || statusCounts['STARTING']) status = 'RUNNING';
    else if (statusCounts['RUNNABLE'] || statusCounts['PENDING']) status = 'PENDING';

    const failedJobs = batchData.jobs
      .filter((j: any) => statusMap[j.batchJobId] === 'FAILED' || (!j.batchJobId && j.status === 'FAILED'))
      .slice(0, 10)
      .map((j: any) => ({ jobName: j.jobName, batchJobId: j.batchJobId, error: j.error }));

    return jsonResponse(200, { batchId: event.batchId, batchName: batchData.batchName, status, totalJobs: total, submissionFailures, progress, statusCounts, submittedAt: batchData.submittedAt, failedJobs });
  } catch (e) {
    logger.error('Failed to get batch status', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
