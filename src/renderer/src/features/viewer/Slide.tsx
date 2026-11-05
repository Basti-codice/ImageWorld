import { memo, useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { ImageOff } from 'lucide-react';
import type { Photo } from '@shared/types';
import { originalUrl, thumbUrl } from '@/lib/media';
import { useT } from '@/i18n';
import VideoPlayer from './VideoPlayer';
import type { ZoomView } from './useZoomPan';

/** Formats browsers can decode natively; everything else (RAW, HEIC…) stays on the 1600px preview. */
const NATIVE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg']);

function ProgressiveImage({ photo, wantOriginal }: { photo: Photo; wantOriginal: boolean }) {
  const t = useT();
  const [thumbOk, setThumbOk] = useState(false);
  const [failed, setFailed] = useState(false);
  const [origReady, setOrigReady] = useState(false);
  const canOriginal = NATIVE.has(photo.ext.toLowerCase());

  // swap to the original once the user zooms in (and keep it afterwards)
  useEffect(() => {
    if (!wantOriginal || !canOriginal || origReady) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setOrigReady(true); };
    img.src = originalUrl(photo);
    return () => { alive = false; };
  }, [wantOriginal, canOriginal, origReady, photo]);

  if (failed) return <div className="vw-fail"><ImageOff size={32} strokeWidth={1.25} />{t('viewer.error.image')}</div>;
  return (
    <>
      <img className="vw-img" data-ready={thumbOk} src={thumbUrl(photo, 1600)} alt={photo.name} draggable={false}
        onLoad={() => setThumbOk(true)} onError={() => setFailed(true)} />
      {origReady && <img className="vw-img vw-img--orig" src={originalUrl(photo)} alt="" draggable={false} />}
    </>
  );
}

interface Props {
  photo: Photo;
  index: number;
  current: boolean;
  view?: ZoomView;
  zoomed: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}

/** One lightbox page. Only the current slide receives the zoom transform. */
export default memo(function Slide({ photo, index, current, view, zoomed, videoRef }: Props) {
  const ratio = photo.width / (photo.height || 1);
  const style: CSSProperties = { left: `${index * 100}%`, ['--ratio' as string]: ratio };
  const zoomStyle: CSSProperties | undefined = current && view
    ? { transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`, transition: view.anim ? 'transform 260ms var(--ease)' : 'none', cursor: view.z > 1.001 ? 'grab' : undefined }
    : undefined;
  return (
    <div className="vw-slide" style={style} aria-hidden={!current}>
      <div className="vw-zoom" style={zoomStyle}>
        <div className="vw-frame" style={{ background: photo.color }}>
          {photo.kind === 'video' && current
            ? <VideoPlayer photo={photo} videoRef={videoRef} />
            : <ProgressiveImage photo={photo} wantOriginal={current && zoomed && photo.kind === 'photo'} />}
        </div>
      </div>
    </div>
  );
});
