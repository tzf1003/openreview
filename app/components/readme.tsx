"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ThemeSettings } from "@xsec/design-tokens";
import { ControlThemeProvider } from "@xsec/ui-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Streamdown } from "streamdown";

import { markdownComponents } from "./markdown-components";

import "streamdown/styles.css";

const plugins = { cjk, code, math, mermaid };
const controls = { mermaid: { copy: false, fullscreen: false } };
const linkSafety = { enabled: false };
const colorQuery = "(prefers-color-scheme: dark)";
const motionQuery = "(prefers-reduced-motion: reduce)";

const subscribe = (notify: () => void) => {
  const queries = [matchMedia(colorQuery), matchMedia(motionQuery)];
  for (const query of queries) {
    query.addEventListener("change", notify);
  }
  return () => {
    for (const query of queries) {
      query.removeEventListener("change", notify);
    }
  };
};

const snapshot = () =>
  Number(matchMedia(colorQuery).matches) +
  2 * Number(matchMedia(motionQuery).matches);

const serverSnapshot = () => 0;

const subscribeToHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};
const hashSnapshot = () => location.hash.slice(1);
const serverHashSnapshot = () => "";

export const Readme = ({ content }: { content: string }) => {
  const preferences = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const colorMode = preferences % 2 ? "dark" : "light";
  const sectionId = useSyncExternalStore(
    subscribeToHash,
    hashSnapshot,
    serverHashSnapshot
  );
  const settings = useMemo<ThemeSettings>(
    () => ({
      colorMode,
      density: "comfortable",
      fontScale: 1,
      locale: "en",
      reducedMotion: preferences >= 2,
    }),
    [colorMode, preferences]
  );
  const article = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (!article.current) {
      throw new Error("Documentation article is unavailable");
    }
    setHeadings(
      [...article.current.querySelectorAll("h2")].map((heading) => ({
        id: heading.id,
        title: heading.textContent,
      }))
    );
  }, [content]);

  return (
    <ControlThemeProvider className="reading-shell" settings={settings}>
      <a className="reading-skip" href="#documentation">
        Skip to documentation
      </a>
      <div className="reading-layout">
        <aside className="reading-sidebar">
          <nav aria-label="On this page">
            <p className="reading-nav-title">On this page</p>
            {headings.map(({ id, title }) => (
              <a
                aria-current={id === sectionId ? "location" : undefined}
                href={`#${id}`}
                key={id}
              >
                {title}
              </a>
            ))}
          </nav>
        </aside>
        <main id="documentation" tabIndex={-1}>
          <div ref={article}>
            <Streamdown
              className="readme"
              components={markdownComponents}
              controls={controls}
              linkSafety={linkSafety}
              mode="static"
              plugins={plugins}
            >
              {content}
            </Streamdown>
          </div>
        </main>
      </div>
    </ControlThemeProvider>
  );
};
