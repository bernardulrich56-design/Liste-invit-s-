import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-lg border border-slate-700"
    >
      <WifiOff className="w-4 h-4 text-orange-400 shrink-0" />
      <span>Mode hors ligne — Données enregistrées affichées</span>
    </div>
  );
};
