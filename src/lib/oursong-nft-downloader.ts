import { Buffer } from "node:buffer";

import ExcelJS from "exceljs";

type JsonRecord = Record<string, unknown>;

export type DownloadFormat = "json" | "xlsx";

type OurSongNftInfo = {
  id: string;
  title: string;
  name: string;
  description: string;
  cover_image: string;
  image: string;
  animation_url: string | null;
  external_url: string;
  content_type: string;
  created_at: string;
  token_spec: string;
  contract_address: string;
};

type OurSongHolder = {
  uuid: string;
  id: string;
  name: string;
  username: string;
  avatar: string;
  avatar_m: string;
  avatar_b: string;
  owned_amount: number;
};

type OurSongCreatorData = Record<
  string,
  Record<
    string,
    {
      info: OurSongNftInfo;
      holders: OurSongHolder[];
    }
  >
>;

type ExcelImage = {
  base64: string;
  extension: "jpeg" | "png" | "gif";
};

export type OurSongDownloadProgressPhase =
  | "queued"
  | "fetching_creator_nfts"
  | "fetching_nft_data"
  | "creating_json"
  | "creating_xlsx"
  | "completed"
  | "failed";

export type OurSongDownloadProgressUpdate = {
  progress: number;
  phase: OurSongDownloadProgressPhase;
  creatorId?: string;
  creatorIndex?: number;
  creatorTotal?: number;
  nftId?: string;
  nftIndex?: number;
  nftTotal?: number;
};

type ProgressReporter = (update: OurSongDownloadProgressUpdate) => void;

export type OurSongDownloadFile = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

export class BadRequestError extends Error {}

const oursongApiBaseUrl = "https://www.oursong.com/api/open-api";
const creatorIdPattern = /^[A-Za-z0-9._-]+$/;

function readObject(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid OurSong payload at ${path}`);
  }

  return value as JsonRecord;
}

function readArray(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid OurSong array at ${path}`);
  }

  return value;
}

function readString(value: unknown, path: string) {
  if (typeof value !== "string") {
    throw new Error(`Invalid OurSong field at ${path}`);
  }

  return value;
}

function readRequestObject(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError(`Invalid request payload at ${path}`);
  }

  return value as JsonRecord;
}

function readRequestArray(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new BadRequestError(`Invalid request array at ${path}`);
  }

  return value;
}

function readRequestString(value: unknown, path: string) {
  if (typeof value !== "string") {
    throw new BadRequestError(`Invalid request field at ${path}`);
  }

  return value;
}

function readNullableString(value: unknown, path: string) {
  if (value === null) {
    return null;
  }

  return readString(value, path);
}

function readNumber(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid OurSong number at ${path}`);
  }

  return value;
}

function readBoolean(value: unknown, path: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid OurSong boolean at ${path}`);
  }

  return value;
}

function readSuccessStatus(payload: JsonRecord, path: string) {
  const status = readString(payload.status, `${path}.status`);

  if (status !== "success") {
    const message = typeof payload.message === "string" ? payload.message : "Unknown OurSong API error";

    throw new Error(`OurSong API failed at ${path}: ${message}`);
  }
}

function getApiKey() {
  const apiKey = process.env.OURSONG_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OURSONG_API_KEY");
  }

  return apiKey;
}

export function getOurSongDownloadFilename(format: DownloadFormat) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

  return `oursong-nft-data-${timestamp}.${format}`;
}

