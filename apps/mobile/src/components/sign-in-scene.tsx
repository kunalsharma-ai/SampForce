import Ionicons from '@expo/vector-icons/Ionicons';
import type { MobileWorkspaceLevel } from '@dealflow/types';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { t, tMaybe } from '../lib/i18n';
import { LEVEL_LABEL } from '../lib/labels';
import { useSession } from '../lib/session';
import { plainStore } from '../lib/storage';

/*
 * The phone's sign-in scenes and welcome (ADR 0075, part 4), in SampForce red: each workspace level has its own
 * animation, greets the person and names the workspace in bold. Drawn with plain views and the built-in Animated
 * library, so they run on every phone and in the web preview. Under reduced motion everything holds still.
 */

export type SceneVariant = 'super' | 'manager' | 'executive';
export const VARIANT_OF: Record<MobileWorkspaceLevel, SceneVariant> = { SUPER: 'super', MANAGER: 'manager', EXECUTIVE: 'executive' };
const LEVEL_OF: Record<SceneVariant, MobileWorkspaceLevel> = { super: 'SUPER', manager: 'MANAGER', executive: 'EXECUTIVE' };
export const ROLE_OF: Record<SceneVariant, string> = { super: 'For owners and admins', manager: 'For team leads', executive: 'For sales executives' };
const ICON_OF: Record<SceneVariant, 'planet' | 'people' | 'rocket'> = { super: 'planet', manager: 'people', executive: 'rocket' };

export const RED = '#E02424';
export const GOLD = '#FFC857';
const INK = '#FFF5F5';
const INK_SOFT = '#FBD5D5';

// ───────────── Which scene this phone shows ─────────────

const LAST_LEVEL_KEY = 'sampforce.lastLevel';

/** The level this phone last signed in to (Executive when it never has): the sign-in page opens on its scene. */
export function useLastVariant(): SceneVariant {
  const [v, setV] = useState<SceneVariant>('executive');
  useEffect(() => {
    void plainStore
      .getItem(LAST_LEVEL_KEY)
      .then((x) => x === 'super' || x === 'manager' || x === 'executive' ? setV(x) : undefined)
      .catch(() => undefined);
  }, []);
  return v;
}

let welcomePending = false;
/** Set by the sign-in screen: the welcome shows once, right after signing in, never on a restart. */
export function markWelcome() {
  welcomePending = true;
}

export function dayPart(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** A value that runs 0 → 1 forever (or stays at `still` under reduced motion). */
function useLoop(ms: number, reduced: boolean, still = 0.35) {
  const v = useRef(new Animated.Value(still)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(still);
      return;
    }
    v.setValue(0);
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [v, ms, reduced, still]);
  return v;
}

// ───────────── The pieces ─────────────

/** The quiet red backdrop: two glows and a field of twinkling stars. */
export function SceneBackdrop({ variant }: { variant: SceneVariant }) {
  const reduced = useReducedMotion();
  const twinkle = useLoop(2600, reduced);
  const glow = { super: ['#7A0E12', '#3A0607'], manager: ['#8A1B0C', '#2E0505'], executive: ['#B3141B', '#3D0507'] }[variant];
  const stars = [
    [8, 12], [22, 30], [40, 8], [58, 22], [76, 10], [90, 28], [14, 52], [86, 48], [30, 70], [64, 64], [50, 86], [92, 80], [6, 88],
  ] as const;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#140405' }]} />
      <View style={[styles.glow, { backgroundColor: glow[0], top: -140, right: -120 }]} />
      <View style={[styles.glow, { backgroundColor: glow[1], bottom: -160, left: -140 }]} />
      {variant === 'executive' ? <View style={[styles.glow, { backgroundColor: '#FF7A1A', opacity: 0.22, bottom: -200, right: -100 }]} /> : null}
      {stars.map(([x, y], i) => (
        <Animated.View
          key={i}
          style={[
            styles.star,
            { left: `${x}%`, top: `${y}%`, opacity: twinkle.interpolate({ inputRange: [0, 0.5, 1], outputRange: i % 2 ? [0.25, 0.9, 0.25] : [0.8, 0.2, 0.8] }) },
          ]}
        />
      ))}
    </View>
  );
}

