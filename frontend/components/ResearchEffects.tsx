"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";

export function ResearchComposerGlow({ busy, children, frame = false }: { busy: boolean; children: ReactNode; frame?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const shell = host.current?.closest("[data-theme]");
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setMotion(!preference.matches);
      setTheme(shell?.getAttribute("data-theme") === "light" ? "light" : shell?.getAttribute("data-theme") === "dark" ? "dark" : systemTheme.matches ? "dark" : "light");
    };
    update();
    const observer = new MutationObserver(update);
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["data-theme"] });
    preference.addEventListener("change", update);
    systemTheme.addEventListener("change", update);
    return () => { observer.disconnect(); preference.removeEventListener("change", update); systemTheme.removeEventListener("change", update); };
  }, []);
  return <div ref={host} className={`research-glow-host${frame ? " research-frame-host" : ""}`}><BorderBeam className={frame ? "research-window-beam" : "research-composer-beam"} size={frame ? "pulse-inner" : "md"} colorVariant="colorful" theme={theme} active={motion} strength={frame ? (busy ? 0.75 : 0.55) : (busy ? 0.95 : 0.75)} duration={frame ? 4 : busy ? 3.5 : 6} saturation={0.8} brightness={1.1} staticColors borderRadius={frame ? 24 : 20}>{children}</BorderBeam></div>;
}

export function ResearchWelcomeOrb() {
  return <div className="research-welcome-orb" aria-hidden="true"><ThinkingOrb state="breathing" size={64} theme="auto" speed={0.55} /></div>;
}

export function ResearchThinking() {
  return <div className="research-thinking" role="status"><ThinkingOrb state="working" size={20} theme="auto" speed={0.8} aria-hidden="true" /><span>Thinking...</span></div>;
}
