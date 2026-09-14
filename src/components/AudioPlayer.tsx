import { Download, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { ConversionJob } from '../types';

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

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isLooping]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
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
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <article id="audio-player-component" className="w-full bg-zinc-900 text-white rounded-xl p-4 shadow-lg border border-zinc-800 space-y-3">
      <audio
        ref={audioRef}
        src={job.streamUrl || `/api/stream/${job.id}`}
        preload="metadata"
      />

      <div className="flex items-center gap-3">
        {/* Thumbnail art */}
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0 border border-zinc-700/60">
          <img
            src={job.thumbnail}
            alt={job.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Track Title and Artist */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-zinc-100 truncate">{job.title}</h4>
          <p className="text-xs text-zinc-400 truncate">{job.author} • {job.format.toUpperCase()} ({job.bitrate})</p>
        </div>

        {/* Quick download button */}
        <a
          id="player-download-btn"
          href={job.downloadUrl || `/api/download/${job.id}`}
          download={job.outputFileName || `${job.title}.${job.format}`}
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white transition-colors"
          title="Download audio file"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>

      {/* Scrubber progress bar */}
      <div className="space-y-1">
        <input
          id="audio-scrubber-slider"
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none"
        />
        <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <button
            id="player-loop-toggle"
            type="button"
            onClick={toggleLoop}
            className={`p-1.5 rounded-md transition-colors ${
              isLooping ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title={isLooping ? 'Repeat on' : 'Repeat off'}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Main Play/Pause */}
        <button
          id="player-play-pause-btn"
          type="button"
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-transform active:scale-95 shadow-md shadow-rose-600/30"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>

        {/* Volume controls */}
        <div className="flex items-center gap-1.5 w-28">
          <button
            id="player-mute-btn"
            type="button"
            onClick={toggleMute}
            className="text-zinc-400 hover:text-zinc-200 p-1"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            id="player-volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-300"
          />
        </div>
      </div>
    </article>
  );
};
