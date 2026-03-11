import { BatchClient, DescribeJobsCommand, TerminateJobCommand } from '@aws-sdk/client-batch';
import { jsonResponse, errorResponse, logger } from '../utils';

const batch = new BatchClient({});

interface TerminateJobRequest {
  jobId: string;
}

export async function handler(event: TerminateJobRequest) {
  try {
    if (!event.jobId) return errorResponse(400, 'Missing jobId');

    const { jobs } = await batch.send(new DescribeJobsCommand({ jobs: [event.jobId] }));
    if (!jobs?.length) return errorResponse(404, `Job not found: ${event.jobId}`);

    const previousStatus = jobs[0].status!;
    if (previousStatus === 'SUCCEEDED' || previousStatus === 'FAILED') {
      return errorResponse(409, `Job ${event.jobId} is already ${previousStatus}`);
    }

    await batch.send(new TerminateJobCommand({ jobId: event.jobId, reason: 'Terminated by user' }));
    const { jobs: updated } = await batch.send(new DescribeJobsCommand({ jobs: [event.jobId] }));

    return jsonResponse(200, {
      jobId: event.jobId,
      previousStatus,
      currentStatus: updated?.[0]?.status,
      terminatedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('Failed to terminate job', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
