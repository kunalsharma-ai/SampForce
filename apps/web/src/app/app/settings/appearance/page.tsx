import type { Metadata } from 'next';
import { ThemeStudio } from './theme-studio';

export const metadata: Metadata = { title: 'Theme Studio' };

export default function ThemeStudioPage() {
  return <ThemeStudio />;
}
