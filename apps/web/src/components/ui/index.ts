/**
 * UI primitives for toon-recipe. Tailwind v4 only, no component library.
 * Import from here: `import { Button, Card, useToast } from "@/components/ui";`
 *
 * Conventions every primitive follows:
 *  - touch targets are at least 44px (`sm` sizes are for dense desktop toolbars),
 *  - no hover-only affordances, focus-visible rings everywhere,
 *  - colours come from the semantic tokens in styles/theme.css (dark mode is automatic),
 *  - copy goes through the i18n catalogs, `error` props take a ready-to-render message,
 *  - type comes from the scale in styles/index.css — `text-control`/`text-item`/
 *    `text-display-*` and the `.eyebrow` utility, never an arbitrary `text-[13px]`.
 */
export { ActionMenu, type ActionMenuItem, type ActionMenuProps } from "./ActionMenu";
export { Avatar, type AvatarProps } from "./Avatar";
export { Badge, type BadgeProps, type BadgeSize, type BadgeVariant } from "./Badge";
export {
  Button,
  buttonClasses,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";
export { Card, CardHeader, type CardProps } from "./Card";
export { Chip, type ChipProps, type ChipSize } from "./Chip";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Dialog, type DialogProps } from "./Dialog";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ErrorState, type ErrorStateProps } from "./ErrorState";
export { Field, type FieldProps } from "./Field";
export { IconButton, type IconButtonProps, type IconButtonSize, type IconButtonVariant } from "./IconButton";
export { Input, PasswordInput, controlClasses, type InputProps, type PasswordInputProps } from "./Input";
export { Label, type LabelProps } from "./Label";
export { ProgressBar, type ProgressBarProps, type ProgressBarSize, type ProgressBarTone } from "./ProgressBar";
export { SectionHeader, type SectionHeaderProps, type SectionHeaderTone } from "./SectionHeader";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { Skeleton, SkeletonList, type SkeletonProps } from "./Skeleton";
export { FullPageLoader, LoadingBlock, Spinner, type SpinnerProps } from "./Spinner";
export { Stat, StatRow, type StatProps, type StatRowProps, type StatSize, type StatTone } from "./Stat";
export { Stepper, type StepperProps, type StepperSize } from "./Stepper";
export { Switch, type SwitchProps } from "./Switch";
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
export { Textarea, type TextareaProps } from "./Textarea";
export {
  ToastProvider,
  useToast,
  type ToastAction,
  type ToastApi,
  type ToastOptions,
  type ToastVariant,
} from "./Toast";
