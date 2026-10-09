import { appIcon } from '@/lib/app-icon';

const SIZES = [192, 512];

export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  return appIcon(Number((await params).size));
}
