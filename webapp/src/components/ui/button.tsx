import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-amber-900 px-4 py-2 text-white hover:bg-amber-950",
        outline: "border border-stone-300 bg-white px-4 py-2 text-stone-800 hover:bg-stone-100",
        sidebar:
          "w-full justify-start border border-stone-300 bg-white px-4 py-2 text-stone-800 hover:bg-stone-100",
      },
      size: {
        default: "min-h-10",
        sm: "min-h-9 px-3",
      },
      fullWidth: {
        true: "w-full",
        false: "",
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
