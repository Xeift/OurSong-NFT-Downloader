import { NextResponse } from "next/server";

import { createOurSongDownloadHeaders } from "@/lib/oursong-nft-downloader";
import { JobNotReadyError, readOurSongDownloadJobFile } from "@/lib/oursong-nft-downloader-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { jobId } = await params;

  try {
    const file = await readOurSongDownloadJobFile(jobId);

    if (!file) {
      return NextResponse.json({ error: "OurSong downloader job not found" }, { status: 404 });
    }

    return new Response(file.buffer as BodyInit, {
      headers: createOurSongDownloadHeaders(file.format, file.filename),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OurSong downloader download error";

    if (error instanceof JobNotReadyError) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