export function getOurSongDownloadContentType(format: DownloadFormat) {
  return format === "json"
    ? "application/json; charset=utf-8"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function createOurSongDownloadHeaders(format: DownloadFormat, filename: string) {
  return {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Type": getOurSongDownloadContentType(format),
    "Cache-Control": "no-store",
  };
}

export function parseOurSongDownloadRequest(payload: unknown) {
  const object = readRequestObject(payload, "body");
  const rawCreatorIds = readRequestArray(object.creatorIds, "body.creatorIds");
  const creatorIds = rawCreatorIds.map((value, index) => {
    const creatorId = readRequestString(value, `body.creatorIds.${index}`).trim();

    if (!creatorId || !creatorIdPattern.test(creatorId)) {
      throw new BadRequestError(`Invalid creator id at creatorIds.${index}`);
    }

    return creatorId;
  });
  const formatValue = readRequestString(object.format, "body.format");

  if (creatorIds.length === 0) {
    throw new BadRequestError("creatorIds must contain at least one id");
  }

  if (new Set(creatorIds).size !== creatorIds.length) {
    throw new BadRequestError("creatorIds must not contain duplicates");
  }

  if (formatValue !== "json" && formatValue !== "xlsx") {
    throw new BadRequestError("format must be json or xlsx");
  }

  const format: DownloadFormat = formatValue;

  return { creatorIds, format };
}

function getProgressValue(start: number, end: number, current: number, total: number) {
  if (total === 0) {
    return end;
  }

  return Math.round(start + ((end - start) * current) / total);
}

async function fetchOurSongJson(path: string, params: Record<string, string | number>) {
  const url = new URL(`${oursongApiBaseUrl}/${path}`);

  url.searchParams.set("api_key", getApiKey());

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "curl/8.5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`OurSong endpoint ${path} returned ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

async function fetchNftIdsByCreator(creatorId: string) {
  const nftIds: string[] = [];
  let currentPage = 1;

  while (true) {
    const payload = readObject(
      await fetchOurSongJson(`user/${creatorId}/created-vibe-list`, {
        page: currentPage,
        per_page: 100,
      }),
      `created-vibe-list ${creatorId} page ${currentPage}`,
    );

    readSuccessStatus(payload, `created-vibe-list ${creatorId} page ${currentPage}`);

    const list = readArray(payload.list, `created-vibe-list ${creatorId} page ${currentPage}.list`);

    for (const [index, item] of list.entries()) {
      const nft = readObject(item, `created-vibe-list ${creatorId} page ${currentPage}.list.${index}`);

      nftIds.push(readString(nft.id, `created-vibe-list ${creatorId} page ${currentPage}.list.${index}.id`));
    }

    if (!readBoolean(payload.has_more_page, `created-vibe-list ${creatorId} page ${currentPage}.has_more_page`)) {
      break;
    }

    currentPage = readNumber(payload.current_page, `created-vibe-list ${creatorId} page ${currentPage}.current_page`) + 1;
  }

  return nftIds;
}

async function fetchSingleNftInfo(vibeId: string) {
  const payload = readObject(await fetchOurSongJson(`vibe/${vibeId}/profile`, {}), `profile ${vibeId}`);

  if ("status" in payload) {
    readSuccessStatus(payload, `profile ${vibeId}`);
  }

  return {
    id: readString(payload.id, `profile ${vibeId}.id`),
    title: readString(payload.title, `profile ${vibeId}.title`),
    name: readString(payload.name, `profile ${vibeId}.name`),
    description: readString(payload.description, `profile ${vibeId}.description`),
    cover_image: readString(payload.cover_image, `profile ${vibeId}.cover_image`),
    image: readString(payload.image, `profile ${vibeId}.image`),
    animation_url: readNullableString(payload.animation_url, `profile ${vibeId}.animation_url`),
    external_url: readString(payload.external_url, `profile ${vibeId}.external_url`),
    content_type: readString(payload.content_type, `profile ${vibeId}.content_type`),
    created_at: readString(payload.created_at, `profile ${vibeId}.created_at`),
  };
}

function readHolder(value: unknown, path: string): OurSongHolder {
  const holder = readObject(value, path);

  return {
    uuid: readString(holder.uuid, `${path}.uuid`),
    id: readString(holder.id, `${path}.id`),
    name: readString(holder.name, `${path}.name`),
    username: readString(holder.username, `${path}.username`),
    avatar: readString(holder.avatar, `${path}.avatar`),
    avatar_m: readString(holder.avatar_m, `${path}.avatar_m`),
    avatar_b: readString(holder.avatar_b, `${path}.avatar_b`),
    owned_amount: readNumber(holder.owned_amount, `${path}.owned_amount`),
  };
}

async function fetchSingleNftHolders(vibeId: string) {
  const holders: OurSongHolder[] = [];
  let currentPage = 1;
  let tokenSpec: string | null = null;
  let contractAddress: string | null = null;

  while (true) {
    const payload = readObject(
      await fetchOurSongJson(`vibe/${vibeId}/holder-list`, {
        page: currentPage,
        per_page: 100,
      }),
      `holder-list ${vibeId} page ${currentPage}`,
    );

    readSuccessStatus(payload, `holder-list ${vibeId} page ${currentPage}`);

    if (currentPage === 1) {
      const songProject = readObject(payload.song_project, `holder-list ${vibeId} page ${currentPage}.song_project`);

      tokenSpec = readString(songProject.token_spec, `holder-list ${vibeId} page ${currentPage}.song_project.token_spec`);
      contractAddress = readString(
        songProject.contract_address,
        `holder-list ${vibeId} page ${currentPage}.song_project.contract_address`,
      );
    }

    holders.push(
      ...readArray(payload.holder_list, `holder-list ${vibeId} page ${currentPage}.holder_list`).map((item, index) =>
        readHolder(item, `holder-list ${vibeId} page ${currentPage}.holder_list.${index}`),
      ),
    );

    if (!readBoolean(payload.has_more_page, `holder-list ${vibeId} page ${currentPage}.has_more_page`)) {
      break;
    }

    currentPage = readNumber(payload.current_page, `holder-list ${vibeId} page ${currentPage}.current_page`) + 1;
  }

  if (tokenSpec === null || contractAddress === null) {
    throw new Error(`Missing contract data for ${vibeId}`);
  }

  return { tokenSpec, contractAddress, holders };
}

async function downloadCreatorData(creatorIds: string[], reportProgress: ProgressReporter) {
  const data: OurSongCreatorData = {};
  const creatorNftIds = new Map<string, string[]>();
  const creatorTotal = creatorIds.length;

  for (const [creatorOffset, creatorId] of creatorIds.entries()) {
    const creatorIndex = creatorOffset + 1;

    reportProgress({
      progress: getProgressValue(10, 30, creatorOffset, creatorTotal),
      phase: "fetching_creator_nfts",
      creatorId,
      creatorIndex,
      creatorTotal,
    });

    const nftIds = await fetchNftIdsByCreator(creatorId);

    creatorNftIds.set(creatorId, nftIds);
    data[creatorId] = {};

    reportProgress({
      progress: getProgressValue(10, 30, creatorIndex, creatorTotal),
      phase: "fetching_creator_nfts",
      creatorId,
      creatorIndex,
      creatorTotal,
    });
  }

  const totalNftCount = Array.from(creatorNftIds.values()).reduce((total, nftIds) => total + nftIds.length, 0);
  let processedNftCount = 0;

  for (const [creatorOffset, creatorId] of creatorIds.entries()) {
    const nftIds = creatorNftIds.get(creatorId);
    const creatorIndex = creatorOffset + 1;

    if (!nftIds) {
      throw new Error(`Missing NFT list for ${creatorId}`);
    }

    for (const [nftOffset, nftId] of nftIds.entries()) {
      const nftIndex = nftOffset + 1;
      const nftTotal = nftIds.length;

      reportProgress({
        progress: getProgressValue(30, 75, processedNftCount, totalNftCount),
        phase: "fetching_nft_data",
        creatorId,
        creatorIndex,
        creatorTotal,
        nftId,
        nftIndex,
        nftTotal,
      });

      const [info, holderData] = await Promise.all([fetchSingleNftInfo(nftId), fetchSingleNftHolders(nftId)]);

      data[creatorId][nftId] = {
        info: {
          ...info,
          token_spec: holderData.tokenSpec,
          contract_address: holderData.contractAddress,
        },
        holders: holderData.holders,
      };

      processedNftCount += 1;

      reportProgress({
        progress: getProgressValue(30, 75, processedNftCount, totalNftCount),
        phase: "fetching_nft_data",
        creatorId,
        creatorIndex,
        creatorTotal,
        nftId,
        nftIndex,
        nftTotal,
      });
    }
  }

  return data;
}

function getImageExtension(contentType: string) {
  const normalizedContentType = contentType.split(";")[0].trim().toLowerCase();

  if (normalizedContentType === "image/jpeg") {
    return "jpeg";
  }

  if (normalizedContentType === "image/png") {
    return "png";
  }

  if (normalizedContentType === "image/gif") {
    return "gif";
  }

  throw new Error(`Unsupported image content type: ${contentType}`);
}

async function fetchExcelImage(url: string): Promise<ExcelImage> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Image request returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type");

  if (!contentType) {
    throw new Error("Image response missing content-type");
  }

  return {
    base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    extension: getImageExtension(contentType),
  };
}

function styleRange(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  fill: ExcelJS.Fill,
  border: Partial<ExcelJS.Borders>,
  alignment: Partial<ExcelJS.Alignment>,
) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);

    for (let columnNumber = startColumn; columnNumber <= endColumn; columnNumber += 1) {
      const cell = row.getCell(columnNumber);

      cell.fill = fill;
      cell.border = border;
      cell.alignment = alignment;
    }
  }
}

