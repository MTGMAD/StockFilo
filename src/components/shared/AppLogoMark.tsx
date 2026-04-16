import { cn } from "../../lib/utils";

interface AppLogoMarkProps {
  className?: string;
}

export function AppLogoMark({ className }: AppLogoMarkProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-[0.7rem] bg-linear-to-br from-violet-600 to-indigo-950 shadow-sm ring-1 ring-black/8",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 46C11 42 17 43 24 39C31 35 36 32 43 28C50 24 55 21 60 17" stroke="rgba(255,255,255,0.34)" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="59" cy="18" r="2.4" fill="rgba(255,255,255,0.24)" />
        <circle cx="59" cy="18" r="1.1" fill="white" />
        <path d="M4 46C11 42 17 43 24 39C31 35 36 32 43 28C50 24 55 21 60 17V64H4V46Z" fill="url(#app-logo-fill)" opacity="0.16" />
        <text x="32" y="39" textAnchor="middle" fontSize="27" fontWeight="900" letterSpacing="-1.6" fill="white" fontFamily="Arial, Helvetica, sans-serif">SF</text>
        <defs>
          <linearGradient id="app-logo-fill" x1="32" y1="18" x2="32" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0.15" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}