import clsx, { type ClassValue } from "clsx";

/**
 * Class name helper used by every component in the app.
 * `cn("p-2", isActive && "bg-brand", className)`
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export type { ClassValue };
