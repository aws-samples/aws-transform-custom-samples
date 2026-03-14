import { randomUUID } from 'crypto';
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse, errorResponse, validateJobRequest, getEnvOrThrow, logger } from '../utils';

const batch = new BatchClient({});
const s3 = new S3Client({});
const MAX_BATCH_SIZE = 128;
const ALLOWED_ENV_KEYS = new Set(['JAVA_VERSION', 'PYTHON_VERSION', 'NODE_VERSION']);

interface TriggerBatchJobsRequest {
  batchName?: string;
  jobs: Array<{
    source?: string;
    command: string;
    jobName: string;
    tags?: Record<string, string>;
    environment?: Record<string, string>;
  }>;
}

export async function handler(event: TriggerBatchJobsRequest) {
  try {
    if (!event.jobs?.length) return errorResponse(400, 'Missing or empty jobs array');
    if (event.jobs.length > MAX_BATCH_SIZE) {
      return errorResponse(400, `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    for (let i = 0; i < event.jobs.length; i++) {
      const error = validateJobRequest(event.jobs[i]);
      if (error) return errorResponse(400, `Job ${i}: ${error}`);
    }

    const batchId = `batch-${randomUUID()}`;
    const batchName = event.batchName || batchId;
    const jobQueue = getEnvOrThrow('JOB_QUEUE');
    const jobDefinition = getEnvOrThrow('JOB_DEFINITION');
    const outputBucket = getEnvOrThrow('OUTPUT_BUCKET');
    const manifestKey = `batch-jobs/${batchId}-output.json`;
    const results: Array<Record<string, unknown>> = [];

    const writeManifest = async () => {
      await s3.send(new PutObjectCommand({
        Bucket: outputBucket,
        Key: manifestKey,
        Body: JSON.stringify({ batchId, batchName, submittedAt: new Date().toISOString(), jobs: results }, null, 2),
        ContentType: 'application/json',
      }));
    };

    for (const job of event.jobs) {
      const output = `transformations/${batchId}/job-${randomUUID()}/`;
      try {
        const containerCommand = ['--output', output];
        if (job.source) containerCommand.push('--source', job.source);
        containerCommand.push('--command', job.command);

        // Build environment overrides for version switching
        const environmentOverrides: Array<{ name: string; value: string }> = [];
        if (job.environment) {
          for (const [key, value] of Object.entries(job.environment)) {
            if (ALLOWED_ENV_KEYS.has(key)) {
              environmentOverrides.push({ name: key, value });
            }
          }
        }

        const response = await batch.send(new SubmitJobCommand({
          jobName: job.jobName, jobQueue, jobDefinition,
          containerOverrides: {
            command: containerCommand,
            ...(environmentOverrides.length > 0 && { environment: environmentOverrides }),
          },
          tags: { ...job.tags, outputPath: output },
        }));
        results.push({ jobName: job.jobName, batchJobId: response.jobId, status: 'SUBMITTED', s3OutputPath: output });
      } catch (e) {
        results.push({ jobName: job.jobName, batchJobId: null, status: 'FAILED', error: (e as Error).message });
      }
    }

    // Write manifest — if this fails, log the results so they aren't completely lost
    try {
      await writeManifest();
    } catch (e) {
      logger.error('Failed to write batch manifest to S3', {
        batchId,
        submittedJobIds: results.filter(r => r.batchJobId).map(r => r.batchJobId),
        error: (e as Error).message,
      });
      return errorResponse(500, `Jobs were submitted but manifest write failed. Batch ID: ${batchId}. Submitted job IDs: ${results.filter(r => r.batchJobId).map(r => r.batchJobId).join(', ')}`);
    }

    return jsonResponse(200, {
      batchId, batchName,
      totalJobs: results.length,
      submitted: results.filter(r => r.status === 'SUBMITTED').length,
      failed: results.filter(r => r.status === 'FAILED').length,
    });
  } catch (e) {
    logger.error('Failed to submit batch', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
