"use client";

import { AlertCircle, CheckCircle2, Download, FileJson, LoaderCircle, Table2, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

type DownloadFormat = "json" | "xlsx";
type JobStatus = "queued" | "processing" | "completed" | "failed";
type ProgressPhase =
  | "queued"
  | "fetching_creator_nfts"
  | "fetching_nft_data"
  | "creating_json"
  | "creating_xlsx"
  | "completed"
  | "failed";
type JobSnapshot = {
  id: string;
  status: JobStatus;
  progress: number;
  phase: ProgressPhase;
  creatorId?: string;
  creatorIndex?: number;
  creatorTotal?: number;
  nftId?: string;
  nftIndex?: number;
  nftTotal?: number;
  error?: string;
};
type SubmitStatus =
  | { kind: "ready" }
  | ({ kind: "processing" } & JobSnapshot)
  | { kind: "success" }
  | { kind: "error"; message: string };

const invalidDownloadResponse = "下載器回應格式不正確";

const progressStages: Array<{ phases: ProgressPhase[]; start: number; end: number; label: string }> = [
  { phases: ["queued"], start: 0, end: 10, label: "佇列" },
  { phases: ["fetching_creator_nfts"], start: 10, end: 30, label: "作品" },
  { phases: ["fetching_nft_data"], start: 30, end: 75, label: "持有者" },
  { phases: ["creating_json", "creating_xlsx"], start: 75, end: 95, label: "檔案" },
  { phases: ["completed"], start: 95, end: 100, label: "完成" },
];

const faqItems = [
  {
    question: "創作者 ID 是什麼？",
    answer: "OurSong 個人頁面 @ 後面的那串字。多個 ID 可以用逗號或換行分隔。",
  },
  {
    question: "XLSX 和 JSON 差在哪？",
    answer: "XLSX 適合用試算表閱讀，JSON 適合後續程式處理。",
  },
  {
    question: "資料來源是什麼？",
    answer: "資料透過 OurSong 官方 Open API 取得。",
  },
  {
    question: "為什麼沒有持有者地址？",
    answer: "持有者地址需要本人授權取得 authenticate code。完整帳戶或鏈上資料請詢問 OurSong 客服。",
  },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function parseCreatorIds(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDownloadFilename(contentDisposition: string | null) {
  if (!contentDisposition) {
    throw new Error(invalidDownloadResponse);
  }

  const match = /filename="([^"]+)"/.exec(contentDisposition);

  if (!match) {
    throw new Error(invalidDownloadResponse);
  }

  return match[1];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

async function readErrorMessage(response: Response) {
  const payload = (await response.json()) as { error?: unknown };

  if (typeof payload.error !== "string") {
    throw new Error(invalidDownloadResponse);
  }

  return payload.error;
}

async function readJobId(response: Response) {
  const payload = (await response.json()) as { jobId?: unknown };

  if (typeof payload.jobId !== "string") {
    throw new Error(invalidDownloadResponse);
  }

  return payload.jobId;
}

function createQueuedSnapshot(): JobSnapshot {
  return {
    id: "",
    status: "queued",
    progress: 0,
    phase: "queued",
  };
}

function waitForJobCompletion(jobId: string, onProgress: (snapshot: JobSnapshot) => void) {
  return new Promise<void>((resolve, reject) => {
    const events = new EventSource(`/api/tools/oursong-nft-downloader/jobs/${encodeURIComponent(jobId)}/events`);

    events.addEventListener("job", (event) => {
      const snapshot = JSON.parse(event.data) as JobSnapshot;

      onProgress(snapshot);

      if (snapshot.status === "completed") {
        events.close();
        resolve();
        return;
      }

      if (snapshot.status === "failed") {
        events.close();

        if (typeof snapshot.error !== "string") {
          reject(new Error(invalidDownloadResponse));
          return;
        }

        reject(new Error(snapshot.error));
      }
    });

    events.onerror = () => {
      events.close();
      reject(new Error(invalidDownloadResponse));
    };
  });
}

async function downloadJobFile(jobId: string) {
  const response = await fetch(`/api/tools/oursong-nft-downloader/jobs/${encodeURIComponent(jobId)}/download`);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const filename = readDownloadFilename(response.headers.get("Content-Disposition"));
  const blob = await response.blob();

  downloadBlob(blob, filename);
}

function getStageFill(progress: number, stage: (typeof progressStages)[number]) {
  if (progress >= stage.end) {
    return 100;
  }

  if (progress <= stage.start) {
    return 0;
  }

  return Math.round(((progress - stage.start) / (stage.end - stage.start)) * 100);
}

function getProgressDetail(snapshot: JobSnapshot) {
  if (snapshot.phase === "fetching_creator_nfts") {
    return `正在讀取 ${snapshot.creatorId} 的作品清單 (${snapshot.creatorIndex}/${snapshot.creatorTotal})`;
  }

  if (snapshot.phase === "fetching_nft_data") {
    return `正在讀取 ${snapshot.creatorId} 的 NFT 與持有者資料 (${snapshot.nftIndex}/${snapshot.nftTotal})`;
  }

  if (snapshot.phase === "creating_json") {
    return "正在建立 JSON 檔案";
  }

  if (snapshot.phase === "creating_xlsx") {
    return `正在建立 ${snapshot.creatorId} 的 XLSX 工作表 (${snapshot.nftIndex}/${snapshot.nftTotal})`;
  }

  if (snapshot.phase === "completed") {
    return "檔案已建立";
  }

  if (snapshot.phase === "failed" && typeof snapshot.error === "string") {
    return snapshot.error;
  }

  return "等待開始";
}

function FormatButton({
  icon: Icon,
  label,
  selected,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-12 flex-1 items-center justify-center gap-2 border px-4 py-3 text-sm transition duration-200",
        selected
          ? "border-zinc-500 bg-zinc-800 text-zinc-100"
          : "border-zinc-800 bg-zinc-950/70 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      {label}
    </button>
  );
}

function StatusIcon({ status }: { status: SubmitStatus }) {
  if (status.kind === "processing") {
    return <LoaderCircle className="h-4 w-4 animate-spin text-zinc-500" strokeWidth={1.7} aria-hidden="true" />;
  }

  if (status.kind === "success") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={1.7} aria-hidden="true" />;
  }

  if (status.kind === "error") {
    return <AlertCircle className="h-4 w-4 text-rose-400" strokeWidth={1.7} aria-hidden="true" />;
  }

  return <span className="h-2 w-2 bg-zinc-500" />;
}

export default function OurSongNftDownloaderPage() {
  const [creatorIdsInput, setCreatorIdsInput] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("xlsx");
  const [status, setStatus] = useState<SubmitStatus>({ kind: "ready" });
  const submitting = status.kind === "processing";
  const progress = status.kind === "processing" ? Math.round(status.progress) : 0;
  const statusTitle =
    status.kind === "ready"
      ? "準備就緒"
      : status.kind === "processing"
        ? "處理中"
        : status.kind === "success"
          ? "下載完成"
          : "發生錯誤";
  const statusDetail =
    status.kind === "ready"
      ? "輸入創作者 ID 後即可建立下載檔。"
      : status.kind === "processing"
        ? getProgressDetail(status)
        : status.kind === "success"
          ? "瀏覽器已開始下載檔案。"
          : status.message;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const creatorIds = parseCreatorIds(creatorIdsInput);

    if (creatorIds.length === 0) {
      setStatus({ kind: "error", message: "請輸入至少一個創作者 ID" });
      return;
    }

    setStatus({ kind: "processing", ...createQueuedSnapshot() });

    try {
      const response = await fetch("/api/tools/oursong-nft-downloader/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ creatorIds, format }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const jobId = await readJobId(response);

      await waitForJobCompletion(jobId, (snapshot) => setStatus({ kind: "processing", ...snapshot }));
      await downloadJobFile(jobId);
      setStatus({ kind: "success" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : invalidDownloadResponse,
      });
    }
  };

  return (
    <main className="min-h-screen bg-[#0d0d0f] text-zinc-400 selection:bg-zinc-300 selection:text-zinc-950">
      <header className="border-b border-zinc-800 bg-[#0d0d0f]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <div className="text-sm font-semibold text-zinc-200">OurSong NFT Downloader</div>
            <div className="mt-1 text-xs text-zinc-600">Local</div>
          </div>
          <a
            href="https://github.com/Xeift/OurSong-NFT-Downloader"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-zinc-800 px-3 py-2 text-xs text-zinc-500 transition duration-200 hover:border-zinc-600 hover:text-zinc-200"
          >
            GitHub
          </a>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-8 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:py-12">
        <div className="border border-zinc-800 bg-[#141416] p-6 sm:p-8">
          <div>
            <p className="text-xs uppercase text-zinc-600">OurSong export</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-zinc-100 sm:text-5xl">
              OurSong NFT 下載器
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-500">
              匯出創作者 NFT profile 與 holder list，並產生 JSON 或 XLSX 檔。
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="border border-zinc-800 bg-[#141416] p-6 sm:p-8">
          <div className="grid gap-7">
            <label className="block">
              <span className="flex items-end justify-between gap-4">
                <span className="text-sm font-semibold text-zinc-300">創作者 ID</span>
                <span className="text-xs text-zinc-700">逗號或換行分隔</span>
              </span>
              <textarea
                value={creatorIdsInput}
                onChange={(event) => setCreatorIdsInput(event.target.value)}
                disabled={submitting}
                placeholder="dAb, Jimmy123, OnMarriage"
                className="mt-3 min-h-40 w-full resize-y border border-zinc-800 bg-zinc-950/75 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none transition duration-200 placeholder:text-zinc-700 focus:border-zinc-500 disabled:opacity-55"
              />
            </label>

            <div>
              <div className="text-sm font-semibold text-zinc-300">下載格式</div>
              <div className="mt-3 flex gap-2">
                <FormatButton
                  icon={Table2}
                  label="XLSX"
                  selected={format === "xlsx"}
                  onClick={() => setFormat("xlsx")}
                  disabled={submitting}
                />
                <FormatButton
                  icon={FileJson}
                  label="JSON"
                  selected={format === "json"}
                  onClick={() => setFormat("json")}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="border-t border-zinc-800 pt-6">
              <div className="grid gap-4 border border-zinc-800 bg-zinc-950/60 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                    <StatusIcon status={status} />
                    {statusTitle}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">{statusDetail}</p>
                  {status.kind === "processing" ? (
                    <div className="mt-3 grid gap-2">
                      <div className="flex items-center justify-between gap-4">
                        <div className="grid flex-1 grid-cols-5 gap-1.5">
                          {progressStages.map((stage) => {
                            const fill = getStageFill(progress, stage);
                            const active = stage.phases.includes(status.phase);

                            return (
                              <div
                                key={stage.label}
                                className={cn("h-1.5 border border-zinc-800 bg-zinc-950", active && "border-zinc-600")}
                                title={stage.label}
                              >
                                <div
                                  className={cn(
                                    "h-full transition-[width] duration-300 ease-out",
                                    active ? "bg-zinc-200" : "bg-zinc-500",
                                  )}
                                  style={{ width: `${fill}%` }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="shrink-0 text-xs text-zinc-600">{progress}%</div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 border border-zinc-500 bg-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition duration-200 hover:bg-zinc-200 disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                >
                  {submitting ? "處理中" : "下載"}
                  <Download className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-10 sm:px-8">
        <div className="border border-zinc-800 bg-[#141416] p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-3xl font-semibold text-zinc-300">常見問題</h2>
            <span className="border border-zinc-800 px-3 py-2 text-xs text-zinc-600">
              {faqItems.length.toString().padStart(2, "0")}
            </span>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {faqItems.map((item, index) => (
              <details
                key={item.question}
                className="group border border-zinc-800 bg-zinc-950/55 transition duration-200 open:border-zinc-700 open:bg-zinc-950/75"
              >
                <summary className="grid cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_1.5rem] items-center gap-3 p-4 text-left transition duration-200 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
                  <span className="text-xs text-zinc-700">{(index + 1).toString().padStart(2, "0")}</span>
                  <span className="text-sm font-semibold leading-6 text-zinc-300">{item.question}</span>
                  <span className="grid h-6 w-6 place-items-center border border-zinc-800 text-xs text-zinc-700 transition duration-200 group-open:rotate-45 group-open:border-zinc-600 group-open:text-zinc-400">
                    +
                  </span>
                </summary>

                <div className="border-t border-zinc-800 px-4 pb-4 pt-3">
                  <p className="text-sm leading-6 text-zinc-500">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
