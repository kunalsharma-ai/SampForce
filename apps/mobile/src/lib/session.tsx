import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { deviceInfo } from './device';
import { currentLanguage, pickLanguage, setLanguage } from './i18n';
import { SessionController, type SessionState } from './session-controller';
import { plainStore, secureTokens } from './storage';
import { type Theme, themeFor } from './theme';

setLanguage(pickLanguage(getLocales().map((l) => l.languageTag)));

const DEFAULT_SERVER = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'https://app.sampforce.com';

const controller = new SessionController({ tokens: secureTokens, kv: plainStore, device: deviceInfo, defaultServer: DEFAULT_SERVER, language: currentLanguage });

const Ctx = createContext<SessionController>(controller);

export function SessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void controller.start();
    // Coming back to the app checks the session again: a block, a sign-out elsewhere or a new configuration version
    // shows at once.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && controller.state.status !== 'signedOut' && controller.state.status !== 'mfa') void controller.reload();
    });
    return () => sub.remove();
  }, []);
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useController(): SessionController {
  return useContext(Ctx);
}

export function useSession(): SessionState {
  const c = useController();
  return useSyncExternalStore(
    (fn) => c.subscribe(fn),
    () => c.state,
  );
}

/** The signed-in state; screens under (app) only render while signed in. */
export function useSignedIn() {
  const s = useSession();
  if (s.status !== 'signedIn') throw new Error('Not signed in');
  return s;
}

export function useTheme(): Theme {
  const s = useSession();
  const system = useColorScheme() === 'dark';
  const branding = s.status === 'signedIn' ? s.config.branding : null;
  return useMemo(() => themeFor(branding, system), [branding, system]);
}

/**
 * Loads something from the API for a screen, handing blocks and sign-outs to the session so the whole app follows.
 * `reload` fetches again; `error` is the message to show.
 */
export function useApi<T>(path: string | null) {
  const c = useController();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    c.api
      .get<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => {
        if (!live || c.report(e)) return;
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Something went wrong. Try again.' }));
      });
    return () => {
      live = false;
    };
  }, [c, path, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
