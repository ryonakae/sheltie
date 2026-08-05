import type { SVGProps } from 'react';

export function NodeTabletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      fill="none"
      viewBox="0 0 16 16"
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.5 1h-7A2.5 2.5 0 0 0 2 3.5v9A2.5 2.5 0 0 0 4.5 15h7a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 11.5 1Zm-7 1.5h7c.552 0 1 .448 1 1v9c0 .552-.448 1-1 1h-7c-.552 0-1-.448-1-1v-9c0-.552.448-1 1-1Zm2.75 10a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
