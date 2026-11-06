import { MotionConfig } from 'framer-motion';
import { ForceLoop } from './components/ForceLoop';
import { Hero } from './components/Hero';
import { AiSection, Everywhere, Features, FinalCta, Footer, Immersive, Nav, Pricing, Trust, Why } from './components/Sections';

/** The SampForce product page. Sections are independent; reorder or remove them here. */
export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />
        <ForceLoop />
        <Features />
        <AiSection />
        <Immersive />
        <Why />
        <Everywhere />
        <Trust />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </MotionConfig>
  );
}
