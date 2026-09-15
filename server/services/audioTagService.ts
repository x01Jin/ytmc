import { execFile, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FFPROBE_PATH, FFMPEG_PATH } from "../config.js";

export interface MusicTags {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverUrl?: string;
  coverData?: string;
  comment?: string;
  cleanDescription?: boolean;
}

/**
 * Opus/Ogg cover-art helpers (module scope — no extra deps).
 * Ogg/Opus cannot mux an attached_pic video stream like MP3/M4A; the
 * Vorbis-comment standard is METADATA_BLOCK_PICTURE: a base64 FLAC Picture
 * block. We build it in-process and ship it via an ffmetadata sidecar file
 * (avoids MAX_ARG_STRLEN blowups for large JPEGs). Any failure falls back
 * to audio-only so a bad image can never corrupt the song.
 */
function detectImageMime(buffer: Buffer): string {
  if (
    buffer.length > 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "image/jpeg";
  if (
    buffer.length > 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return "image/png";
  return "image/jpeg";
}

function buildFlacPictureBlock(image: Buffer, mime: string): Buffer {
  // FLAC Picture block: type(3=front) + mime + desc + w/h/depth/colors + data.
  // Width/height/depth left as 0 (valid per spec, players accept) to avoid
  // fragile JPEG SOF parsing — never corrupt audio over dimensions.
  const mimeBuf = Buffer.from(mime, "ascii");
  const headerLen = 4 + 4 + mimeBuf.length + 4 + 4 + 4 + 4 + 4 + 4;
  const out = Buffer.alloc(headerLen + image.length);
  let o = 0;
  out.writeUInt32BE(3, o);
  o += 4; // front cover
  out.writeUInt32BE(mimeBuf.length, o);
  o += 4;
  mimeBuf.copy(out, o);
  o += mimeBuf.length;
  out.writeUInt32BE(0, o);
  o += 4; // empty description
  out.writeUInt32BE(0, o);
  o += 4; // width unknown
  out.writeUInt32BE(0, o);
  o += 4; // height unknown
  out.writeUInt32BE(0, o);
  o += 4; // depth unknown
  out.writeUInt32BE(0, o);
  o += 4; // colors unknown
  out.writeUInt32BE(image.length, o);
  o += 4;
  image.copy(out, o);
  return out;
}

function escapeFFMetadata(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\\n")
    .replace(/;/g, "\\;")
    .replace(/=/g, "\\=")
    .replace(/#/g, "\\#");
}

function writeOpusMetadataFile(
  dir: string,
  tempId: string,
  tags: MusicTags,
  coverBuffer: Buffer | null,
): string {
  const lines = [";FFMETADATA1"];
  const push = (k: string, v?: string) => {
    if (v !== undefined && v !== null && String(v).length > 0)
      lines.push(`${k}=${escapeFFMetadata(String(v))}`);
  };
  push("title", tags.title);
  push("artist", tags.artist);
  push("album", tags.album);
  push("album_artist", tags.albumArtist || tags.artist);
  push("date", tags.year);
  push("genre", tags.genre);
  push("track", tags.trackNumber);
  push("comment", tags.comment);
  if (tags.cleanDescription !== false) {
    // Map-clean: omitting description/synopsis/purl drops yt-dlp leftovers.
    lines.push("description=");
    lines.push("synopsis=");
    lines.push("purl=");
  }
  if (coverBuffer && coverBuffer.length > 0) {
    const block = buildFlacPictureBlock(
      coverBuffer,
      detectImageMime(coverBuffer),
    );
    lines.push(`METADATA_BLOCK_PICTURE=${block.toString("base64")}`);
  }
  const metaPath = path.join(dir, `temp_opusmeta_${tempId}.txt`);
  fs.writeFileSync(metaPath, lines.join("\n") + "\n", "utf8");
  return metaPath;
}

async function resolveCoverBuffer(tags: MusicTags): Promise<Buffer | null> {
  try {
    let buffer: Buffer;
    if (tags.coverData) {
      const match = tags.coverData.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (!match) return null;
      buffer = Buffer.from(match[1], "base64");
    } else if (tags.coverUrl) {
      const imgRes = await fetch(tags.coverUrl, {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!imgRes.ok) return null;
      buffer = Buffer.from(await imgRes.arrayBuffer());
    } else {
      return null;
    }
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return null;
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Extract the raw image bytes from an Opus file's cover art.
 * Handles both storages: a real attached-pic video stream (what modern
 * ffmpeg writes) and a METADATA_BLOCK_PICTURE Vorbis comment.
 * Returns null when absent or malformed — never throws.
 */
export async function extractOpusPicture(
  opusFilePath: string,
): Promise<Buffer | null> {
  try {
    if (!fs.existsSync(opusFilePath)) return null;
    // 1) Attached-pic video stream (ffmpeg ≥5 style opus covers).
    const asVideo = await AudioTagService.extractCoverArt(opusFilePath).catch(
      () => null,
    );
    if (asVideo && asVideo.data.length > 0) return Buffer.from(asVideo.data);
    const ffprobeCmd = fs.existsSync(FFPROBE_PATH) ? FFPROBE_PATH : "ffprobe";
    const raw: string = await new Promise((resolve, reject) => {
      execFile(
        ffprobeCmd,
        ["-v", "quiet", "-print_format", "json", "-show_streams", opusFilePath],
        { timeout: 15000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(String(stdout));
        },
      );
    });
    const parsed = JSON.parse(raw) as {
      streams?: Array<{ codec_type?: string; tags?: Record<string, string> }>;
    };
    const audioTags =
      parsed.streams?.find((s) => s.codec_type === "audio")?.tags ?? {};
    const key = Object.keys(audioTags).find(
      (k) => k.toUpperCase() === "METADATA_BLOCK_PICTURE",
    );
    if (!key) return null;
    const block = Buffer.from(audioTags[key], "base64");
    // Parse FLAC Picture block with strict bounds checks.
    let o = 0;
    const u32 = (): number | null => {
      if (o + 4 > block.length) return null;
      const v = block.readUInt32BE(o);
      o += 4;
      return v;
    };
    if (u32() === null) return null; // picture type
    const mimeLen = u32();
    if (mimeLen === null || mimeLen > 256) return null;
    o += mimeLen;
    if (o > block.length) return null;
    const descLen = u32();
    if (descLen === null || descLen > 1024 * 1024) return null;
    o += descLen;
    if (o > block.length) return null;
    o += 16; // width, height, depth, colors
    if (o > block.length) return null;
    const dataLen = u32();
    if (dataLen === null || dataLen <= 0 || dataLen > 8 * 1024 * 1024)
      return null;
    if (o + dataLen > block.length) return null;
    return block.subarray(o, o + dataLen);
  } catch {
    return null;
  }
}

/**
 * Embed cover art into an existing Opus file via METADATA_BLOCK_PICTURE,
 * preserving all currently embedded tags (re-read from the file).
 * Resolves false when there is nothing to embed or the embed fails —
 * callers must treat false as "audio-only, carry on", never as fatal.
 */
export async function embedOpusPicture(
  opusFilePath: string,
  cover: Buffer | null,
): Promise<boolean> {
  try {
    if (!cover || cover.length === 0 || cover.length > 8 * 1024 * 1024)
      return false;
    if (!fs.existsSync(opusFilePath)) return false;
    const dir = path.dirname(opusFilePath);
    const tempId = crypto.randomUUID();
    const ext =
      path.extname(opusFilePath).toLowerCase().replace(".", "") || "opus";
    const tmpOut = path.join(dir, `temp_opuspic_${tempId}.${ext}`);
    // readTags is defined on the class below (hoisted access at call time).
    const current = await AudioTagService.readTags(opusFilePath);
    const metaPath = writeOpusMetadataFile(
      dir,
      tempId,
      { ...current, cleanDescription: false },
      cover,
    );
    try {
      const ffmpegCmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
      await new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegCmd,
          [
            "-y",
            "-i",
            opusFilePath,
            "-f",
            "ffmetadata",
            "-i",
            metaPath,
            "-map",
            "0:a",
            "-map",
            "1:v?",
            "-map_metadata",
            "1",
            "-map_metadata:s:a",
            "1",
            "-c",
            "copy",
            tmpOut,
          ],
          { timeout: 60000 },
          (err, _stdout, stderr) => {
            if (err)
              reject(
                new Error(
                  `opus picture embed failed: ${stderr || err.message}`,
                ),
              );
            else resolve();
          },
        );
      });
      fs.copyFileSync(tmpOut, opusFilePath);
      return true;
    } finally {
      fs.rmSync(metaPath, { force: true });
      fs.rmSync(tmpOut, { force: true });
    }
  } catch {
    return false;
  }
}

export class AudioTagService {
  /**
   * Read common embedded tags.
   * Merges container-level tags (MP3/M4A/FLAC) with audio-stream Vorbis
   * comments (Opus/Ogg store TITLE/ARTIST/... on the stream, leaving
   * format.tags empty — without this, opus tracks look untagged).
   */
  public static async readTags(filePath: string): Promise<MusicTags> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Target audio file does not exist: ${filePath}`);
    }

    const ffprobeCmd = fs.existsSync(FFPROBE_PATH) ? FFPROBE_PATH : "ffprobe";

    return new Promise((resolve) => {
      execFile(
        ffprobeCmd,
        [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        { timeout: 15000 },
        (_error, stdout) => {
          try {
            const parsed = JSON.parse(String(stdout)) as {
              format?: { tags?: Record<string, string> };
              streams?: Array<{
                codec_type?: string;
                tags?: Record<string, string>;
              }>;
            };
            const formatTags = parsed.format?.tags ?? {};
            // Prefer the first audio stream's tags; fall back to any stream.
            const audioTags =
              parsed.streams?.find((s) => s.codec_type === "audio")?.tags ??
              parsed.streams?.find((s) => s.tags)?.tags ??
              {};
            // Stream-level (opus) wins when present, format-level fills gaps.
            // Keys are case-insensitive; vorbis comments are UPPERCASE.
            const merged: Record<string, string> = {};
            for (const [k, v] of Object.entries(formatTags)) merged[k] = v;
            for (const [k, v] of Object.entries(audioTags)) {
              merged[k] = v;
              merged[k.toLowerCase()] = v;
              merged[k.toUpperCase()] = v;
            }
            const value = (...keys: string[]) =>
              keys
                .map((key) => merged[key] ?? merged[key.toUpperCase()])
                .find(Boolean) ?? "";
            resolve({
              title: value("title"),
              artist: value("artist", "album_artist"),
              album: value("album"),
              albumArtist: value("album_artist", "albumartist"),
              year: value("date", "year", "creation_time"),
              genre: value("genre"),
              trackNumber: value("track", "tracknumber"),
              comment: value("comment"),
              cleanDescription: false,
            });
          } catch {
            resolve({ title: "", artist: "" });
          }
        },
      );
    });
  }

  /** Extract embedded artwork for local library previews. */
  public static async extractCoverArt(filePath: string): Promise<{
    data: Buffer;
    mimeType: "image/jpeg";
  } | null> {
    if (!fs.existsSync(filePath)) return null;

    const ffmpegCmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
    const outputPath = path.join(
      path.dirname(filePath),
      `.cover_${crypto.randomUUID()}.jpg`,
    );
    return new Promise((resolve) => {
      const child = spawn(ffmpegCmd, [
        "-v",
        "error",
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        outputPath,
      ]);
      const timeout = setTimeout(() => child.kill(), 15000);

      child.on("error", () => {
        clearTimeout(timeout);
        fs.rmSync(outputPath, { force: true });
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 || !fs.existsSync(outputPath)) {
          fs.rmSync(outputPath, { force: true });
          resolve(null);
          return;
        }
        const data = fs.readFileSync(outputPath);
        fs.rmSync(outputPath, { force: true });
        resolve(
          data.length > 8 * 1024 * 1024
            ? null
            : { data, mimeType: "image/jpeg" },
        );
      });
    });
  }

  /**
   * Embeds or updates metadata tags and cover artwork in an audio file on disk.
   */
  public static async applyTagsToFile(
    filePath: string,
    tags: MusicTags,
  ): Promise<{
    success: boolean;
    filePath: string;
    fileSizeBytes: number;
    error?: string;
  }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Target audio file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const dir = path.dirname(filePath);
    const tempId = crypto.randomUUID();
    const tempOutputFile = path.join(dir, `temp_tagged_${tempId}.${ext}`);
    let tempCoverFile: string | null = null;
    let tempMetaFile: string | null = null;

    const runFfmpeg = (ffmpegArgs: string[]): Promise<void> => {
      const ffmpegCmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
      return new Promise<void>((resolve, reject) => {
        execFile(
          ffmpegCmd,
          ffmpegArgs,
          { timeout: 60000 },
          (err, _stdout, stderr) => {
            if (err) {
              reject(
                new Error(`FFmpeg tagging failed: ${stderr || err.message}`),
              );
            } else {
              resolve();
            }
          },
        );
      });
    };

    const commitOutput = (): {
      success: boolean;
      filePath: string;
      fileSizeBytes: number;
    } => {
      if (fs.existsSync(tempOutputFile)) {
        fs.copyFileSync(tempOutputFile, filePath);
        fs.unlinkSync(tempOutputFile);
      }
      const stat = fs.statSync(filePath);
      return { success: true, filePath, fileSizeBytes: stat.size };
    };

    try {
      // Opus branch: METADATA_BLOCK_PICTURE via ffmetadata sidecar (no re-encode).
      // The ffmetadata pass REPLACES stream Vorbis comments wholesale, so
      // merge incoming tags over the currently embedded ones (mirrors the
      // non-opus path, where untouched fields survive via stream copy) and
      // carry the existing cover when no new artwork is supplied.
      // Never throws on bad artwork — falls back to tags-only, then audio-only.
      if (ext === "opus") {
        const current: MusicTags = await AudioTagService.readTags(
          filePath,
        ).catch(() => ({ title: "", artist: "" }));
        const defined = (v: unknown): v is string =>
          typeof v === "string" && v.length > 0;
        // Mirrors the non-opus path (`if (tags.album)` guards): empty means
        // "keep what's embedded", never "wipe".
        const merged: MusicTags = {
          title: defined(tags.title) ? tags.title : (current.title ?? ""),
          artist: defined(tags.artist) ? tags.artist : (current.artist ?? ""),
          album: defined(tags.album) ? tags.album : current.album,
          albumArtist: defined(tags.albumArtist)
            ? tags.albumArtist
            : current.albumArtist,
          year: defined(tags.year) ? tags.year : current.year,
          genre: defined(tags.genre) ? tags.genre : current.genre,
          trackNumber: defined(tags.trackNumber)
            ? tags.trackNumber
            : current.trackNumber,
          comment: defined(tags.comment) ? tags.comment : current.comment,
          cleanDescription: tags.cleanDescription,
        };
        const coverBuffer =
          tags.coverData || tags.coverUrl
            ? ((await resolveCoverBuffer(tags)) ??
              (await extractOpusPicture(filePath)))
            : await extractOpusPicture(filePath);
        const attempt = async (withCover: boolean): Promise<void> => {
          if (fs.existsSync(tempOutputFile))
            fs.rmSync(tempOutputFile, { force: true });
          if (tempMetaFile && fs.existsSync(tempMetaFile))
            fs.rmSync(tempMetaFile, { force: true });
          tempMetaFile = writeOpusMetadataFile(
            dir,
            tempId,
            merged,
            withCover ? coverBuffer : null,
          );
          // Verified recipe: the ffmetadata demuxer exposes the picture
          // block as an attached-pic video stream; -map 1:v? carries it and
          // -map_metadata:s:a 1 pushes title/artist into Vorbis comments
          // (global -map_metadata alone is ignored by the opus muxer).
          await runFfmpeg([
            "-y",
            "-i",
            filePath,
            "-f",
            "ffmetadata",
            "-i",
            tempMetaFile,
            "-map",
            "0:a",
            "-map",
            "1:v?",
            "-map_metadata",
            "1",
            "-map_metadata:s:a",
            "1",
            "-c",
            "copy",
            tempOutputFile,
          ]);
        };
        try {
          await attempt(coverBuffer !== null);
        } catch {
          if (coverBuffer !== null) {
            // Retry without artwork — artwork must never corrupt the song.
            await attempt(false);
          } else {
            throw new Error("FFmpeg opus tagging failed");
          }
        }
        return commitOutput();
      }

      // 1. Resolve custom artwork from a local data URL or a fetched URL.
      if (
        (tags.coverData || tags.coverUrl) &&
        (ext === "mp3" || ext === "m4a" || ext === "flac")
      ) {
        try {
          let buffer: Buffer;
          if (tags.coverData) {
            const match = tags.coverData.match(
              /^data:image\/[^;]+;base64,(.+)$/,
            );
            if (!match)
              throw new Error("Local cover must be an image data URL");
            buffer = Buffer.from(match[1], "base64");
          } else {
            const imgRes = await fetch(tags.coverUrl!, {
              signal: AbortSignal.timeout(6000),
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            });
            if (!imgRes.ok)
              throw new Error(`Cover request returned ${imgRes.status}`);
            buffer = Buffer.from(await imgRes.arrayBuffer());
          }
          if (buffer.length > 0 && buffer.length <= 8 * 1024 * 1024) {
            tempCoverFile = path.join(dir, `temp_cover_${tempId}.jpg`);
            fs.writeFileSync(tempCoverFile, buffer);
          }
        } catch (error) {
          throw new Error(
            `Could not read album artwork: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // 2. Build FFmpeg arguments for direct metadata injection without re-encoding
      // -map_metadata 0 preserves existing tags (album/year/genre/etc);
      // explicit -metadata below overrides with the new values.
      const args: string[] = ["-y", "-i", filePath];

      if (tempCoverFile && fs.existsSync(tempCoverFile)) {
        args.push("-i", tempCoverFile);
        args.push(
          "-map",
          "0:a",
          "-map",
          "1:0",
          "-map_metadata",
          "0",
          "-c",
          "copy",
        );

        if (ext === "mp3") {
          args.push("-id3v2_version", "3");
          args.push("-metadata:s:v", "title=Album cover");
          args.push("-metadata:s:v", "comment=Cover (front)");
        } else if (ext === "m4a") {
          args.push("-disposition:v:0", "attached_pic");
        } else if (ext === "flac") {
          args.push("-metadata:s:v", "title=Album cover");
        }
      } else {
        args.push(
          "-map",
          "0:a:0",
          "-map",
          "0:v?",
          "-map_metadata",
          "0",
          "-c",
          "copy",
        );
      }

      // Standard tag key-value pairs
      if (tags.title) {
        args.push("-metadata", `title=${tags.title}`);
      }
      if (tags.artist) {
        args.push("-metadata", `artist=${tags.artist}`);
      }
      if (tags.album) {
        args.push("-metadata", `album=${tags.album}`);
      }
      if (tags.albumArtist || tags.artist) {
        args.push(
          "-metadata",
          `album_artist=${tags.albumArtist || tags.artist}`,
        );
      }
      if (tags.year) {
        args.push("-metadata", `date=${tags.year}`);
        args.push("-metadata", `year=${tags.year}`);
      }
      if (tags.genre) {
        args.push("-metadata", `genre=${tags.genre}`);
      }
      if (tags.trackNumber) {
        args.push("-metadata", `track=${tags.trackNumber}`);
      }
      if (tags.comment !== undefined) {
        args.push("-metadata", `comment=${tags.comment}`);
      }

      // Clean out lengthy YouTube descriptions and dump metadata if requested (default behavior)
      if (tags.cleanDescription !== false) {
        args.push("-metadata", "description=");
        args.push("-metadata", "synopsis=");
        args.push("-metadata", "purl=");
      }

      args.push(tempOutputFile);

      // 3. Execute FFmpeg (bundled binary first, PATH fallback)
      await runFfmpeg(args);

      // 4. Overwrite original file with newly tagged audio
      return commitOutput();
    } finally {
      // Clean up temp cover art and output files if left behind
      if (tempCoverFile && fs.existsSync(tempCoverFile)) {
        try {
          fs.unlinkSync(tempCoverFile);
        } catch {}
      }
      if (tempMetaFile && fs.existsSync(tempMetaFile)) {
        try {
          fs.unlinkSync(tempMetaFile);
        } catch {}
      }
      if (fs.existsSync(tempOutputFile)) {
        try {
          fs.unlinkSync(tempOutputFile);
        } catch {}
      }
    }
  }
}
