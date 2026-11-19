import React, { useMemo } from 'react';
import { Globe2, X } from 'lucide-react';
import { Guest } from '../types';

interface NationalityChartPanelProps {
  guests: Guest[];
  activeNationality: string;
  onSelectNationality: (nationality: string) => void;
}

export const NationalityChartPanel: React.FC<NationalityChartPanelProps> = ({
  guests,
  activeNationality,
  onSelectNationality,
}) => {
  const breakdown = useMemo(() => {
    const map = new Map<
      string,
      { nationality: string; total: number; received: number }
    >();

    for (const g of guests) {
      const nat = (g.nationality || 'Non précisée').trim();
      const prev = map.get(nat) || { nationality: nat, total: 0, received: 0 };
      prev.total += 1;
      if (g.checkedIn) prev.received += 1;
      map.set(nat, prev);
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [guests]);

  const maxCount = useMemo(
    () => Math.max(1, ...breakdown.map((b) => b.total)),
    [breakdown]
  );

  if (breakdown.length === 0) return null;

  return (
    <section className="bg-white border border-slate-300/90 rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <Globe2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
              Répartition par nationalité ({breakdown.length})
            </h2>
            <p className="text-xs text-slate-500">
              Cliquez sur un pays pour filtrer la liste des invités (vert : reçus, gris : en attente).
            </p>
          </div>
        </div>

        {activeNationality && (
          <button
            type="button"
            onClick={() => onSelectNationality('')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-xs font-semibold text-orange-800 hover:bg-orange-100"
          >
            <X className="w-3.5 h-3.5" />
            Filtre : {activeNationality}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {breakdown.map((item) => {
          const isSelected = activeNationality === item.nationality;
          const totalWidthPct = Math.round((item.total / maxCount) * 100);
          const receivedWithinTotalPct =
            item.total > 0 ? Math.round((item.received / item.total) * 100) : 0;

          return (
            <button
              key={item.nationality}
              type="button"
              onClick={() =>
                onSelectNationality(isSelected ? '' : item.nationality)
              }
              className={`text-left p-3 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-emerald-50 border-emerald-600 ring-1 ring-emerald-600/30'
                  : 'bg-[#F4F7FB] border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                <span className="font-semibold text-slate-900 truncate">
                  {item.nationality}
                </span>
                <span className="font-mono font-bold text-slate-700 tabular-nums shrink-0">
                  {item.received}/{item.total}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400 rounded-full overflow-hidden"
                  style={{ width: `${totalWidthPct}%` }}
                >
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${receivedWithinTotalPct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
