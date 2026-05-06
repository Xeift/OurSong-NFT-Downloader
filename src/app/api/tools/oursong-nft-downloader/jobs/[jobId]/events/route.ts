import { NextResponse } from "next/server";

import {
  getOurSongDownloadJob,
  subscribeToOurSongDownloadJob,
  type OurSongDownloadJobSnapshot,
} from "@/lib/oursong-nft-downloader-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function encodeEvent(event: string, data: OurSongDownloadJobSnapshot) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isTerminalJob(snapshot: OurSongDownloadJobSnapshot) {
  return snapshot.status === "completed" || snapshot.status === "failed";
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { jobId } = await params;

  if (!getOurSongDownloadJob(jobId)) {
    return NextResponse.json({ error: "OurSong downloader job not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanupStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 15_000);

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanupStream();
        controller.close();
      };
      cleanupStream = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
      };

      unsubscribe = subscribeToOurSongDownloadJob(jobId, (snapshot) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(encodeEvent("job", snapshot)));

        if (isTerminalJob(snapshot)) {
          close();
        }
      });

      if (!unsubscribe) {
        controller.enqueue(
          encoder.encode(
            encodeEvent("job", {
              id: jobId,
              status: "failed",
              progress: 0,
              phase: "failed",
              error: "OurSong downloader job not found",
            }),
          ),
        );
        close();
      }
    },
    cancel() {
      cleanupStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
