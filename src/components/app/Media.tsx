import { useEffect, useState } from "react";
import { signedUrl } from "@/lib/db";
import { cn } from "@/lib/utils";

export function useSigned(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    signedUrl(path).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [path]);
  return url;
}

export function Avatar({ path, name, className, onClick }: { path?: string | null; name: string; className?: string; onClick?: () => void }) {
  const url = useSigned(path);
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn("shrink-0 overflow-hidden rounded-full bg-accent text-accent-foreground grid place-items-center font-semibold size-10 disabled:cursor-default", className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
    </button>
  );
}

export function AttachmentView({ kind, path, name }: { kind: string; path: string; name?: string | null }) {
  const url = useSigned(path);
  if (!url) return <div className="h-20 w-48 animate-pulse rounded-lg bg-muted" />;
  if (kind === "image") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name ?? ""} className="max-h-72 max-w-full rounded-lg" /></a>;
  if (kind === "video") return <video src={url} controls className="max-h-72 max-w-full rounded-lg" />;
  if (kind === "audio" || kind === "voice") return <audio src={url} controls className="max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" download={name ?? undefined}
      className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 underline-offset-2 hover:underline">
      📎 <span className="truncate max-w-56">{name ?? "file"}</span>
    </a>
  );
}
