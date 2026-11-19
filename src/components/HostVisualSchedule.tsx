import React, { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, MapPin, Video } from 'lucide-react';
import { Appointment, HostConfig } from '../types';

interface HostVisualScheduleProps {
  hosts: HostConfig[];
  appointments: Appointment[];
}

export const HostVisualSchedule: React.FC<HostVisualScheduleProps> = ({
  hosts,
  appointments,
}) => {
  const todayStr = new Date().toISOString().slice(0, 10);

  const activeDates = useMemo(() => {
    const dates = new Set<string>([todayStr]);
    appointments.forEach((a) => {
      if (a.desiredDate) dates.add(a.desiredDate);
    });
    return Array.from(dates).sort();
  }, [appointments, todayStr]);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  return (
    <section className="space-y-5">
      <div className="bg-white border border-slate-300/90 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-700" />
            Planning visuel par hôte
          </h2>
          <p className="text-xs text-slate-600">
            Vue côte à côte des rendez-vous confirmés et en attente pour Monsieur Jean-Jacques, Vénicia et Madame Joël.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Date du planning visuel"
            className="h-10 px-3 bg-[#F4F7FB] border border-slate-300 rounded-xl text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:border-emerald-600"
          />
          {activeDates.slice(0, 5).map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => setSelectedDate(dt)}
              className={`px-3 py-2 rounded-xl text-xs font-mono font-semibold transition-colors ${
                selectedDate === dt
                  ? 'bg-slate-900 text-white'
                  : 'bg-[#F4F7FB] border border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {dt === todayStr ? `Aujourd’hui (${dt.slice(5)})` : dt}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {hosts.map((host) => {
          const isBlocked = host.blockedDates.includes(selectedDate);
          const dayAppts = appointments
            .filter(
              (a) =>
                a.desiredDate === selectedDate &&
                a.hostIds.includes(host.hostId) &&
                a.status !== 'declined_or_reschedule'
            )
            .sort((a, b) => a.desiredTime.localeCompare(b.desiredTime));

          return (
            <div
              key={host.hostId}
              className="bg-white border border-slate-300/90 rounded-2xl overflow-hidden flex flex-col shadow-xs"
            >
              <div className="p-4 bg-[#F4F7FB] border-b border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-slate-900">
                    {host.name}
                  </h3>
                  <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                    {host.startHour} – {host.endHour}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{host.role}</p>
                {isBlocked && (
                  <p className="text-xs font-semibold text-orange-700 pt-0.5">
                    Date bloquée (indisponible ce jour)
                  </p>
                )}
              </div>

              <div className="p-4 space-y-3 flex-1">
                {dayAppts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Aucun rendez-vous prévu le {selectedDate}.
                  </div>
                ) : (
                  dayAppts.map((appt) => (
                    <div
                      key={appt.id}
                      className={`rounded-xl border p-3.5 space-y-1.5 ${
                        appt.status === 'confirmed'
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : 'bg-amber-50/70 border-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {appt.desiredTime} ({appt.durationMinutes} min)
                        </span>
                        {appt.status === 'confirmed' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Confirmé
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                            <Clock className="w-3.5 h-3.5" />
                            En attente
                          </span>
                        )}
                      </div>

                      <div className="font-display text-sm font-bold text-slate-900">
                        {appt.requesterName}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>{appt.reason}</span>
                        <span className="inline-flex items-center gap-1 capitalize">
                          {appt.format === 'présentiel' ? (
                            <MapPin className="w-3 h-3 text-slate-400" />
                          ) : (
                            <Video className="w-3 h-3 text-slate-400" />
                          )}
                          {appt.format}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
