import { capabilities } from "../data/content";
import { Button } from "./Button";
import { CardDeck } from "./CardDeck";
import "./Platform.css";

export function Platform({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section id="platform" className="section platform">
      <div className="wrap platform__grid">
        <div className="platform__copy">
          <p className="label reveal">
            <span className="label__num">03</span> — Platform
          </p>
          <h2 className="display h2 reveal reveal--wipe">
            Six layers. Flip one to see the <span className="accent">next.</span>
          </h2>
          <p className="lede reveal">
            SpotSure is built as a stack: hardware and vision feed an occupancy engine, a planned trust graph will flag
            suspicious links behind listings and bookings, and the marketplace sits on top. Each sleeve says plainly whether that
            layer is in development or still planned.
          </p>
          <div className="platform__actions reveal">
            <Button href="#pipeline">See the pipeline</Button>
            <Button href="#roadmap" variant="ghost">
              Read the roadmap
            </Button>
          </div>
        </div>
        <div className="platform__deck reveal">
          <CardDeck cards={capabilities} reducedMotion={reducedMotion} />
        </div>
      </div>
    </section>
  );
}
