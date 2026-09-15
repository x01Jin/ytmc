import { Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ConversionJob } from "../types";
import {
  needsPreviewPlayback,
  withPreviewForFormat,
} from "../utils/audioSupport";

interface AudioPlayerProps {
  job?: ConversionJob;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ job }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewFallback, setPreviewFallback] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    audio?.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadError(null);
    setPreviewFallback(false);
    audio?.load();
  }, [job?.id, job?.streamUrl]);

  useEffect(() => {
    if (!isPlaying) return;

    let frame = 0;
    const syncPlaybackPosition = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      frame = requestAnimationFrame(syncPlaybackPosition);
    };
    frame = requestAnimationFrame(syncPlaybackPosition);

    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audio) {
      audio.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMuted) {
      audio.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  };

  const toggleLoop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = !isLooping;
    setIsLooping(!isLooping);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  if (!job) {
    return (
      <article
        id="audio-player-component"
        aria-label="Audio preview player"
        className="px-panel flex min-h-12 items-center px-3 py-2 text-xs text-px-dim"
      >
        Select a track to load it into the player.
      </article>
    );
  }

  const streamSrc = job
    ? withPreviewForFormat(
        previewFallback
          ? `/api/stream/${encodeURIComponent(job.id)}?preview=mp3`
          : job.streamUrl || `/api/stream/${encodeURIComponent(job.id)}`,
        job.id,
        job.format,
      )
    : "";

  return (
    <article
      id="audio-player-component"
      aria-label={`Audio preview: ${job.title}`}
      className="px-panel grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,2fr)_auto] items-center gap-2 p-2"
    >
      <audio
        ref={audioRef}
        src={streamSrc}
        preload="metadata"
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration)) setDuration(nextDuration);
        }}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => {
          if (needsPreviewPlayback(job.format) && !previewFallback) {
            setPreviewFallback(true);
            return;
          }
          setIsPlaying(false);
          setLoadError(
            "This track could not be played. The file may be missing or still processing.",
          );
        }}
        onEnded={() => {
          setCurrentTime(0);
          if (!isLooping) setIsPlaying(false);
        }}
      />

      <div className="flex min-w-0 items-center gap-2">
        {/* Thumbnail art */}
        <div className="h-9 w-9 shrink-0 overflow-hidden border-2 border-px-line bg-px-bg">
          <img
            src={job.thumbnail}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="px-pixelated h-full w-full object-cover"
          />
        </div>

        {/* Track Title and Artist */}
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-px-text">
            {job.title}
          </h4>
          <p className="px-tabular truncate text-xs text-px-dim" translate="no">
            {job.author} • {job.format.toUpperCase()} ({job.bitrate})
          </p>
        </div>
      </div>

      {/* Main play control stays immediately left of the responsive scrubber. */}
      <button
        id="player-play-pause-btn"
        type="button"
        onClick={togglePlay}
        className="px-btn px-btn-primary flex h-10 w-10 shrink-0 items-center justify-center !p-0"
        title={isPlaying ? "Pause" : "Play"}
        aria-label={isPlaying ? `Pause ${job.title}` : `Play ${job.title}`}
      >
        {isPlaying ? (
          <Pause className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
        )}
      </button>

      {/* Scrubber progress bar */}
      <div className="min-w-0 space-y-1">
        <label htmlFor="audio-scrubber-slider" className="sr-only">
          Seek in {job.title}
        </label>
        <input
          id="audio-scrubber-slider"
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="h-1.5 w-full cursor-pointer appearance-none bg-px-line accent-[#7c5cff]"
        />
        <div className="px-tabular flex justify-between text-[11px] text-px-dim">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        {loadError && (
          <p role="alert" className="text-[11px] text-red-400">
            {loadError}
          </p>
        )}
      </div>

      {/* Secondary controls stay in their own compact column. */}
      <div className="flex items-center gap-1">
        <button
          id="player-loop-toggle"
          type="button"
          onClick={toggleLoop}
          aria-pressed={isLooping}
          className={`px-btn !border-0 !p-1.5 ${
            isLooping ? "!text-px-acc" : "!text-px-dim"
          }`}
          title={isLooping ? "Repeat on" : "Repeat off"}
          aria-label={isLooping ? "Repeat on" : "Repeat off"}
        >
          <Repeat className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* Volume controls */}
        <div className="flex w-20 items-center gap-1">
          <button
            id="player-mute-btn"
            type="button"
            onClick={toggleMute}
            className="px-btn !border-0 !p-1 !text-px-dim"
            title={isMuted ? "Unmute" : "Mute"}
            aria-label={isMuted ? "Unmute" : "Mute"}
            aria-pressed={isMuted}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <label htmlFor="player-volume-slider" className="sr-only">
            Volume
          </label>
          <input
            id="player-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="h-1 w-12 cursor-pointer appearance-none bg-px-line accent-[#7c5cff]"
          />
        </div>
      </div>
    </article>
  );
};
