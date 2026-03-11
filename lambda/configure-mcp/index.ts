import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { jsonResponse, errorResponse, getEnvOrThrow, logger } from '../utils';

const s3 = new S3Client({});

interface ConfigureMcpRequest {
  mcpConfig: Record<string, unknown>;
}

export async function handler(event: ConfigureMcpRequest) {
  try {
    if (!event.mcpConfig || typeof event.mcpConfig !== 'object') {
      return errorResponse(400, 'Request must contain mcpConfig object');
    }

    const sourceBucket = getEnvOrThrow('SOURCE_BUCKET');
    const s3Key = 'mcp-config/mcp.json';

    await s3.send(new PutObjectCommand({
      Bucket: sourceBucket,
      Key: s3Key,
      Body: JSON.stringify(event.mcpConfig, null, 2),
      ContentType: 'application/json',
    }));

    return jsonResponse(200, {
      message: 'MCP configuration saved successfully',
      s3Path: `s3://${sourceBucket}/${s3Key}`,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('Failed to save MCP config', { error: (e as Error).message });
    return errorResponse(500, (e as Error).message);
  }
}
