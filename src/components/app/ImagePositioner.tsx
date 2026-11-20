import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ImagePositioner({ file, banner, onSave, onClose }: { file: File | null; banner: boolean; onSave: (file: File) => Promise<void>; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [position, setPosition] = useState([50, 50]);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; position: number[] } | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); const img = new Image();
    setReady(false); setPosition([50, 50]); setZoom(1);
    img.onload = () => { image.current = img; setReady(true); }; img.src = url;
    return () => { URL.revokeObjectURL(url); image.current = null; };
  }, [file]);
  useEffect(() => {
    const c = canvas.current; const img = image.current; if (!c || !img || !ready) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const scale = Math.max(c.width / img.width, c.height / img.height) * zoom;
    const w = img.width * scale; const h = img.height * scale;
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, (c.width - w) * (position[0] ?? 50) / 100, (c.height - h) * (position[1] ?? 50) / 100, w, h);
  }, [ready, position, zoom, banner]);
  return <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{banner ? 'Position banner' : 'Position profile picture'}</DialogTitle></DialogHeader>
    <canvas ref={canvas} width={banner ? 1200 : 512} height={banner ? 300 : 512} aria-label="Image crop preview" className={`w-full touch-none cursor-move bg-muted ${banner ? 'aspect-[4/1]' : 'aspect-square rounded-full'}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, position }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; setPosition([Math.max(0, Math.min(100, (d.position[0] ?? 50) - (e.clientX - d.x) / 2)), Math.max(0, Math.min(100, (d.position[1] ?? 50) - (e.clientY - d.y) / 2))]); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
    <label className="space-y-2 text-sm">Horizontal<Slider aria-label="Horizontal position" value={[position[0] ?? 50]} onValueChange={([x]) => setPosition([x ?? 50, position[1] ?? 50])} max={100} /></label>
    <label className="space-y-2 text-sm">Vertical<Slider aria-label="Vertical position" value={[position[1] ?? 50]} onValueChange={([y]) => setPosition([position[0] ?? 50, y ?? 50])} max={100} /></label>
    <label className="space-y-2 text-sm">Zoom<Slider aria-label="Image zoom" value={[zoom]} min={1} max={3} step={0.01} onValueChange={([z]) => setZoom(z ?? 1)} /></label>
    <div className="flex gap-2"><Button variant="outline" onClick={() => { setPosition([50, 50]); setZoom(1); }}>Center</Button><Button disabled={!ready || busy} onClick={() => { setBusy(true); canvas.current?.toBlob(async (blob) => { try { if (blob) await onSave(new File([blob], banner ? 'banner.jpg' : 'avatar.jpg', { type: 'image/jpeg' })); } finally { setBusy(false); } }, 'image/jpeg', 0.92); }}>{busy ? 'Saving…' : 'Save image'}</Button></div>
  </DialogContent></Dialog>;
}