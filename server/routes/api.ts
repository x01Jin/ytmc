import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DEFAULT_DEMO_TRACKS } from '../config.js';
import { AudioTagService, MusicTags } from '../services/audioTagService.js';
import { ConversionService } from '../services/conversionService.js';
import { CookieService } from '../services/cookieService.js';
import { JobManager } from '../services/jobManager.js';
import { MetadataService } from '../services/metadataService.js';
import { TagFetcherService } from '../services/tagFetcherService.js';
import { getAudioMimeType } from '../utils/mime.js';

export const apiRouter: Router = express.Router();

/**
 * Fetch video metadata from YouTube URL or ID
 */
apiRouter.get('/info', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ success: false, error: 'YouTube URL or video ID is required' });
      return;
    }

    const metadata = await MetadataService.getVideoInfo(url);
    res.json({ success: true, data: metadata });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Failed to fetch video information' });
  }
});

/**
 * Start conversion job
 */
apiRouter.post('/convert', async (req: Request, res: Response) => {
  try {
    const { url, format, bitrate, trimStart, trimEnd, volumeBoost, normalizeAudio, embedThumbnail, tags } = req.body;
    if (!url) {
      res.status(400).json({ success: false, error: 'Target URL is required' });
      return;
    }

    const job = await ConversionService.startConversion({
      url,
      format,
      bitrate,
      trimStart,
      trimEnd,
      volumeBoost: volumeBoost ? parseInt(volumeBoost, 10) : undefined,
      normalizeAudio: Boolean(normalizeAudio),
      embedThumbnail: embedThumbnail !== false,
      tags
    });

    res.json({ success: true, job });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Failed to start conversion job' });
  }
});

/**
 * Check conversion status
 */
apiRouter.get('/status/:id', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = JobManager.getJob(jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({ success: true, job });
});

/**
 * List recent jobs
 */
apiRouter.get('/jobs', (req: Request, res: Response) => {
  const jobs = JobManager.listRecentJobs();
  res.json({ success: true, jobs });
});

/**
 * Stream audio file with HTTP Range support for HTML5 Audio player
 */
apiRouter.get('/stream/:id', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = JobManager.getJob(jobId);

  if (!job || !job.outputFilePath || !fs.existsSync(job.outputFilePath)) {
    res.status(404).json({ success: false, error: 'Audio file not found or still processing' });
    return;
  }

  const filePath = job.outputFilePath;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).replace('.', '');
  const contentType = getAudioMimeType(ext);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/**
 * Download converted audio file
 */
apiRouter.get('/download/:id', (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = JobManager.getJob(jobId);

  if (!job || !job.outputFilePath || !fs.existsSync(job.outputFilePath)) {
    res.status(404).json({ success: false, error: 'Audio file not found' });
    return;
  }

  const fileName = job.outputFileName || `audio_${job.videoId}.${job.format}`;
  res.download(job.outputFilePath, fileName, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to download file' });
    }
  });
});

/**
 * Cookie status
 */
apiRouter.get('/cookies', (req: Request, res: Response) => {
  const status = CookieService.getStatus();
  res.json({ success: true, data: status });
});

/**
 * Auto-fetch YouTube guest session cookies
 */
apiRouter.post('/cookies/auto-fetch', async (req: Request, res: Response) => {
  try {
    const result = await CookieService.autoFetchGuestSession();
    const status = CookieService.getStatus();
    res.json({ success: true, ...result, status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to auto-fetch guest session' });
  }
});

/**
 * Test current YouTube session cookies and challenge solver
 */
apiRouter.post('/cookies/test', async (req: Request, res: Response) => {
  try {
    const result = await CookieService.testSession();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to test session' });
  }
});

/**
 * Save user session cookies
 */
apiRouter.post('/cookies', (req: Request, res: Response) => {
  try {
    const { cookies } = req.body;
    if (!cookies) {
      res.status(400).json({ success: false, error: 'Cookies text is required' });
      return;
    }
    const result = CookieService.saveCookies(cookies);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Failed to save cookies' });
  }
});

/**
 * Clear session cookies
 */
apiRouter.delete('/cookies', (req: Request, res: Response) => {
  const result = CookieService.clearCookies();
  res.json(result);
});

/**
 * Pre-verified demo tracks
 */
apiRouter.get('/demo-tracks', (req: Request, res: Response) => {
  res.json({ success: true, data: DEFAULT_DEMO_TRACKS });
});

/**
 * Search/detect music tags from external databases (iTunes, Deezer, MusicBrainz)
 * based on the music/track name input in the tag editor
 */
apiRouter.get('/tags/search', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const source = (req.query.source as 'all' | 'itunes' | 'deezer' | 'musicbrainz') || 'all';

    if (!q || !q.trim()) {
      res.json({ success: true, count: 0, data: [] });
      return;
    }

    const results = await TagFetcherService.searchTags(q.trim(), source);
    res.json({ success: true, count: results.length, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to search tags' });
  }
});

/**
 * Apply/update custom tags on an existing completed audio file
 */
apiRouter.post('/tags/apply/:id', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const { tags } = req.body as { tags: MusicTags };

    if (!tags || !tags.title) {
      res.status(400).json({ success: false, error: 'Valid music tags with at least a title are required' });
      return;
    }

    const job = JobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ success: false, error: 'Conversion job not found' });
      return;
    }

    if (!job.outputFilePath || !fs.existsSync(job.outputFilePath)) {
      res.status(400).json({ success: false, error: 'Audio file is not ready or has expired' });
      return;
    }

    const result = await AudioTagService.applyTagsToFile(job.outputFilePath, tags);

    // Compute updated clean filename
    const cleanTitle = tags.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
    const cleanArtist = (tags.artist || 'Unknown').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
    const newFileName = cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase())
      ? `${cleanTitle}.${job.format}`
      : `${cleanArtist} - ${cleanTitle}.${job.format}`;

    const updatedJob = JobManager.updateJob(jobId, {
      title: tags.title,
      author: tags.artist || job.author,
      thumbnail: tags.coverUrl || job.thumbnail,
      outputFileName: newFileName,
      fileSizeBytes: result.fileSizeBytes,
      tags
    });

    res.json({ success: true, message: 'Audio tags updated successfully', job: updatedJob });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to apply audio tags' });
  }
});

