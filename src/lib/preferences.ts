export type Preferences = { theme: string; notifications: boolean; sound: string; volume: number; customSound: string | null };
export const defaultPreferences: Preferences = { theme: 'original', notifications: true, sound: 'chime', volume: 0.4, customSound: null };
export function readPreferences(): Preferences {
  try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem('jhp-preferences') || '{}') }; }
  catch { return defaultPreferences; }
}
export function savePreferences(value: Preferences) {
  localStorage.setItem('jhp-preferences', JSON.stringify(value));
  document.documentElement.dataset.theme = value.theme;
  window.dispatchEvent(new Event('jhp-preferences'));
}
export async function playNotification(p = readPreferences()) {
  if (!p.notifications || p.sound === 'silent') return;
  if (p.sound === 'custom' && p.customSound) {
    const { signedUrl } = await import('./db');
    const url = await signedUrl(p.customSound);
    if (url) { const audio = new Audio(url); audio.volume = p.volume; await audio.play().catch(() => {}); }
    return;
  }
  const ctx = new AudioContext();
  await ctx.resume();
  const gain = ctx.createGain(); gain.gain.value = p.volume * 0.2; gain.connect(ctx.destination);
  const frequencies = p.sound === 'bell' ? [880, 1320] : p.sound === 'pop' ? [440] : [660, 880];
  frequencies.forEach((frequency, i) => {
    const oscillator = ctx.createOscillator(); const envelope = ctx.createGain();
    oscillator.frequency.value = frequency; envelope.gain.setValueAtTime(1, ctx.currentTime + i * 0.12);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
    oscillator.connect(envelope); envelope.connect(gain); oscillator.start(ctx.currentTime + i * 0.12); oscillator.stop(ctx.currentTime + i * 0.12 + 0.3);
  });
  setTimeout(() => { void ctx.close(); }, 1000);
}
export function isOnline(lastSeen: string | null | undefined, now = Date.now()) {
  return !!lastSeen && now - Date.parse(lastSeen) < 75_000;
}
export function canResetPassword(isAdmin: boolean, callerId: string, targetId: string) {
  return isAdmin && callerId !== targetId;
}