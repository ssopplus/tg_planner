interface TrackerLogoProps {
  className?: string
}

export function TrackerLogo({ className }: TrackerLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill="#FC3F1D" />
      <path
        d="M13.5 7h-2.8c-2 0-3.2 1.3-3.2 3 0 1.4.7 2.4 1.9 2.9l-2.2 4.1h1.7l2-3.8h1v3.8h1.6V7Zm-1.6 4.7H10.7c-1 0-1.6-.5-1.6-1.7s.6-1.7 1.6-1.7h1.2v3.4Z"
        fill="#fff"
      />
    </svg>
  )
}
