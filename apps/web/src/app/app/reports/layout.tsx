import { ReportsNav } from './reports-nav';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-7xl">
      <ReportsNav />
      {children}
    </div>
  );
}
