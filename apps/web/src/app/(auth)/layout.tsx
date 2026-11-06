import { AmbientBackground } from '@/components/ambient-background';
import { AuthLanguage } from '@/components/auth-language';
import { Logo } from '@/components/logo';
import { Tr } from '@/lib/i18n';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen lg:grid-cols-2">
      <AmbientBackground />
      <section className="hidden flex-col justify-between border-e border-border/60 p-10 lg:flex">
        <Logo />
        <div className="max-w-md space-y-4">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            <Tr text="Close smarter. Grow faster." /> <span className="text-gradient"><Tr text="Sell. Close. Grow." /></span>
          </h2>
          <p className="text-muted-foreground">
            <Tr text="One workspace for leads, deals, automation and revenue intelligence, with AI that shows its reasoning and asks before it acts." />
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Sampledge</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="lg:invisible">
              <Logo />
            </div>
            <AuthLanguage />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
