import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:pointer-events-none disabled:bg-[var(--color-surface-subtle)] disabled:text-[var(--color-text-disabled)]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)]",
        primary:
          "bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)]",
        outline:
          "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]",
        secondary:
          "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]",
        ghost:
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent-active)]",
        destructive:
          "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-hover)] active:bg-[var(--color-danger-active)]",
        sidebar:
          "w-full justify-start border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-subtle)]",
      },
      size: {
        default: "min-h-11",
        sm: "min-h-11 px-3",
      },
      fullWidth: {
        true: "w-full",
        false: "",
        mobile: "w-full sm:w-auto",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      fullWidth: false,
    },
  },
);

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> &
  VariantProps<typeof buttonVariants> & {
    icon?: LucideIcon;
  };

export function Button({ variant, size, fullWidth, icon: Icon, children, ...props }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size, fullWidth })} {...props}>
      {Icon && <Icon className="mr-2 size-4" aria-hidden="true" />}
      {children}
    </button>
  );
}
