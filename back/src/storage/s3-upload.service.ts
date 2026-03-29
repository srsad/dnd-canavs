import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').slice(0, 180);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || 'image';
}

@Injectable()
export class S3UploadService {
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): S3Client {
    if (this.client) {
      return this.client;
    }
    const endpoint = this.config.get<string>('S3_ENDPOINT')?.trim();
    const region = this.config.get<string>('S3_REGION')?.trim() || 'us-east-1';
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY')?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException(
        'S3 upload is not configured (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).',
      );
    }
    const forcePathStyle =
      this.config.get<string>('S3_FORCE_PATH_STYLE')?.trim().toLowerCase() === 'true' ||
      this.config.get<string>('S3_FORCE_PATH_STYLE')?.trim() === '1';
    this.client = new S3Client({
      region,
      endpoint: trimTrailingSlash(endpoint),
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });
    return this.client;
  }

  private getBucket(): string {
    const bucket = this.config.get<string>('S3_BUCKET')?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException('S3_BUCKET is not set.');
    }
    return bucket;
  }

  buildObjectKey(roomSlug: string, fileName: string): string {
    const safe = sanitizeFileName(fileName);
    return `rooms/${roomSlug}/${randomUUID()}-${safe}`;
  }

  buildPublicUrl(key: string): string {
    const explicit = this.config.get<string>('S3_PUBLIC_BASE_URL')?.trim();
    if (explicit) {
      return `${trimTrailingSlash(explicit)}/${key}`;
    }
    const endpoint = trimTrailingSlash(this.config.get<string>('S3_ENDPOINT')!.trim());
    const bucket = this.getBucket();
    return `${endpoint}/${bucket}/${key}`;
  }

  async createPresignedPut(params: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{
    uploadUrl: string;
    publicUrl: string;
    headers: Record<string, string>;
    key: string;
  }> {
    const bucket = this.getBucket();
    const client = this.getClient();
    const acl = this.config.get<string>('S3_OBJECT_ACL')?.trim();

    const input: ConstructorParameters<typeof PutObjectCommand>[0] = {
      Bucket: bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    };
    if (acl) {
      input.ACL = acl as typeof input.ACL;
    }

    const command = new PutObjectCommand(input);
    const expiresIn = Math.min(
      3600,
      Math.max(60, Number(this.config.get('S3_PRESIGN_EXPIRES_SEC')) || 900),
    );
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(client, command, { expiresIn });
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Failed to sign S3 upload URL.',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': params.contentType,
    };
    if (Number.isFinite(params.contentLength) && params.contentLength > 0) {
      headers['Content-Length'] = String(params.contentLength);
    }

    return {
      uploadUrl,
      publicUrl: this.buildPublicUrl(params.key),
      headers,
      key: params.key,
    };
  }

  /** Server-side upload (avoids browser→S3 CORS). */
  async putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ publicUrl: string; key: string }> {
    const bucket = this.getBucket();
    const client = this.getClient();
    const acl = this.config.get<string>('S3_OBJECT_ACL')?.trim();

    const input: ConstructorParameters<typeof PutObjectCommand>[0] = {
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    };
    if (acl) {
      input.ACL = acl as typeof input.ACL;
    }

    try {
      await client.send(new PutObjectCommand(input));
    } catch (err) {
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'S3 PutObject failed.',
      );
    }

    return {
      publicUrl: this.buildPublicUrl(params.key),
      key: params.key,
    };
  }
}
