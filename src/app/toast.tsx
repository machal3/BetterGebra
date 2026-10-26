/**
 * Short messages ("Wykres zapisany jako PNG.", "Rysunek wyczyszczony. Ctrl+Z przywraca.") as an Affect UI
 * Notification Stack (Clean) in the corner: the newest in front, gone after a few seconds — longer when it offers
 * an action like Cofnij. Screen readers hear each message once through a polite status line.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { NotificationStack, type Notice } from '@/components/ui/notification-stack-clean';

interface Toast { id: string; message: string; action?: { label: string; run: () => void } }

let toasts: Toast[] = [];
let said = '';
let next = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };
const dismiss = (id: string) => { toasts = toasts.filter(t => t.id !== id); notify(); };

/** A short message; with an action (Cofnij) it stays longer and the button takes clicks. */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  const id = `toast-${++next}`;
  toasts = [{ id, message, action }, ...toasts].slice(0, 3);
  said = message;
  notify();
  window.setTimeout(() => dismiss(id), action ? 7000 : 2600);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  const message = useSyncExternalStore(subscribe, () => said);
  const notices = useMemo<Notice[]>(() => list.map(t => ({
    id: t.id,
    title: t.message,
    text: '',
    pattern: 'grid',
    action: t.action && { label: t.action.label, onClick: () => { dismiss(t.id); t.action!.run(); } },
  })), [list]);
  return (
    <div className="b-toaster">
      <NotificationStack notices={notices} onDismiss={n => dismiss(n.id)} />
      <p className="b-visually-hidden" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
