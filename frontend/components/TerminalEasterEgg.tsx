"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import "./terminal-easter-egg.css";

export type EasterEggMode = "market" | "gme";
const DURATION = 11200;
const ASSETS = "/easter-eggs/";

function SqueezeChart() {
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const ship = useRef<SVGGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = svg.current;
    const path = line.current;
    if (!root || !path) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let length = 1;
    const resize = () => {
      const width = Math.max(360, root.clientWidth);
      const height = Math.max(320, root.clientHeight);
      root.setAttribute("viewBox", `0 0 ${width} ${height}`);
      // A single coordinate system drives both the price trace and its rocket.
      const points = [[.08,.86],[.13,.86],[.16,.85],[.19,.87],[.23,.84],[.27,.85],[.30,.82],[.33,.85],[.36,.81],[.39,.82],[.42,.77],[.45,.79],[.48,.70],[.50,.74],[.53,.63],[.55,.66],[.58,.48],[.60,.55],[.63,.38],[.65,.42],[.68,.21],[.69,.28],[.72,.10],[.75,-.03],[.78,-.25]];
      const d = points.map(([x,y], index) => `${index ? "L" : "M"}${x * width},${y * height}`).join(" ");
      path.setAttribute("d", d);
      glow.current?.setAttribute("d", d);
      length = path.getTotalLength();
      for (const item of [path, glow.current]) {
        item?.setAttribute("stroke-dasharray", String(length));
        item?.setAttribute("stroke-dashoffset", String(length));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    const start = performance.now();
    const tick = (now: number) => {
      const seconds = (now - start) / 1000;
      const progress = reduced ? .82 : seconds < 1 ? 0 : seconds < 3.6 ? (seconds - 1) / 2.6 * .28 : Math.min(1, .28 + Math.pow((seconds - 3.6) / 4.2, 1.35) * .72);
      const distance = length * progress;
      for (const item of [path, glow.current]) item?.setAttribute("stroke-dashoffset", String(length - distance));
      const point = path.getPointAtLength(distance);
      const ahead = path.getPointAtLength(Math.min(length, distance + 4));
      const behind = path.getPointAtLength(Math.max(0, distance - 4));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI + 45;
      ship.current?.setAttribute("transform", `translate(${point.x} ${point.y}) rotate(${angle})`);
      ship.current?.setAttribute("opacity", !reduced && seconds > 3.6 && seconds < 8 ? "1" : "0");
      dot.current?.setAttribute("cx", String(point.x));
      dot.current?.setAttribute("cy", String(point.y));
      dot.current?.setAttribute("opacity", seconds > 3.6 || reduced ? "0" : "1");
      if (stage.current) stage.current.dataset.phase = reduced || seconds > 7.7 ? "moon" : seconds > 3.6 ? "launch" : "trading";
      if (!reduced) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  return <div className="ee-squeeze" ref={stage} data-phase="trading">
    <div className="ee-gme-heading"><span>GAMESTOP / JANUARY 2021</span><h2>One small trade.<br /><em>One giant leap.</em></h2></div>
    <img className="ee-moon" src={`${ASSETS}moon.svg`} alt="" />
    <div className="ee-chart">
      <div className="ee-chart-grid">{["1,500%", "1,000%", "500%", "0%"].map(label => <div key={label}><span>{label}</span></div>)}</div>
      <svg ref={svg} className="ee-price-svg" aria-hidden="true">
        <path ref={glow} className="ee-price-glow" />
        <path ref={line} className="ee-price-path" />
        <circle ref={dot} r="5" className="ee-price-dot" />
        <g ref={ship} opacity="0"><image href={`${ASSETS}rocket.svg`} x="-37" y="-37" width="74" height="74" /></g>
      </svg>
      <div className="ee-chart-dates"><span>JAN 04</span><span>JAN 13</span><span>JAN 22</span><span>JAN 28</span></div>
    </div>
    <div className="ee-flight-status"><span className="ee-status-trading">$GME · ALL QUIET</span><span className="ee-status-launch">$GME · WE HAVE LIFTOFF</span><span className="ee-status-moon">$GME · ORBIT ACHIEVED</span></div>
    <div className="ee-moon-finale"><span>THE SHORT SQUEEZE</span><strong>TO THE<br /><em>MOON.</em></strong></div>
    <small className="ee-remix">A 2021 tribute. Stylized chart.</small>
  </div>;
}

function MarketParty() {
  return <div className="ee-party">
    <div className="ee-beams"><i /><i /><i /></div>
    <div className="ee-party-orbits"><i /><i /><i /></div>
    <div className="ee-party-heading"><span>APLEXANALYSIS / AFTER HOURS</span><h2>MARKET<br /><em>PARTY.</em></h2><p>For once, everybody wins.</p></div>
    <div className="ee-mascots">
      <div className="ee-mascot ee-mascot-bull"><div><img src={`${ASSETS}bull.svg`} alt="" /></div><span>BULLS</span></div>
      <div className="ee-mascot ee-mascot-bear"><div><img src={`${ASSETS}bear.svg`} alt="" /></div><span>BEARS</span></div>
    </div>
    <div className="ee-confetti" aria-hidden="true">{Array.from({ length: 72 }, (_, i) => <i key={i} style={{"--x": `${(i * 47 % 100)}vw`, "--drift": `${(i * 17 % 160) - 80}px`, "--delay": `${(i % 18) * -.27}s`, "--turn": `${i % 2 ? 620 : -480}deg`, "--color": ["#49f3bc", "#ff797d", "#f6d875", "#b5b6ff"][i % 4]} as CSSProperties} />)}</div>
    <div className="ee-party-ticker"><span>{"BULLS 🤝 BEARS     EVERYBODY'S UP     AFTER HOURS     ".repeat(6)}</span></div>
  </div>;
}

export function TerminalEasterEgg({ mode, onDone }: { mode: EasterEggMode; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timeout = window.setTimeout(onDone, DURATION);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    root.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
      if (event.key === "Tab") { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    window.addEventListener("keydown", dismiss);
    return () => { window.clearTimeout(timeout); window.removeEventListener("keydown", dismiss); document.documentElement.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [onDone]);
  return <div ref={root} tabIndex={-1} className={`ee-overlay ee-overlay--${mode}`} role="dialog" aria-modal="true" aria-label={mode === "gme" ? "GameStop rocket launch" : "Bulls and bears market party"}>
    <div className="ee-stars" aria-hidden="true" />
    {mode === "gme" ? <SqueezeChart /> : <MarketParty />}
    <button className="ee-close" onClick={onDone} aria-label="Close animation">Close <span>×</span></button>
    <span className="ee-sr-only" role="status">{mode === "gme" ? "GameStop takes off. To the moon!" : "The market is closed. The bull and bear are celebrating together."}</span>
  </div>;
}
