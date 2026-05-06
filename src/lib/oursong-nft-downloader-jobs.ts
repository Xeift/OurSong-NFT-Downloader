import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createOurSongDownloadFile,
  parseOurSongDownloadRequest,
  type DownloadFormat,
  type OurSongDownloadProgressPhase,
  type OurSongDownloadProgressUpdate,
} from "@/lib/oursong-nft-downloader";

type OurSongDownloadJobStatus = "queued" | "processing" | "completed" | "failed";

export type OurSongDownloadJobSnapshot = {
  id: string;
  status: OurSongDownloadJobStatus;
  progress: number;
  phase: OurSongDownloadProgressPhase;
  creatorId?: string;
  creatorIndex?: number;
  creatorTotal?: number;
  nftId?: string;
  nftIndex?: number;
  nftTotal?: number;
  error?: string;
};

type OurSongDownloadJob = {
  id: string;
  status: OurSongDownloadJobStatus;
  progress: number;
  phase: OurSongDownloadProgressPhase;
  creatorIds: string[];
  format: DownloadFormat;
  createdAt: number;
  updatedAt: number;
  listeners: Set<(snapshot: OurSongDownloadJobSnapshot) => void>;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  creatorId?: string;
  creatorIndex?: number;
  creatorTotal?: number;
  nftId?: string;
  nftIndex?: number;
  nftTotal?: number;
  filename?: string;
  filePath?: string;
  contentType?: string;
  error?: string;
};

type OurSongJobStore = {
  jobs: Map<string, OurSongDownloadJob>;
};

export class TooManyActiveJobsError extends Error {}
export class JobNotReadyError extends Error {}

const maxActiveJobs = 3;
const jobTtlMs = 10 * 60 * 1000;
const tempDirectory = path.join(tmpdir(), "xeift-oursong-nft-downloader");

const globalStore = globalThis as typeof globalThis & {
  __oursongNftDownloaderJobStore?: OurSongJobStore;
};

const store =
  globalStore.__oursongNftDownloaderJobStore ??
  (globalStore.__oursongNftDownloaderJobStore = {
    jobs: new Map<string, OurSongDownloadJob>(),
  });

function getActiveJobCount() {
  return Array.from(store.jobs.values()).filter((job) => job.status === "queued" || job.status === "processing").length;
}

function getSnapshot(job: OurSongDownloadJob): OurSongDownloadJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    creatorId: job.creatorId,
    creatorIndex: job.creatorIndex,
    creatorTotal: job.creatorTotal,
    nftId: job.nftId,
    nftIndex: job.nftIndex,
    nftTotal: job.nftTotal,
    error: job.error,
  };
}

function publish(job: OurSongDownloadJob) {
  const snapshot = getSnapshot(job);

  for (const listener of job.listeners) {
    listener(snapshot);
  }
}

function updateJob(job: OurSongDownloadJob, update: Partial<OurSongDownloadJob>) {
  Object.assign(job, update, { updatedAt: Date.now() });
  publish(job);
}

function setJobCleanup(job: OurSongDownloadJob) {
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }

  job.cleanupTimer = setTimeout(() => {
    const currentJob = store.jobs.get(job.id);

    if (!currentJob) {
      return;
    }

    store.jobs.delete(job.id);
    currentJob.listeners.clear();

    if (currentJob.filePath) {
      void rm(currentJob.filePath, { force: true });
    }
  }, jobTtlMs);
}

function updateProgress(job: OurSongDownloadJob, update: OurSongDownloadProgressUpdate) {
  updateJob(job, {
    status: "processing",
    progress: Math.max(job.progress, update.progress),
    phase: update.phase,
    creatorId: update.creatorId,
    creatorIndex: update.creatorIndex,
    creatorTotal: update.creatorTotal,
    nftId: update.nftId,
    nftIndex: update.nftIndex,
    nftTotal: update.nftTotal,
  });
}

async function writeJobFile(job: OurSongDownloadJob, buffer: Buffer, filename: string) {
  await mkdir(tempDirectory, { recursive: true });

  const filePath = path.join(tempDirectory, `${job.id}-${filename}`);

  await writeFile(filePath, buffer);

  return filePath;
}

async function runJob(jobId: string) {
  const job = store.jobs.get(jobId);

  if (!job) {
    throw new Error(`Unknown OurSong downloader job: ${jobId}`);
  }

  try {
    updateJob(job, {
      status: "processing",
      progress: 0,
      phase: "queued",
    });

    const file = await createOurSongDownloadFile(job.creatorIds, job.format, (update) => updateProgress(job, update));
    const filePath = await writeJobFile(job, file.buffer, file.filename);

    updateJob(job, {
      status: "completed",
      progress: 100,
      phase: "completed",
      filename: file.filename,
      filePath,
      contentType: file.contentType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OurSong downloader error";

    updateJob(job, {
      status: "failed",
      phase: "failed",
      error: message,
    });
  } finally {
    setJobCleanup(job);
  }
}

export function createOurSongDownloadJob(payload: unknown) {
  if (getActiveJobCount() >= maxActiveJobs) {
    throw new TooManyActiveJobsError("Too many active OurSong downloader jobs");
  }

  const { creatorIds, format } = parseOurSongDownloadRequest(payload);
  const job: OurSongDownloadJob = {
    id: randomUUID(),
    status: "queued",
    progress: 0,
    phase: "queued",
    creatorIds,
    format,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    listeners: new Set<(snapshot: OurSongDownloadJobSnapshot) => void>(),
    cleanupTimer: null,
  };

  store.jobs.set(job.id, job);
  void runJob(job.id);

  return getSnapshot(job);
}

export function getOurSongDownloadJob(jobId: string) {
  const job = store.jobs.get(jobId);

  if (!job) {
    return null;
  }

  return getSnapshot(job);
}

export function subscribeToOurSongDownloadJob(
  jobId: string,
  listener: (snapshot: OurSongDownloadJobSnapshot) => void,
) {
  const job = store.jobs.get(jobId);

  if (!job) {
    return null;
  }

  job.listeners.add(listener);
  listener(getSnapshot(job));

  return () => {
    job.listeners.delete(listener);
  };
}

export async function readOurSongDownloadJobFile(jobId: string) {
  const job = store.jobs.get(jobId);

  if (!job) {
    return null;
  }

  if (job.status !== "completed" || !job.filePath || !job.filename || !job.contentType) {
    throw new JobNotReadyError(`OurSong downloader job is not ready: ${jobId}`);
  }

  return {
    buffer: await readFile(job.filePath),
    contentType: job.contentType,
    filename: job.filename,
    format: job.format,
  };
}
