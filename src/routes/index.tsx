import { createFileRoute } from "@tanstack/react-router";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthScreen } from "@/components/app/AuthScreen";
import { AppShell } from "@/components/app/AppShell";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Javiers History Project — Chat, call & share" },
      { name: "description", content: "Message friends and groups, make calls with camera and screen share, and share photos, videos, voice notes and files." },
      { property: "og:title", content: "Javiers History Project" },
      { property: "og:description", content: "Chat, call and share with friends and groups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  return user ? <AppShell /> : <AuthScreen />;
}

function Index() {
  return <AuthProvider><Gate /></AuthProvider>;
}