/** Super: a crowned sun with planets on a slowly turning orbit. */
function SuperStage({ reduced }: { reduced: boolean }) {
  const spin = useLoop(14000, reduced);
  const pulse = useLoop(2400, reduced, 0.5);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const back = spin.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.ring, { width: 210, height: 210, borderRadius: 105, borderStyle: 'dashed', transform: [{ rotate }] }]}>
        {[0, 120, 240].map((deg) => (
          <View key={deg} style={[styles.orbitArm, { transform: [{ rotate: `${deg}deg` }] }]}>
            <View style={[styles.planet, { backgroundColor: deg === 0 ? GOLD : deg === 120 ? '#FF6B6B' : '#FFE4E6' }]} />
          </View>
        ))}
      </Animated.View>
      <Animated.View style={[styles.ring, { width: 150, height: 150, borderRadius: 75, borderColor: 'rgba(255,200,87,0.35)', transform: [{ rotate: back }] }]} />
      <Animated.View style={[styles.halo, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.18, 1] }) }] }]} />
      <View style={[styles.core, { backgroundColor: RED }]}>
        <Ionicons aria-hidden name="diamond" size={34} color={GOLD} />
      </View>
    </View>
  );
}

/** Manager: the team around its lead, with a pulse going out to everyone. */
function ManagerStage({ reduced }: { reduced: boolean }) {
  const spin = useLoop(20000, reduced);
  const pulse = useLoop(2200, reduced, 0.4);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.wave, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }] }]} />
      <Animated.View style={{ position: 'absolute', width: 200, height: 200, transform: [{ rotate }] }}>
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <View key={deg} style={[styles.orbitArm, { width: 200, height: 200, transform: [{ rotate: `${deg}deg` }] }]}>
            <Animated.View style={[styles.member, { transform: [{ rotate: counter }, { rotate: `${-deg}deg` }] }]}>
              <Ionicons aria-hidden name="person" size={16} color={INK} />
            </Animated.View>
          </View>
        ))}
      </Animated.View>
      <View style={[styles.core, { backgroundColor: RED, borderColor: GOLD, borderWidth: 3 }]}>
        <Ionicons aria-hidden name="star" size={30} color={GOLD} />
      </View>
      <View style={styles.gauge}>
        <Text style={styles.gaugeText}>86%</Text>
      </View>
    </View>
  );
}

/** Executive: a rocket on its way up, with deals rising beside it. */
function ExecutiveStage({ reduced }: { reduced: boolean }) {
  const bob = useLoop(1800, reduced, 0.5);
  const rise = useLoop(3600, reduced, 0.5);
  const y = bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -10, 0] });
  const flame = bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1.2, 0.85] });
  const card = (offset: number) => {
    const p = Animated.modulo(Animated.add(rise, offset), 1);
    return {
      opacity: p.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [50, -60] }) }],
    };
  };
  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.deal, { left: '8%' }, card(0)]}>
        <Text style={styles.dealText}>$12,400</Text>
        <View style={[styles.dealBar, { width: 46 }]} />
      </Animated.View>
      <Animated.View style={[styles.deal, { right: '8%' }, card(0.5)]}>
        <Text style={styles.dealText}>{t('Won')}</Text>
        <View style={[styles.dealBar, { width: 30, backgroundColor: '#4ADE80' }]} />
      </Animated.View>
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY: y }] }}>
        <View style={[styles.core, { backgroundColor: RED, transform: [{ rotate: '-45deg' }] }]}>
          <Ionicons aria-hidden name="rocket" size={38} color={INK} style={{ transform: [{ rotate: '45deg' }] }} />
        </View>
        <Animated.View style={[styles.flame, { transform: [{ scaleY: flame }] }]} />
      </Animated.View>
    </View>
  );
}

