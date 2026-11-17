export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    diagonal: "M6 18 18 6M6 6h12v12", plus: "M12 5v14M5 12h14", arrow: "M12 19V5m-6 6 6-6 6 6", chevron: "m9 5 7 7-7 7",
    film: "M3 4h18v16H3ZM7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4",
    folder: "M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z",
    edit: "m14 5 5 5M4 20l5-1L21 7l-5-5L4 14ZM14 20h7",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 3v4m-2-2h4",
    compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-5-4-2.5 5.5L8 16l2.5-5.5Z",
    menu: "M4 6h16M4 12h16M4 18h16", close: "m6 6 12 12M6 18 18 6", check: "m5 12 4 4L19 6",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.film} /></svg>;
}

