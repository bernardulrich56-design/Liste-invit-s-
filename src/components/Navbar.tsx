import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { FESTIVAL_LOGO_URL } from '../data/initialData';
import { ActiveTab } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  pendingAdminCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  pendingAdminCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'guests', label: 'Invités' },
    { id: 'booking', label: 'Prendre un rendez-vous' },
    { id: 'tracking', label: 'Suivi & Notifications' },
    {
      id: 'admin',
      label: pendingAdminCount > 0 ? `Organisateur (${pendingAdminCount})` : 'Organisateur',
    },
  ];

  const handleNav = (id: ActiveTab) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-300/90 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Logo top-left + Brand Title */}
        <button
          type="button"
          onClick={() => handleNav('guests')}
          className="flex items-center gap-3 text-left shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-600 rounded-lg"
        >
          <img
            src={FESTIVAL_LOGO_URL}
            alt="Logo Bilili BD Festival"
            referrerPolicy="no-referrer"
            className="h-10 w-10 rounded-xl object-cover bg-slate-900 ring-1 ring-slate-900/10 shrink-0"
          />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Bilili BD 2026
          </span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Navigation principale"
          className="hidden md:flex items-center gap-7"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                  isActive
                    ? 'text-emerald-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {item.label}
                <span
                  className={`absolute inset-x-0 bottom-0 h-0.5 transition-opacity ${
                    isActive ? 'bg-orange-600 opacity-100' : 'bg-emerald-600 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleNav('booking')}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
          >
            Réserver un échange
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => handleNav('booking')}
            className="w-full mt-2 px-4 py-2.5 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
          >
            Réserver un échange
          </button>
          <div className="pt-1">
            <PWAInstallButton variant="button" />
          </div>
        </div>
      )}
    </header>
  );
};