export function SceneStage({ variant }: { variant: SceneVariant }) {
  const reduced = useReducedMotion();
  return (
    <View aria-hidden pointerEvents="none" testID={`scene-stage-${variant}`} style={{ alignSelf: 'stretch' }}>
      {variant === 'super' ? <SuperStage reduced={reduced} /> : variant === 'manager' ? <ManagerStage reduced={reduced} /> : <ExecutiveStage reduced={reduced} />}
    </View>
  );
}

/** "Good evening! Welcome to **Manager Workspace**": the greeting, with the workspace in bold. */
export function SceneGreeting({ variant }: { variant: SceneVariant }) {
  const name = tMaybe(LEVEL_LABEL[LEVEL_OF[variant]]);
  const [before, after = ''] = t('Welcome to {name}', { name: '\u0001' }).split('\u0001');
  return (
    <Text style={styles.greeting} testID={`scene-greeting-${variant}`}>
      <Text style={{ color: GOLD, fontWeight: '700' }}>{t(dayPart(new Date().getHours()))}! </Text>
      {before}
      <Text style={{ fontWeight: '800', color: '#FFFFFF' }}>{name}</Text>
      {after}
    </Text>
  );
}

/** The badge on the sign-in box: who it is for, the workspace in bold, and its emblem. */
export function WorkspaceBadge({ variant }: { variant: SceneVariant }) {
  return (
    <View style={styles.badge} testID={`workspace-badge-${variant}`}>
      <View style={styles.emblem}>
        <Ionicons aria-hidden name={ICON_OF[variant]} size={20} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.badgeKicker}>{t('You’re signing in to')}</Text>
        <Text style={styles.badgeName}>{tMaybe(LEVEL_LABEL[LEVEL_OF[variant]])}</Text>
        <Text style={styles.badgeRole}>{tMaybe(ROLE_OF[variant])}</Text>
      </View>
    </View>
  );
}

// ───────────── The welcome after signing in ─────────────

/**
 * Right after signing in: the level's own scene, "Welcome back, {first name}", the workspace in bold and a bar filling
 * while the home screen loads behind it; then it fades away. A tap skips it.
 */
export function WelcomeScene() {
  const s = useSession();
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const level = s.status === 'signedIn' ? s.session.level : null;

  useEffect(() => {
    if (!level) return;
    void plainStore.setItem(LAST_LEVEL_KEY, VARIANT_OF[level]).catch(() => undefined);
    if (!welcomePending) return;
    welcomePending = false;
    setOn(true);
  }, [level]);

  useEffect(() => {
    if (!on) return;
    const total = reduced ? 900 : 2800;
    fade.setValue(1);
    pop.setValue(reduced ? 1 : 0);
    bar.setValue(0);
    if (!reduced) Animated.spring(pop, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }).start();
    Animated.timing(bar, { toValue: 1, duration: total, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    const timer = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: reduced ? 1 : 500, useNativeDriver: true }).start(() => setOn(false)), total);
    return () => clearTimeout(timer);
  }, [on, reduced, fade, pop, bar]);

  if (!on || s.status !== 'signedIn') return null;
  const variant = VARIANT_OF[s.session.level];
  const first = s.session.user.name.split(/\s+/)[0] || s.session.user.name;
  const name = tMaybe(LEVEL_LABEL[s.session.level]);
  const [before, after = ''] = t('Welcome to {name}', { name: '\u0001' }).split('\u0001');
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.welcome, { opacity: fade }]} testID={`welcome-${variant}`} pointerEvents={reduced ? 'none' : 'auto'}>
      <Pressable style={styles.welcomeInner} onPress={() => Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setOn(false))} accessibilityRole="none">
        <SceneBackdrop variant={variant} />
        <SceneStage variant={variant} />
        <Animated.View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 24, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }], opacity: pop }}>
          <Text style={{ color: GOLD, fontSize: 15, fontWeight: '700' }}>{t(dayPart(new Date().getHours()))}!</Text>
          <Text accessibilityRole="alert" style={styles.welcomeName}>
            {t('Welcome back, {name}', { name: first })}
          </Text>
          <Text style={styles.welcomeLevel}>
            {before}
            <Text style={{ color: GOLD, fontWeight: '800' }}>{name}</Text>
            {after}
          </Text>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
          <Text style={styles.ready}>{t('Getting your dashboard ready…')}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** The sign-in box's answer: a green tick drawing in, or a red cross; the words are said by the screen. */
