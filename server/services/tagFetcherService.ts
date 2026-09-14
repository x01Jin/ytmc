/**
 * Single-purpose service for fetching music metadata and ID3 tags
 * from multiple public sources (iTunes, Deezer, MusicBrainz).
 */

export interface MusicTagCandidate {
  id: string;
  source: 'itunes' | 'deezer' | 'musicbrainz';
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverUrl?: string;
  previewUrl?: string;
}

export class TagFetcherService {
  private static readonly REQUEST_TIMEOUT_MS = 5000;

  /**
   * Search for music tags across all sources or a specific source.
   */
  public static async searchTags(
    query: string,
    source: 'all' | 'itunes' | 'deezer' | 'musicbrainz' = 'all'
  ): Promise<MusicTagCandidate[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return [];
    }

    const tasks: Promise<MusicTagCandidate[]>[] = [];

    if (source === 'all' || source === 'itunes') {
      tasks.push(this.fetchFromItunes(trimmed));
    }
    if (source === 'all' || source === 'deezer') {
      tasks.push(this.fetchFromDeezer(trimmed));
    }
    if (source === 'all' || source === 'musicbrainz') {
      tasks.push(this.fetchFromMusicBrainz(trimmed));
    }

    const results = await Promise.allSettled(tasks);
    const allCandidates: MusicTagCandidate[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allCandidates.push(...result.value);
      }
    }

    return this.deduplicateAndRank(allCandidates, trimmed);
  }

  /**
   * Fetch candidates from Apple / iTunes Search API.
   */
  public static async fetchFromItunes(query: string): Promise<MusicTagCandidate[]> {
    try {
      const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=10`;
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) return [];
      const json = await res.json() as any;

      if (!json.results || !Array.isArray(json.results)) return [];

      return json.results.map((r: any, idx: number): MusicTagCandidate => {
        let cover = r.artworkUrl100 || '';
        if (cover) {
          // Upgrade thumbnail to 600x600 for studio quality artwork
          cover = cover.replace(/\/\d+x\d+bb\./, '/600x600bb.');
        }

        const year = r.releaseDate ? r.releaseDate.substring(0, 4) : '';

        return {
          id: `itunes_${r.trackId || idx}`,
          source: 'itunes',
          title: r.trackName || 'Unknown Title',
          artist: r.artistName || 'Unknown Artist',
          album: r.collectionName || r.trackName || 'Single',
          albumArtist: r.artistName || '',
          year: year,
          genre: r.primaryGenreName || '',
          trackNumber: r.trackNumber ? String(r.trackNumber) : '',
          coverUrl: cover,
          previewUrl: r.previewUrl || ''
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetch candidates from Deezer Public Search API.
   */
  public static async fetchFromDeezer(query: string): Promise<MusicTagCandidate[]> {
    try {
      const endpoint = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`;
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) return [];
      const json = await res.json() as any;

      if (!json.data || !Array.isArray(json.data)) return [];

      return json.data.map((d: any, idx: number): MusicTagCandidate => {
        const cover = d.album?.cover_xl || d.album?.cover_big || d.album?.cover_medium || '';
        return {
          id: `deezer_${d.id || idx}`,
          source: 'deezer',
          title: d.title || d.title_short || 'Unknown Title',
          artist: d.artist?.name || 'Unknown Artist',
          album: d.album?.title || 'Single',
          albumArtist: d.artist?.name || '',
          year: '',
          genre: '',
          coverUrl: cover,
          previewUrl: d.preview || ''
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Fetch candidates from MusicBrainz Open Database.
   */
  public static async fetchFromMusicBrainz(query: string): Promise<MusicTagCandidate[]> {
    try {
      // Clean query for MusicBrainz lucene syntax
      const cleanQ = query.replace(/[^\w\s]/gi, ' ').trim();
      const endpoint = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(cleanQ)}&fmt=json&limit=10`;
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
        headers: {
          'User-Agent': 'YouTubeToMusicConverter/1.0.0 ( music-converter-tagger@app.local )',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) return [];
      const json = await res.json() as any;

      if (!json.recordings || !Array.isArray(json.recordings)) return [];

      return json.recordings.map((rec: any, idx: number): MusicTagCandidate => {
        const artist = rec['artist-credit']?.[0]?.name || 'Unknown Artist';
        const primaryRelease = rec.releases?.[0];
        const album = primaryRelease?.title || 'Single';
        let year = '';
        if (primaryRelease?.date) {
          year = primaryRelease.date.substring(0, 4);
        } else if (rec['first-release-date']) {
          year = rec['first-release-date'].substring(0, 4);
        }

        const genre = rec.tags?.[0]?.name ? rec.tags[0].name.charAt(0).toUpperCase() + rec.tags[0].name.slice(1) : '';
        const releaseId = primaryRelease?.id;
        const coverUrl = releaseId ? `https://coverartarchive.org/release/${releaseId}/front-500` : '';

        return {
          id: `mb_${rec.id || idx}`,
          source: 'musicbrainz',
          title: rec.title || 'Unknown Title',
          artist,
          album,
          albumArtist: artist,
          year,
          genre,
          coverUrl
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Deduplicate candidates and order them so complete, high-quality results appear first.
   */
  private static deduplicateAndRank(candidates: MusicTagCandidate[], query: string): MusicTagCandidate[] {
    const seen = new Set<string>();
    const normalizedQuery = query.toLowerCase();

    // Score candidates based on metadata richness and match
    const scored = candidates.map(c => {
      let score = 0;
      if (c.coverUrl) score += 4;
      if (c.year) score += 3;
      if (c.genre) score += 2;
      if (c.album && c.album.toLowerCase() !== 'single') score += 2;
      if (c.source === 'itunes') score += 3; // iTunes has highest artwork consistency
      if (c.source === 'deezer') score += 2;

      const titleLower = c.title.toLowerCase();
      const artistLower = c.artist.toLowerCase();

      if (normalizedQuery.includes(titleLower) || titleLower.includes(normalizedQuery)) {
        score += 5;
      }
      if (normalizedQuery.includes(artistLower)) {
        score += 3;
      }

      return { candidate: c, score };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    const deduped: MusicTagCandidate[] = [];
    for (const item of scored) {
      const c = item.candidate;
      // Signature based on artist + title (normalized)
      const sig = `${c.artist.toLowerCase()}_${c.title.toLowerCase()}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        deduped.push(c);
      } else if (deduped.length < 15) {
        // Also allow different albums if distinct
        const albumSig = `${sig}_${(c.album || '').toLowerCase()}`;
        if (!seen.has(albumSig)) {
          seen.add(albumSig);
          deduped.push(c);
        }
      }
    }

    return deduped.slice(0, 12);
  }
}
