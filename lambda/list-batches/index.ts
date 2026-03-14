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
    let startAfter = event.nextToken;
    let lastKey: string | undefined;
    let hasMore = true;

    while (batches.length < maxResults && hasMore) {
      const response = await s3.send(new ListObjectsV2Command({
        Bucket: getEnvOrThrow('OUTPUT_BUCKET'),
        Prefix: 'batch-jobs/',
        MaxKeys: 1000,
        ...(startAfter ? { StartAfter: startAfter } : {}),
      }));

      for (const obj of response.Contents || []) {
        lastKey = obj.Key;
        if (obj.Key?.endsWith('-output.json')) {
          batches.push({
            batchId: obj.Key!.replace('batch-jobs/', '').replace('-output.json', ''),
            lastModified: obj.LastModified?.toISOString() || null,
          });
          if (batches.length >= maxResults) break;
        }
      }

      hasMore = !!response.IsTruncated || batches.length >= maxResults;
      if (response.IsTruncated) {
        // More S3 pages exist — advance past the last key we saw
        startAfter = lastKey;
      } else if (batches.length >= maxResults) {
        // We filled our page within this S3 response but S3 has no more pages.
        // There may be unprocessed keys after our early break — use lastKey to resume.
        startAfter = lastKey;
      } else {
        // S3 exhausted and we didn't fill our page — no more results
        hasMore = false;
      }
    }

    // Only return a nextToken if we stopped early (hit maxResults)
    const moreAvailable = batches.length >= maxResults;

    return jsonResponse(200, {
      batches,
      count: batches.length,
      ...(moreAvailable && lastKey ? { nextToken: lastKey } : {}),
    });
  } catch (e) {
    logger.error('Failed to list batches', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
