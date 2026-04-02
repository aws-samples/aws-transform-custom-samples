import { randomUUID } from 'crypto';
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch';
import { jsonResponse, errorResponse, validateJobRequest, validateEnvironment, getEnvOrThrow, logger } from '../utils';

const batch = new BatchClient({});

interface TriggerJobRequest {
  source?: string;
  command: string;
  jobName?: string;
  output?: string;
  tags?: Record<string, string>;
  environment?: Record<string, string>;
}

const ALLOWED_ENV_KEYS = new Set(['JAVA_VERSION', 'PYTHON_VERSION', 'NODE_VERSION']);

export async function handler(event: TriggerJobRequest) {
  try {
    const validationError = validateJobRequest(event);
    if (validationError) return errorResponse(400, validationError);

    if (event.environment) {
      const envError = validateEnvironment(event.environment);
      if (envError) return errorResponse(400, envError);
    }

    const jobName = event.jobName!;
    const output = event.output || `transformations/job-${randomUUID()}/`;
    const outputBucket = getEnvOrThrow('OUTPUT_BUCKET');

    const containerCommand = ['--output', output];
    if (event.source) containerCommand.push('--source', event.source);
    containerCommand.push('--command', event.command);

    // Build environment overrides for version switching
    const environmentOverrides: Array<{ name: string; value: string }> = [];
    if (event.environment) {
      for (const [key, value] of Object.entries(event.environment)) {
        if (ALLOWED_ENV_KEYS.has(key)) {
          environmentOverrides.push({ name: key, value });
        } else {
          logger.info('Ignoring unrecognized environment key', { key });
        }
      }
    }

    const response = await batch.send(new SubmitJobCommand({
      jobName,
      jobQueue: getEnvOrThrow('JOB_QUEUE'),
      jobDefinition: getEnvOrThrow('JOB_DEFINITION'),
      containerOverrides: {
        command: containerCommand,
        ...(environmentOverrides.length > 0 && { environment: environmentOverrides }),
      },
      tags: { ...event.tags, outputPath: output },
    }));

    return jsonResponse(200, {
      batchJobId: response.jobId,
      jobName: response.jobName,
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      s3OutputPath: `s3://${outputBucket}/${output}`,
    });
  } catch (e) {
    logger.error('Failed to submit job', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
