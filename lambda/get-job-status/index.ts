import { BatchClient, DescribeJobsCommand } from '@aws-sdk/client-batch';
import { jsonResponse, errorResponse, formatTimestamp, calculateDuration, getEnvOrThrow, assertJobQueue, JobQueueMismatchError, logger } from '../utils';

const batch = new BatchClient({});

interface GetJobStatusRequest {
  jobId: string;
}

export async function handler(event: GetJobStatusRequest) {
  try {
    if (!event.jobId) return errorResponse(400, 'Missing jobId');

    const { jobs } = await batch.send(new DescribeJobsCommand({ jobs: [event.jobId] }));
    if (!jobs?.length) return errorResponse(404, `Job not found: ${event.jobId}`);

    const job = jobs[0];
    assertJobQueue(job.jobQueue);
    const outputPath = job.tags?.outputPath;

    const result: Record<string, unknown> = {
      batchJobId: job.jobId,
      jobName: job.jobName,
      status: job.status,
      submittedAt: formatTimestamp(job.createdAt),
      startedAt: formatTimestamp(job.startedAt),
      completedAt: formatTimestamp(job.stoppedAt),
      duration: calculateDuration(job.startedAt, job.stoppedAt),
      s3OutputPath: outputPath ? `s3://${getEnvOrThrow('OUTPUT_BUCKET')}/${outputPath}` : null,
    };

    if (job.statusReason) result.statusReason = job.statusReason;
    if (job.container) {
      result.container = {
        exitCode: job.container.exitCode,
        ...(job.container.logStreamName && {
          logGroup: '/aws/batch/atx-transform',
          logStreamName: job.container.logStreamName,
        }),
      };
    }

    return jsonResponse(200, result);
  } catch (e) {
    if (e instanceof JobQueueMismatchError) return errorResponse(403, 'Access denied: job does not belong to ATX queue');
    logger.error('Failed to get job status', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
