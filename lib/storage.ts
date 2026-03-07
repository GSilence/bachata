/**
 * Абстракция файлового хранилища: S3-совместимое хранилище (продакшн) или локальная папка (dev).
 *
 * Переменные окружения (.env):
 *   S3_ENDPOINT    — URL эндпоинта (https://s3.ru1.storage.beget.cloud)
 *   S3_ACCESS_KEY  — Access Key
 *   S3_SECRET_KEY  — Secret Key
 *   S3_BUCKET      — имя бакета (334d70034ab9-bachata-music)
 *   S3_REGION      — регион (ru1 или us-east-1 если не важен)
 *   S3_CDN_URL     — публичный URL бакета для чтения файлов
 *                    (https://334d70034ab9-bachata-music.s3.ru1.storage.beget.cloud)
 *
 * Если S3_ACCESS_KEY не задан — все операции работают локально (public/uploads/).
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";

function getS3Client(): S3Client | null {
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (!accessKey || !secretKey) return null;

  const endpoint = process.env.S3_ENDPOINT || "https://s3.ru1.storage.beget.cloud";
  const region   = process.env.S3_REGION   || "us-east-1";

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true, // путь-стиль: endpoint/bucket/key (надёжнее для сторонних S3)
  });
}

function getBucket(): string {
  return process.env.S3_BUCKET || "";
}

/** true если S3-хранилище настроено */
export function isS3Enabled(): boolean {
  return !!(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET);
}

/** @deprecated используй isS3Enabled() */
export const isB2Enabled = isS3Enabled;

/**
 * Возвращает публичный URL для ключа.
 * key — путь внутри бакета, напр. "raw/song.mp3"
 * - S3:    https://334d70034ab9-bachata-music.s3.ru1.storage.beget.cloud/raw/song.mp3
 * - local: /uploads/raw/song.mp3
 */
export function getFileUrl(key: string): string {
  if (isS3Enabled()) {
    const cdn = (process.env.S3_CDN_URL || "").replace(/\/$/, "");
    return `${cdn}/${key}`;
  }
  return `/uploads/${key}`;
}

function getContentType(key: string): string {
  const ext = (key.split(".").pop() || "").toLowerCase();
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
    flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac",
  };
  return mimeMap[ext] || "application/octet-stream";
}

/**
 * Загружает Buffer в S3.
 * @param buffer     — содержимое файла
 * @param key        — путь внутри бакета (напр. "queue/song.mp3")
 * @returns публичный URL файла
 */
export async function uploadBuffer(
  buffer: Buffer,
  key: string,
): Promise<string> {
  const client = getS3Client();
  if (!client) return getFileUrl(key);

  await client.send(
    new PutObjectCommand({
      Bucket:      getBucket(),
      Key:         key,
      Body:        buffer,
      ContentType: getContentType(key),
    }),
  );

  return getFileUrl(key);
}

/**
 * Загружает файл с диска в S3.
 * @param localPath  — абсолютный путь к файлу на диске
 * @param key        — путь внутри бакета (напр. "raw/song.mp3")
 * @returns публичный URL файла
 */
export async function uploadFile(
  localPath: string,
  key: string,
): Promise<string> {
  const client = getS3Client();
  if (!client) return getFileUrl(key);

  const buffer = readFileSync(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket:      getBucket(),
      Key:         key,
      Body:        buffer,
      ContentType: getContentType(key),
    }),
  );

  return getFileUrl(key);
}

/**
 * Скачивает файл из S3 в локальный путь.
 */
export async function downloadFile(key: string, localPath: string): Promise<void> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = getS3Client();
  if (!client) throw new Error("S3 not configured");

  const resp = await client.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const { writeFileSync } = await import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chunks: Buffer[] = [];
  for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  writeFileSync(localPath, Buffer.concat(chunks));
}

/**
 * Удаляет файл из S3. В local-режиме — ничего не делает (удаляй через fs).
 */
export async function deleteFile(key: string): Promise<void> {
  const client = getS3Client();
  if (!client) return;

  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

/**
 * Извлекает S3-ключ из полного URL.
 * "https://....beget.cloud/raw/song.mp3" → "raw/song.mp3"
 * "/uploads/raw/song.mp3"               → "raw/song.mp3"
 * Возвращает null если не удаётся распознать.
 */
export function keyFromUrl(url: string): string | null {
  if (!url) return null;
  const cdn = (process.env.S3_CDN_URL || "").replace(/\/$/, "");
  if (cdn && url.startsWith(cdn + "/")) return url.slice(cdn.length + 1);
  if (url.startsWith("/uploads/")) return url.slice("/uploads/".length);
  return null;
}
