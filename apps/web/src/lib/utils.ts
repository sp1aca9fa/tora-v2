import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function formatJpy(amount: number): string {
  return yen.format(amount);
}
