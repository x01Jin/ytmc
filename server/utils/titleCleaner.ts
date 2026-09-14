/**
 * Utility to clean common YouTube video title artifacts and extract
 * initial track name and artist for music tagging.
 */

export interface ParsedMusicInfo {
  cleanTitle: string;
  cleanArtist: string;
  searchQuery: string;
}

export function cleanYouTubeTitle(rawTitle: string, channelAuthor?: string): ParsedMusicInfo {
  let text = (rawTitle || '').trim();

  // Strip common YouTube fluff patterns (case-insensitive)
  const fluffPatterns = [
    /\s*[\(\[]\s*official\s+music\s+video\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s+video\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s+audio\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s+lyric\s+video\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s*[\)\]]/gi,
    /\s*[\(\[]\s*visualizer\s*[\)\]]/gi,
    /\s*[\(\[]\s*lyrics?\s*[\)\]]/gi,
    /\s*[\(\[]\s*audio\s*[\)\]]/gi,
    /\s*[\(\[]\s*4k\s*(remaster(ed)?)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*remaster(ed)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*hd\s*[\)\]]/gi,
    /\s*[\(\[]\s*mv\s*[\)\]]/gi,
    /\s*[\(\[]\s*hq\s*[\)\]]/gi,
    /\s*\|\s*official\s+(music\s+)?video\s*$/gi,
    /\s*\|\s*official\s+audio\s*$/gi,
    /\s*\|\s*lyrics?\s*$/gi,
    /\s*#\w+/gi // Hashtags
  ];

  for (const pattern of fluffPatterns) {
    text = text.replace(pattern, '');
  }

  // Remove surrounding quotes or brackets
  text = text.replace(/^["'«“]+|["'»”]+$/g, '').trim();

  // Clean author if ending with " - Topic" or "VEVO"
  let cleanAuthor = (channelAuthor || '').trim();
  cleanAuthor = cleanAuthor.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();

  let cleanTitle = text;

  // Check for "Artist - Title" separator
  const separatorMatch = text.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (separatorMatch) {
    cleanAuthor = separatorMatch[1].trim();
    cleanTitle = separatorMatch[2].trim();
  } else if (!cleanAuthor) {
    cleanAuthor = 'Unknown Artist';
  }

  // Clean up any remaining leading/trailing punctuation in title
  cleanTitle = cleanTitle.replace(/^[-–—:\s]+|[-–—:\s]+$/g, '').trim();
  if (!cleanTitle) {
    cleanTitle = rawTitle.trim() || 'Untitled Track';
  }

  const searchQuery = `${cleanTitle} ${cleanAuthor}`.trim();

  return {
    cleanTitle,
    cleanArtist: cleanAuthor,
    searchQuery
  };
}
