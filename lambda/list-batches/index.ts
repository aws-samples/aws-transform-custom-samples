import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { jsonResponse, errorResponse, getEnvOrThrow, logger } from '../utils';

const s3 = new S3Client({});

interface ListBatchesRequest {
  maxResults?: number;
  nextToken?: string;
}

export async function handler(event: ListBatchesRequest) {
  try {
    const maxResults = Math.min(event.maxResults || 50, 100);
    const batches: Array<{ batchId: string; lastModified: string | null }> = [];
    let continuationToken = event.nextToken;

    while (batches.length < maxResults) {
      const response = await s3.send(new ListObjectsV2Command({
        Bucket: getEnvOrThrow('OUTPUT_BUCKET'),
        Prefix: 'batch-jobs/',
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }));

      for (const obj of response.Contents || []) {
        if (obj.Key?.endsWith('-output.json')) {
          batches.push({
            batchId: obj.Key!.replace('batch-jobs/', '').replace('-output.json', ''),
            lastModified: obj.LastModified?.toISOString() || null,
          });
          if (batches.length >= maxResults) break;
        }
      }

      continuationToken = response.NextContinuationToken;
      if (!continuationToken) break;
    }

    return jsonResponse(200, {
      batches,
      count: batches.length,
      ...(continuationToken && { nextToken: continuationToken }),
    });
  } catch (e) {
    logger.error('Failed to list batches', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
