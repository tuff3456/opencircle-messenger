import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, supabase, type Profile } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { SOUNDS, VOICES, VoicePipeline, type VoiceId } from "@/lib/voice";
import { Avatar } from "./Media";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }],
};

type Peer = { id: string; pc: RTCPeerConnection; stream: MediaStream; pending: RTCIceCandidateInit[]; video: boolean };

function Tile({ stream, name, avatar, muted, mirrored, hasVideo }: { stream: MediaStream | null; name: string; avatar?: string | null; muted?: boolean; mirrored?: boolean; hasVideo: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && stream && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-card border border-border grid place-items-center">
      <video ref={ref} autoPlay playsInline muted={muted} className={`absolute inset-0 size-full object-contain ${hasVideo ? "" : "opacity-0"} ${mirrored ? "-scale-x-100" : ""}`} />
      {!hasVideo && <Avatar path={avatar} name={name} className="size-20 text-3xl" />}
      <span className="absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-0.5 text-xs font-semibold">{name}</span>
    </div>
  );
}

export function CallView({ conversationId, title, onLeave }: { conversationId: string; title: string; onLeave: () => void }) {
  const { user, profile } = useAuth();
  const me = user!.id;
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [muted, setMuted] = useState(false);
  const [videoMode, setVideoMode] = useState<"off" | "camera" | "screen">("off");
  const [voice, setVoice] = useState<VoiceId>("normal");
  const [panel, setPanel] = useState<"none" | "sounds" | "voice">("none");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const peersRef = useRef<Record<string, Peer>>({});
  const chRef = useRef<RealtimeChannel | null>(null);
  const pipeRef = useRef<VoicePipeline | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const callIdRef = useRef<string | null>(null);

  const sync = () => setPeers({ ...peersRef.current });
  const send = (payload: Record<string, unknown>) => chRef.current?.send({ type: "broadcast", event: "sig", payload: { ...payload, from: me } });

  useEffect(() => {
    let cancelled = false;
    const fetchProfile = async (id: string) => {
      if (profiles[id]) return;
      const { data } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
      if (data) setProfiles((p) => ({ ...p, [id]: data }));
    };

    const makePeer = (id: string) => {
      const existing = peersRef.current[id];
      if (existing) return existing;
      const pc = new RTCPeerConnection(ICE);
      const stream = new MediaStream();
      const peer: Peer = { id, pc, stream, pending: [], video: false };
      const at = pc.addTransceiver("audio", { direction: "sendrecv" });
      at.sender.replaceTrack(pipeRef.current?.track ?? null);
      const vt = pc.addTransceiver("video", { direction: "sendrecv" });
      vt.sender.replaceTrack(videoTrackRef.current);
      pc.ontrack = (e) => {
        if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
        sync();
      };
      pc.onicecandidate = (e) => e.candidate && send({ type: "ice", to: id, candidate: e.candidate.toJSON() });
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) { pc.close(); delete peersRef.current[id]; sync(); }
      };
      peersRef.current[id] = peer;
      fetchProfile(id);
      sync();
      return peer;
    };

    (async () => {
      let mic: MediaStream | null = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { toast.error("Microphone blocked — you can still listen. Allow mic access in Chrome to talk."); }
      if (cancelled) { mic?.getTracks().forEach((t) => t.stop()); return; }
      micRef.current = mic;
      pipeRef.current = await VoicePipeline.create(mic);

      // record call as active
      const { data: active } = await db.from("calls").select("id").eq("conversation_id", conversationId).is("ended_at", null).limit(1);
      if (active?.[0]) callIdRef.current = active[0].id;
      else {
        const { data } = await db.from("calls").insert({ conversation_id: conversationId, started_by: me }).select("id").single();
        callIdRef.current = data?.id ?? null;
      }

      const ch = supabase.channel(`call-${conversationId}`, { config: { broadcast: { self: false }, presence: { key: me } } });
      chRef.current = ch;
      ch.on("broadcast", { event: "sig" }, async ({ payload }) => {
        const { type, from, to } = payload as { type: string; from: string; to?: string };
        if (to && to !== me) return;
        if (type === "join") {
          const p = makePeer(from);
          const offer = await p.pc.createOffer();
          await p.pc.setLocalDescription(offer);
          send({ type: "offer", to: from, sdp: offer });
        } else if (type === "offer") {
          const p = makePeer(from);
          await p.pc.setRemoteDescription(payload.sdp);
          for (const c of p.pending) await p.pc.addIceCandidate(c).catch(() => {});
          p.pending = [];
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          send({ type: "answer", to: from, sdp: ans });
        } else if (type === "answer") {
          const p = peersRef.current[from];
          if (p) {
            await p.pc.setRemoteDescription(payload.sdp);
            for (const c of p.pending) await p.pc.addIceCandidate(c).catch(() => {});
            p.pending = [];
          }
        } else if (type === "ice") {
          const p = peersRef.current[from];
          if (!p) return;
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(payload.candidate).catch(() => {});
          else p.pending.push(payload.candidate);
        } else if (type === "video") {
          const p = peersRef.current[from];
          if (p) { p.video = !!payload.on; sync(); }
        } else if (type === "leave") {
          const p = peersRef.current[from];
          if (p) { p.pc.close(); delete peersRef.current[from]; sync(); }
        }
      });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ user: me });
          send({ type: "join" });
        }
      });
    })();

    const onUnload = () => send({ type: "leave" });
    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onUnload);
      send({ type: "leave" });
      const remaining = Object.keys(peersRef.current).length;
      Object.values(peersRef.current).forEach((p) => p.pc.close());
      peersRef.current = {};
      if (remaining === 0 && callIdRef.current) db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", callIdRef.current).then(() => {});
      if (chRef.current) supabase.removeChannel(chRef.current);
      micRef.current?.getTracks().forEach((t) => t.stop());
      videoTrackRef.current?.stop();
      pipeRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, me]);

  const setVideoTrack = (track: MediaStreamTrack | null, mode: "off" | "camera" | "screen") => {
    videoTrackRef.current?.stop();
    videoTrackRef.current = track;
    Object.values(peersRef.current).forEach((p) => {
      const s = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "video")?.sender;
      s?.replaceTrack(track);
    });
    setLocalStream(track ? new MediaStream([track]) : null);
    setVideoMode(mode);
    send({ type: "video", on: !!track });
  };

  async function toggleCamera() {
    if (videoMode === "camera") return setVideoTrack(null, "off");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      setVideoTrack(s.getVideoTracks()[0], "camera");
    } catch { toast.error("Camera blocked. Allow camera access in Chrome."); }
  }
  async function toggleScreen() {
    if (videoMode === "screen") return setVideoTrack(null, "off");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const t = s.getVideoTracks()[0];
      t.onended = () => setVideoTrack(null, "off");
      setVideoTrack(t, "screen");
    } catch { /* cancelled */ }
  }
  // Tell late joiners about video state
  useEffect(() => {
    const ids = Object.keys(peers);
    if (ids.length && videoMode !== "off") send({ type: "video", on: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(peers).length]);

  const peerList = Object.values(peers);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">{peerList.length + 1} in call</p>
        </div>
        <Button variant="destructive" onClick={onLeave}>Leave call</Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Tile stream={localStream} name={`${profile?.display_name ?? "You"} (you)`} avatar={profile?.avatar_url} muted mirrored={videoMode === "camera"} hasVideo={videoMode !== "off"} />
          {peerList.map((p) => (
            <Tile key={p.id} stream={p.stream} name={profiles[p.id]?.display_name ?? "…"} avatar={profiles[p.id]?.avatar_url} hasVideo={p.video} />
          ))}
        </div>
        {peerList.length === 0 && <p className="mt-6 text-center text-muted-foreground">Waiting for others to join…</p>}
      </div>
      {panel !== "none" && (
        <div className="border-t border-border bg-panel p-3">
          {panel === "sounds" ? (
            <div className="flex flex-wrap gap-2 justify-center">
              {SOUNDS.map((s) => <Button key={s.id} variant="secondary" size="sm" onClick={() => pipeRef.current?.play(s.id)}>{s.label}</Button>)}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 justify-center">
              {VOICES.map((v) => (
                <Button key={v.id} size="sm" variant={voice === v.id ? "default" : "secondary"}
                  onClick={() => { pipeRef.current?.setVoice(v.id); setVoice(v.id); }}>{v.label}</Button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border p-3">
        <Button variant={muted ? "destructive" : "secondary"} onClick={() => { pipeRef.current?.setMuted(!muted); setMuted(!muted); }}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</Button>
        <Button variant={videoMode === "camera" ? "default" : "secondary"} onClick={toggleCamera}>📷 {videoMode === "camera" ? "Camera off" : "Camera"}</Button>
        <Button variant={videoMode === "screen" ? "default" : "secondary"} onClick={toggleScreen}>🖥️ {videoMode === "screen" ? "Stop sharing" : "Share screen"}</Button>
        <Button variant={panel === "sounds" ? "default" : "secondary"} onClick={() => setPanel(panel === "sounds" ? "none" : "sounds")}>🔊 Soundboard</Button>
        <Button variant={panel === "voice" ? "default" : "secondary"} onClick={() => setPanel(panel === "voice" ? "none" : "voice")}>🎭 Voice: {VOICES.find((v) => v.id === voice)?.label}</Button>
      </div>
    </div>
  );
}
