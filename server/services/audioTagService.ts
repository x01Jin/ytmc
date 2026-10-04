import { readAudioMetadata, type EmbeddedCover, type MusicTags } from './audioMetadata.js';
import { embedOpusPicture, writeAudioTags } from './audioWrite.js';

export type { MusicTags };
export { embedOpusPicture };

export namespace AudioTagService {
  export async function readTags(filePath: string): Promise<MusicTags> {
    return (await readAudioMetadata(filePath)).tags;
  }

  export async function getEmbeddedArtwork(filePath: string): Promise<{
    data: Buffer;
    mimeType: string;
  } | null> {
    let cover: EmbeddedCover | null;
    try {
      cover = (await readAudioMetadata(filePath)).cover;
    } catch {
      return null;
    }
    if (!cover) return null;
    return { data: Buffer.from(cover.data), mimeType: cover.mimeType };
  }

  export async function applyTagsToFile(
    filePath: string,
    tags: MusicTags
  ): Promise<{
    success: boolean;
    filePath: string;
    fileSizeBytes: number;
    coverDropped?: boolean;
    coverDropReason?: string;
    error?: string;
  }> {
    return writeAudioTags(filePath, tags);
  }
}
