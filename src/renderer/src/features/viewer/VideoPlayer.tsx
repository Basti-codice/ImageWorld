import { useEffect, useRef, useState, type RefObject } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { Photo } from '@shared/types';
import { originalUrl, thumbUrl } from '@/lib/media';
import { fmtDuration } from '@/lib/format';
import { useT } from '@/i18n';

interface Props { photo: Photo; videoRef: RefObject<HTMLVideoElement | null> }

/** Minimal custom player: big play button, scrubber (range request seeking), time, volume, fullscreen. */
export default function VideoPlayer({ photo, videoRef }: Props) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(photo.duration ?? 0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => { void videoRef.current?.play().catch(() => {}); }, [videoRef]);

  const toggle = () => { const v = videoRef.current; if (!v || error) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); };
  const shown = scrub ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;

  return (
    <div ref={wrap} className="vw-video" data-playing={playing}>
      <video ref={videoRef} src={originalUrl(photo)} poster={thumbUrl(photo, 1600)} playsInline preload="metadata" muted={muted}
        onClick={toggle}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { if (isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); }}
        onError={() => setError(true)} />
      {!playing && !error && <button className="vw-video__big" aria-label={t('viewer.video.play')} onClick={toggle}><Play size={26} fill="currentColor" /></button>}
      {error && <div className="vw-video__err">{t('viewer.error.video')}</div>}
      <div className="vw-video__bar" onClick={(e) => e.stopPropagation()}>
        <button className="vw-video__btn" aria-label={playing ? t('viewer.video.pause') : t('viewer.video.play')} onClick={toggle}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <span className="vw-video__time tabular">{fmtDuration(shown)}</span>
        <input className="vw-range" type="range" min={0} max={duration || 1} step={0.05} value={shown} aria-label={t('viewer.video.seek')} style={{ ['--p' as string]: `${pct}%` }}
          onChange={(e) => setScrub(+e.target.value)}
          onPointerUp={() => { if (scrub != null && videoRef.current) videoRef.current.currentTime = scrub; setScrub(null); }}
          onKeyUp={() => { if (scrub != null && videoRef.current) videoRef.current.currentTime = scrub; setScrub(null); }} />
        <span className="vw-video__time tabular">{fmtDuration(duration)}</span>
        <button className="vw-video__btn" aria-label={muted ? t('viewer.video.unmute') : t('viewer.video.mute')} onClick={() => setMuted((m) => !m)}>
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button className="vw-video__btn" aria-label={t('viewer.video.fullscreen')} onClick={() => { const el = wrap.current; if (document.fullscreenElement) void document.exitFullscreen(); else void el?.requestFullscreen?.().catch(() => {}); }}><Maximize size={15} /></button>
      </div>
    </div>
  );
}
