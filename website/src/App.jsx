import { MotionConfig } from 'framer-motion';
import { Nav } from './sections/Nav.jsx';
import { Hero } from './sections/Hero.jsx';
import { Marquee } from './sections/Marquee.jsx';
import { Journey } from './sections/Journey.jsx';
import { Features } from './sections/Features.jsx';
import { Agents } from './sections/Agents.jsx';
import { Immersive } from './sections/Immersive.jsx';
import { Difference } from './sections/Difference.jsx';
import { Tour } from './sections/Tour.jsx';
import { Anywhere } from './sections/Anywhere.jsx';
import { Numbers, Pricing, Trust, FinalCta, Footer } from './sections/Closing.jsx';

// Section order. Remove or reorder a line to change the page.
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#journey">
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Journey />
        <Features />
        <Agents />
        <Immersive />
        <Difference />
        <Tour />
        <Anywhere />
        <Numbers />
        <Pricing />
        <Trust />
        <FinalCta />
      </main>
      <Footer />
    </MotionConfig>
  );
}
