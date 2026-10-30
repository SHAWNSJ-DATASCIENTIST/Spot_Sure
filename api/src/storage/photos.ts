import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../config/env.js";
import { AppError } from "../http/errors.js";

// Where listing photo bytes live. Only server-generated keys are ever used;
// nothing from the client becomes part of a path.
//
//   local         PHOTO_STORAGE_DIR set: files on this server's disk. Fine for
//                 development and single-instance deployments with a persistent volume.
//   unconfigured  nothing set: uploads and reads answer 503, honestly.
//
// An S3-compatible driver is the intended production backend; it is not
// implemented yet (see docs/architecture.md).

export interface PhotoStorage {
  readonly driver: "local" | "unconfigured";
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/;

export function photoKey(spaceId: string, photoId: string, type: "image/jpeg" | "image/png"): string {
  return `${spaceId}/${photoId}.${type === "image/jpeg" ? "jpg" : "png"}`;
}

export class StorageNotConfiguredError extends AppError {
  constructor() {
    super(503, "storage_not_configured", "Photo storage isn't configured on this server");
  }
}

class UnconfiguredStorage implements PhotoStorage {
  readonly driver = "unconfigured" as const;
  async put(): Promise<void> {
    throw new StorageNotConfiguredError();
  }
  async read(): Promise<Buffer> {
    throw new StorageNotConfiguredError();
  }
  async remove(): Promise<void> {
    throw new StorageNotConfiguredError();
  }
}

export class LocalDiskStorage implements PhotoStorage {
  readonly driver = "local" as const;
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!KEY.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" });
  }
  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

export function buildPhotoStorage(env: Env): PhotoStorage {
  return env.PHOTO_STORAGE_DIR ? new LocalDiskStorage(path.resolve(env.PHOTO_STORAGE_DIR)) : new UnconfiguredStorage();
}
