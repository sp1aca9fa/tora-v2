import { Bell, Eye, Plug, Store, User } from 'lucide-react';

/** Settings sections, each its own page (requirements S8: Settings in sub-pages). */
export const SETTINGS_SECTIONS = [
  { key: 'account', icon: User },
  { key: 'display', icon: Eye },
  { key: 'notices', icon: Bell },
  { key: 'sources', icon: Store },
  { key: 'collectors', icon: Plug },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key'];
