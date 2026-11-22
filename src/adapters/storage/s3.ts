import "server-only";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnvironment } from "@/configuration/environment";
import { assertSafeKey, type FileStorage } from "./types";

let client: S3Client | undefined;

/** Any S3-compatible store: Supabase Storage's S3 endpoint now, Google Cloud Storage (interoperability) later. */
function s3(): { client: S3Client; bucket: string } {
  const environment = getEnvironment();
  if (!environment.S3_ENDPOINT || !environment.S3_BUCKET || !environment.S3_ACCESS_KEY_ID || !environment.S3_SECRET_ACCESS_KEY) {
    throw new Error("Set S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  client ??= new S3Client({
    endpoint: environment.S3_ENDPOINT,
    region: environment.S3_REGION ?? "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY },
  });
  return { client, bucket: environment.S3_BUCKET };
}

export const s3Storage: FileStorage = {
  async put(key, bytes, contentType) {
    const { client, bucket } = s3();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: assertSafeKey(key), Body: bytes, ContentType: contentType }));
  },
  async getSignedUrl(key, expiresInSeconds = 600) {
    const { client, bucket } = s3();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }), { expiresIn: expiresInSeconds });
  },
  async get(key) {
    const { client, bucket } = s3();
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
      if (!object.Body) return null;
      return { bytes: await object.Body.transformToByteArray(), contentType: object.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  },
  async delete(key) {
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }));
  },
};
