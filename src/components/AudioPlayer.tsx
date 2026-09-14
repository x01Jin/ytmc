import { Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ConversionJob } from "../types";

interface AudioPlayerProps {
  job: ConversionJob;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ job }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleEnded = () => {
      if (!isLooping) setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [isLooping]);

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

  return (
    <article
      id="audio-player-component"
      aria-label={`Audio preview: ${job.title}`}
      className="px-panel w-full space-y-3 p-3"
    >
      <audio
        ref={audioRef}
        src={job.streamUrl || `/api/stream/${job.id}`}
        preload="metadata"
      />

      <div className="flex items-center gap-3">
        {/* Thumbnail art */}
        <div className="h-12 w-12 shrink-0 overflow-hidden border-2 border-px-line bg-px-bg">
          <img
            src={job.thumbnail}
            alt=""
            width={48}
            height={48}
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

      {/* Scrubber progress bar */}
      <div className="space-y-1">
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
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
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
        </div>

        {/* Main Play/Pause */}
        <button
          id="player-play-pause-btn"
          type="button"
          onClick={togglePlay}
          className="px-btn px-btn-primary flex h-10 w-10 items-center justify-center !p-0"
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? `Pause ${job.title}` : `Play ${job.title}`}
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
          )}
        </button>

        {/* Volume controls */}
        <div className="flex w-28 items-center gap-1.5">
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
            className="h-1 w-16 cursor-pointer appearance-none bg-px-line accent-[#7c5cff]"
          />
        </div>
      </div>
    </article>
  );
};