export function ResultMark({ kind }: { kind: 'success' | 'error' }) {
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (!reduced) Animated.spring(pop, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }).start();
  }, [pop, reduced]);
  const ok = kind === 'success';
  return (
    <Animated.View aria-hidden testID={ok ? 'sign-in-tick' : 'sign-in-cross'} style={[styles.result, { backgroundColor: ok ? '#16A34A' : '#DC2626', transform: [{ scale: pop }] }]}>
      <Ionicons aria-hidden name={ok ? 'checkmark' : 'close'} size={ok ? 44 : 36} color="#FFFFFF" />
    </Animated.View>
  );
}

/** The red frame around the sign-in box. */
export function CardFrame({ children }: { children: ReactNode }) {
  return <View style={styles.frame}>{children}</View>;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', width: 380, height: 380, borderRadius: 190, opacity: 0.55 },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFE4E6' },
  stage: { height: 230, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,107,107,0.55)' },
  orbitArm: { position: 'absolute', width: 210, height: 210, alignItems: 'center' },
  planet: { width: 14, height: 14, borderRadius: 7, marginTop: -7 },
  halo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(224,36,36,0.35)' },
  core: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', shadowColor: RED, shadowOpacity: 0.8, shadowRadius: 24, elevation: 10 },
  wave: { position: 'absolute', width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: GOLD },
  member: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#7F1D1D', borderWidth: 1.5, borderColor: '#FCA5A5', alignItems: 'center', justifyContent: 'center' },
  gauge: { position: 'absolute', right: '12%', top: 12, width: 56, height: 56, borderRadius: 28, borderWidth: 5, borderColor: GOLD, borderLeftColor: 'rgba(255,200,87,0.25)', alignItems: 'center', justifyContent: 'center' },
  gaugeText: { color: INK, fontWeight: '800', fontSize: 13 },
  deal: { position: 'absolute', top: 90, backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)', borderWidth: 1, borderRadius: 12, padding: 8, gap: 6 },
  dealText: { color: INK, fontWeight: '800', fontSize: 13 },
  dealBar: { height: 5, borderRadius: 3, backgroundColor: GOLD },
  flame: { width: 22, height: 36, borderRadius: 11, backgroundColor: '#FF9F1C', marginTop: -6, opacity: 0.9 },
  greeting: { color: INK_SOFT, fontSize: 16, lineHeight: 22 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(224,36,36,0.12)', borderWidth: 1, borderColor: 'rgba(224,36,36,0.45)' },
  emblem: { width: 40, height: 40, borderRadius: 12, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  badgeKicker: { color: '#FCA5A5', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  badgeName: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  badgeRole: { color: '#FECACA', fontSize: 12 },
  welcome: { zIndex: 100 },
  welcomeInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  welcomeName: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  welcomeLevel: { color: INK_SOFT, fontSize: 17, textAlign: 'center' },
  track: { width: 200, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 14, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: GOLD },
  ready: { color: '#FCA5A5', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4 },
  result: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, elevation: 8 },
  frame: { borderRadius: 24, padding: 2, backgroundColor: 'rgba(224,36,36,0.55)', shadowColor: RED, shadowOpacity: 0.6, shadowRadius: 30, elevation: 12 },
});
