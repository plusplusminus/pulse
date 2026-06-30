// Linear's logo mark, rendered in currentColor so it inherits the surrounding
// button's muted/hover treatment like the lucide icons beside it. Used for the
// admin-only "View in Linear" affordance (PULSE-372).
export function LinearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" className={className} aria-hidden="true">
      <path d="M1.225 61.523c-.222-.949.908-1.546 1.597-.857l36.512 36.512c.69.69.092 1.819-.857 1.597C20.522 94.585 5.415 79.478 1.225 61.523ZM.002 46.889a.99.99 0 0 0 .29.76L52.35 99.71c.201.2.476.302.76.29 2.37-.097 4.7-.398 6.965-.886.764-.165 1.027-1.108.475-1.66L2.551 39.45c-.552-.553-1.495-.29-1.66.474A49.674 49.674 0 0 0 .002 46.89ZM4.4 31.96a.998.998 0 0 0 .218 1.083l62.339 62.339a.998.998 0 0 0 1.082.218 49.989 49.989 0 0 0 5.06-2.396.999.999 0 0 0 .238-1.591L8.387 26.662a.999.999 0 0 0-1.591.238A49.99 49.99 0 0 0 4.4 31.96ZM12.07 20.486a.998.998 0 0 1-.084-1.317C21.151 7.503 35.182 0 50.973 0 78.115 0 100.1 21.985 100.1 49.127c0 15.791-7.503 29.822-19.169 38.987a.998.998 0 0 1-1.317-.084L12.07 20.486Z" />
    </svg>
  );
}
