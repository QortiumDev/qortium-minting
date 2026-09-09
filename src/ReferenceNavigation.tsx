import { useEffect, type MouseEvent } from 'react';

export const REFERENCE_SECTIONS = [
  ['reference-contract', 'Contract'],
  ['reference-reads', 'Read API'],
  ['reference-results', 'Results'],
  ['reference-bridge', 'Home bridge and examples'],
] as const;

type SectionId = typeof REFERENCE_SECTIONS[number][0];

export function referenceSectionUrl(input: string, id: SectionId) {
  const url = new URL(input, 'http://localhost');
  url.hash = id;
  return `${url.pathname}${url.search}${url.hash}`;
}

function scrollSection() {
  const id = window.location.hash.slice(1);
  if (!REFERENCE_SECTIONS.some(([section]) => section === id)) return;
  const section = document.getElementById(id);
  const container = section?.closest<HTMLElement>('.reference-scroll');
  if (section && container) {
    // Never scroll Home's outer Android document via scrollIntoView.
    container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top;
    section.focus({ preventScroll: true });
  }
}

export function ReferenceNavigation() {
  useEffect(() => {
    scrollSection();
    window.addEventListener('popstate', scrollSection);
    window.addEventListener('hashchange', scrollSection);
    return () => {
      window.removeEventListener('popstate', scrollSection);
      window.removeEventListener('hashchange', scrollSection);
    };
  }, []);

  function visit(event: MouseEvent<HTMLAnchorElement>, id: SectionId) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = referenceSectionUrl(window.location.href, id);
    if (window.location.hash !== `#${id}`) window.history.pushState(window.history.state, '', next);
    scrollSection();
  }

  return <nav aria-label="Developer reference sections" className="reference-toc">
    {REFERENCE_SECTIONS.map(([id, label]) => <a key={id}
      href={referenceSectionUrl(typeof window === 'undefined' ? '/?view=developers' : window.location.href, id)}
      onClick={event => visit(event, id)}>{label}</a>)}
  </nav>;
}
