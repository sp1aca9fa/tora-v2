import {
  Bell,
  BellRing,
  History,
  Clock,
  Database,
  Download,
  Eye,
  Fingerprint,
  Globe,
  Languages,
  PackageOpen,
  Shapes,
  Plug,
  ShieldCheck,
  Store,
  Terminal,
  User,
} from 'lucide-react';

export interface SettingsEntry {
  key: string;
  href: string;
  icon: typeof User;
  /** Shown to admins only (the page refuses others too). */
  admin?: boolean;
  children?: SettingsEntry[];
}

/** Settings sections, each its own page (S8); admin preferences group the whole-app settings. */
export const SETTINGS_SECTIONS: SettingsEntry[] = [
  { key: 'account', href: '/settings/account', icon: User },
  { key: 'display', href: '/settings/display', icon: Eye },
  { key: 'notices', href: '/settings/notices', icon: Bell },
  { key: 'alerts', href: '/settings/alerts', icon: BellRing },
  { key: 'activity', href: '/settings/activity', icon: History },
  { key: 'collectors', href: '/settings/collectors', icon: Plug },
  { key: 'data', href: '/settings/data', icon: Download },
  {
    key: 'admin',
    href: '/settings/admin',
    icon: ShieldCheck,
    admin: true,
    children: [
      { key: 'markets', href: '/settings/admin/markets', icon: Globe, admin: true },
      { key: 'sources', href: '/settings/admin/sources', icon: Store, admin: true },
      { key: 'identity', href: '/settings/admin/identity', icon: Fingerprint, admin: true },
      { key: 'categories', href: '/settings/admin/categories', icon: Shapes, admin: true },
      { key: 'languages', href: '/settings/admin/languages', icon: Languages, admin: true },
      { key: 'timeZone', href: '/settings/admin/time-zone', icon: Clock, admin: true },
      { key: 'opening', href: '/settings/admin/opening', icon: PackageOpen, admin: true },
      { key: 'database', href: '/settings/admin/database', icon: Database, admin: true },
      { key: 'commands', href: '/settings/admin/commands', icon: Terminal, admin: true },
    ],
  },
];

/** The sections a user sees. */
export const sectionsFor = (admin: boolean) => SETTINGS_SECTIONS.filter((s) => admin || !s.admin);

/** The section open at a path, and the one it belongs to (for a way back). */
export function sectionAt(
  pathname: string,
): { entry: SettingsEntry; parent: SettingsEntry | null } | null {
  for (const s of SETTINGS_SECTIONS) {
    for (const c of s.children ?? []) {
      if (pathname.startsWith(c.href)) return { entry: c, parent: s };
    }
    if (pathname.startsWith(s.href)) return { entry: s, parent: null };
  }
  return null;
}
