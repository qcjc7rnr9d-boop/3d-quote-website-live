import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

function safeName(name = 'model-file') {
  const cleaned = String(name || 'model-file')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'model-file';
}

function storageMode() {
  if ((process.env.SHOPIFY_FILE_STORAGE || '').toLowerCase() === 's3' || process.env.SHOPIFY_S3_BUCKET) return 's3';
  return 'local';
}

export function shopifyFileStorageStatus() {
  const mode = storageMode();
  return {
    mode,
    productionReady: mode === 's3',
    bucket: process.env.SHOPIFY_S3_BUCKET || null,
    publicBaseUrl: process.env.SHOPIFY_S3_PUBLIC_BASE_URL || null,
  };
}

async function storeLocal(file, { shopId, token }) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production Shopify file storage requires SHOPIFY_FILE_STORAGE=s3 and SHOPIFY_S3_BUCKET.');
  }
  const fileName = safeName(file.originalname);
  const key = `uploads/shopify-quote-files/${shopId}/${token}/${randomUUID()}-${fileName}`;
  const abs = join(ROOT_DIR, key);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, file.buffer);
  return {
    name: fileName,
    size: file.size,
    mimeType: file.mimetype || null,
    key,
    storage: 'local',
    url: `/${key}`,
  };
}

async function storeS3(file, { shopId, token }) {
  const bucket = process.env.SHOPIFY_S3_BUCKET;
  if (!bucket) throw new Error('SHOPIFY_S3_BUCKET is required for Shopify S3 file storage.');
  const [{ S3Client, PutObjectCommand, GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/s3-request-presigner'),
  ]);
  const region = process.env.SHOPIFY_S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const endpoint = process.env.SHOPIFY_S3_ENDPOINT || undefined;
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: process.env.SHOPIFY_S3_FORCE_PATH_STYLE === '1',
    credentials: process.env.SHOPIFY_S3_ACCESS_KEY_ID ? {
      accessKeyId: process.env.SHOPIFY_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.SHOPIFY_S3_SECRET_ACCESS_KEY,
    } : undefined,
  });
  const fileName = safeName(file.originalname);
  const key = `shopify-quote-files/${shopId}/${token}/${randomUUID()}-${fileName}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
  }));
  const signedUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: Number(process.env.SHOPIFY_S3_SIGNED_URL_SECONDS || 60 * 60 * 24 * 7),
  });
  return {
    name: fileName,
    size: file.size,
    mimeType: file.mimetype || null,
    key,
    storage: 's3',
    url: process.env.SHOPIFY_S3_PUBLIC_BASE_URL
      ? `${process.env.SHOPIFY_S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
      : signedUrl,
    signedUrl,
  };
}

export async function storeShopifyQuoteFile(file, context) {
  if (!file?.buffer?.length) throw new Error('Uploaded file is empty.');
  return storageMode() === 's3' ? storeS3(file, context) : storeLocal(file, context);
}