function mergeCells(worksheet: ExcelJS.Worksheet, rowNumber: number) {
  worksheet.mergeCells(rowNumber, 1, rowNumber, 3);
  worksheet.mergeCells(rowNumber, 5, rowNumber, 6);
  worksheet.mergeCells(rowNumber, 8, rowNumber, 9);
}

function countNfts(data: OurSongCreatorData) {
  return Object.values(data).reduce((total, nfts) => total + Object.keys(nfts).length, 0);
}

async function createXlsxBuffer(data: OurSongCreatorData, reportProgress: ProgressReporter) {
  const workbook = new ExcelJS.Workbook();
  const mediumSide: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };
  const border: Partial<ExcelJS.Borders> = {
    top: mediumSide,
    right: mediumSide,
    bottom: mediumSide,
    left: mediumSide,
  };
  const alignment: Partial<ExcelJS.Alignment> = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  const blueFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF9DC2FA" },
  };
  const orangeFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFF9369" },
  };
  const totalNfts = countNfts(data);
  let processedNfts = 0;

  workbook.creator = "xeift.tw";
  workbook.created = new Date();

  for (const [creatorOffset, [creatorId, nfts]] of Object.entries(data).entries()) {
    if (creatorId.length > 31) {
      throw new Error(`Creator id is too long for an XLSX sheet name: ${creatorId}`);
    }

    const worksheet = workbook.addWorksheet(creatorId);
    const nftEntries = Object.entries(nfts);
    let cursorPosition = 1;

    worksheet.columns = [
      { key: "a", width: 14.5 },
      { key: "b", width: 14.5 },
      { key: "c", width: 14.5 },
      { key: "d", width: 30 },
      { key: "e", width: 14.5 },
      { key: "f", width: 20.5 },
      { key: "g", width: 20 },
      { key: "h", width: 20 },
      { key: "i", width: 44 },
    ];

    for (const [nftOffset, [nftId, nftData]] of nftEntries.entries()) {
      const { info, holders } = nftData;
      const nftIndex = nftOffset + 1;
      const nftTotal = nftEntries.length;

      reportProgress({
        progress: getProgressValue(75, 95, processedNfts, totalNfts),
        phase: "creating_xlsx",
        creatorId,
        creatorIndex: creatorOffset + 1,
        creatorTotal: Object.keys(data).length,
        nftId,
        nftIndex,
        nftTotal,
      });

      worksheet.getCell(`A${cursorPosition}`).value = "編號 ID";
      worksheet.getCell(`A${cursorPosition + 1}`).value = info.id;
      worksheet.getCell(`B${cursorPosition}`).value = "標題 Titile";
      worksheet.getCell(`B${cursorPosition + 1}`).value = info.title;
      worksheet.getCell(`C${cursorPosition}`).value = "名稱 Name";
      worksheet.getCell(`C${cursorPosition + 1}`).value = info.name;
      worksheet.getCell(`D${cursorPosition}`).value = "描述 Description";
      worksheet.getCell(`D${cursorPosition + 1}`).value = info.description;
      worksheet.getCell(`E${cursorPosition}`).value = "圖片 Image";
      worksheet.getCell(`F${cursorPosition}`).value = "媒體類型 Content Type";
      worksheet.getCell(`F${cursorPosition + 1}`).value = info.content_type;
      worksheet.getCell(`G${cursorPosition}`).value = "建立時間 Created At";
      worksheet.getCell(`G${cursorPosition + 1}`).value = info.created_at;
      worksheet.getCell(`H${cursorPosition}`).value = "合約類型 Token Spec";
      worksheet.getCell(`H${cursorPosition + 1}`).value = info.token_spec;
      worksheet.getCell(`I${cursorPosition}`).value = "合約地址 Contract Address";
      worksheet.getCell(`I${cursorPosition + 1}`).value = info.contract_address;

      worksheet.getRow(cursorPosition + 1).height = 130;

      const image = await fetchExcelImage(info.cover_image);
      const imageId = workbook.addImage({
        base64: image.base64,
        extension: image.extension,
      });

      worksheet.addImage(imageId, {
        tl: { col: 4, row: cursorPosition },
        ext: { width: 100, height: 100 },
      });

      styleRange(worksheet, cursorPosition, cursorPosition + 1, 1, 9, blueFill, border, alignment);
      cursorPosition += 2;

      worksheet.getCell(`A${cursorPosition}`).value = "使用者內部編號 UUID";
      worksheet.getCell(`D${cursorPosition}`).value = "使用者編號 ID";
      worksheet.getCell(`E${cursorPosition}`).value = "使用者顯示名稱 Name";
      worksheet.getCell(`G${cursorPosition}`).value = "使用者名稱 Username";
      worksheet.getCell(`H${cursorPosition}`).value = "持有數量 Owned Amount";
      mergeCells(worksheet, cursorPosition);
      styleRange(worksheet, cursorPosition, cursorPosition, 1, 9, orangeFill, border, alignment);
      cursorPosition += 1;

      for (const holder of holders) {
        worksheet.getCell(`A${cursorPosition}`).value = holder.uuid;
        worksheet.getCell(`D${cursorPosition}`).value = holder.id;
        worksheet.getCell(`E${cursorPosition}`).value = holder.name;
        worksheet.getCell(`G${cursorPosition}`).value = holder.username;
        worksheet.getCell(`H${cursorPosition}`).value = holder.owned_amount;
        mergeCells(worksheet, cursorPosition);
        styleRange(worksheet, cursorPosition, cursorPosition, 1, 9, orangeFill, border, alignment);
        cursorPosition += 1;
      }

      cursorPosition += 2;
      processedNfts += 1;

      if (nftId !== info.id) {
        throw new Error(`Profile id mismatch for ${nftId}`);
      }

      reportProgress({
        progress: getProgressValue(75, 95, processedNfts, totalNfts),
        phase: "creating_xlsx",
        creatorId,
        creatorIndex: creatorOffset + 1,
        creatorTotal: Object.keys(data).length,
        nftId,
        nftIndex,
        nftTotal,
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return buffer as unknown as Buffer;
}

export async function createOurSongDownloadFile(
  creatorIds: string[],
  format: DownloadFormat,
  reportProgress: ProgressReporter,
): Promise<OurSongDownloadFile> {
  reportProgress({
    progress: 5,
    phase: "queued",
  });

  const data = await downloadCreatorData(creatorIds, reportProgress);
  const filename = getOurSongDownloadFilename(format);
  const contentType = getOurSongDownloadContentType(format);

  if (format === "json") {
    reportProgress({
      progress: 90,
      phase: "creating_json",
    });

    return {
      buffer: Buffer.from(JSON.stringify(data, null, 4)),
      contentType,
      filename,
    };
  }

  const buffer = await createXlsxBuffer(data, reportProgress);

  return {
    buffer,
    contentType,
    filename,
  };
}
