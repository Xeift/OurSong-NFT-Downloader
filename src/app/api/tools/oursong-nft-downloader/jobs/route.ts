import { NextResponse } from "next/server";

import { BadRequestError } from "@/lib/oursong-nft-downloader";
import { createOurSongDownloadJob, TooManyActiveJobsError } from "@/lib/oursong-nft-downloader-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const job = createOurSongDownloadJob(await request.json());

    return NextResponse.json({
      jobId: job.id,
      job,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OurSong downloader error";

    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (error instanceof TooManyActiveJobsError) {
      return NextResponse.json({ error: message }, { status: 429 });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
