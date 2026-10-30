import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

type Variant = "solid" | "ghost";

type Props = { variant?: Variant; children: ReactNode } & (
  | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
  | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
);

/** Pill button. Renders an <a> when given `href`, otherwise a <button>. */
export function Button({ variant = "solid", className = "", children, ...rest }: Props) {
  const cls = `btn btn--${variant} ${className}`.trim();
  const label = typeof children === "string" ? children : undefined;
  if (rest.href !== undefined) {
    return (
      <a className={cls} data-magnetic {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        <span data-label={label}>{children}</span>
      </a>
    );
  }
  return (
    <button type="button" className={cls} data-magnetic {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      <span data-label={label}>{children}</span>
    </button>
  );
}
