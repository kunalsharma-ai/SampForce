// Small inline icon set (24x24, stroke based) so the page needs no icon library.
const PATHS = {
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 3v4 M17 5h4',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  play: 'M7 4.5v15l13-7.5z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z M9 12l2 2 4-4',
  lock: 'M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z M13.5 12.5L21 20 M18 17l2-2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7 M16 3.5a4 4 0 0 1 0 7.5 M22 21c0-3-1.8-5.6-4.5-6.6',
  log: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  chevronL: 'M15 6l-6 6 6 6',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  flip: 'M4 12a8 8 0 0 1 13.7-5.7L20 8.5 M20 4v4.5h-4.5 M20 12a8 8 0 0 1-13.7 5.7L4 15.5 M4 20v-4.5h4.5',
  bot: 'M6 9h12v10H6z M12 5v4 M9 14h.01 M15 14h.01 M10 5h4',
  switch: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7z M7 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  coins: 'M8 9c3.3 0 6-1.1 6-2.5S11.3 4 8 4 2 5.1 2 6.5 4.7 9 8 9z M2 6.5v4C2 11.9 4.7 13 8 13s6-1.1 6-2.5v-4 M10 14.8c.6.1 1.3.2 2 .2 3.3 0 6-1.1 6-2.5v-4 M14 10.3c2.3.3 4 1.1 4 2.2 M22 12.5v4c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5v-1',
  wand: 'M15 4V2 M15 10V8 M11 6h2 M17 6h2 M3 21l12-12',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.4.5.5 1.1.2 1.6-.5.8-1.6 1.1-2.7 1.1z M7.5 11h.01 M10 7h.01 M14.5 7h.01',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 3v18 M12 7h4 M12 11h6 M12 15h5',
};

export function Icon({ name, size = 20, className, strokeWidth = 1.8 }) {
  const d = PATHS[name] ?? PATHS.spark;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i ? `M${seg}` : seg} />)}
    </svg>
  );
}
