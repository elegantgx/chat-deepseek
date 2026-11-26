import type { ReactNode, SVGProps } from 'react'

/**
 * 内联 SVG 图标：统一 24 网格、1.5 描边、round cap。
 * 不引第三方图标库；颜色一律 currentColor，尺寸默认 24，组件里按需覆盖。
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function IconBase({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function ServerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.4" width="17" height="6.2" rx="1.8" />
      <rect x="3.5" y="13.4" width="17" height="6.2" rx="1.8" />
      <path d="M7.2 7.5h.01M7.2 16.5h.01" />
    </IconBase>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.8 19.2c0-2.8 2.3-4.7 5.2-4.7s5.2 1.9 5.2 4.7" />
      <path d="M15.9 5.7a3 3 0 0 1 0 5.6" />
      <path d="M17.4 15c1.9.5 3 1.9 3 4.2" />
    </IconBase>
  )
}

export function ArchiveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4.2" width="18" height="4.6" rx="1.4" />
      <path d="M4.9 8.8V19a1.6 1.6 0 0 0 1.6 1.6h11a1.6 1.6 0 0 0 1.6-1.6V8.8" />
      <path d="M10 12.6h4" />
    </IconBase>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7.6h9.4M18.6 7.6H20M4 16.4h3.4M12.6 16.4H20" />
      <circle cx="16" cy="7.6" r="2.2" />
      <circle cx="10" cy="16.4" r="2.2" />
    </IconBase>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.4 12.2l2.4 2.4 4.8-5" />
    </IconBase>
  )
}

export function XCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </IconBase>
  )
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4.6 21 19.4H3L12 4.6Z" />
      <path d="M12 9.6v4.1M12 16.7h.01" />
    </IconBase>
  )
}

export function DatabaseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
      <path d="M4.5 6.5v11c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-11" />
      <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
    </IconBase>
  )
}

export function InboxIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 13.6 6.3 5.8h11.4L20 13.6v4.1a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7Z" />
      <path d="M4 13.6h4.1l1.2 2h5.4l1.2-2H20" />
    </IconBase>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9.5 6.5 15 12l-5.5 5.5" />
    </IconBase>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </IconBase>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </IconBase>
  )
}

/** 重启：环形箭头，缺口在右上 */
export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8" />
      <path d="M20.4 4.6v5.2h-5.2" />
    </IconBase>
  )
}

/** 启停：电源符号，竖线 + 开口弧 */
export function PowerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4.2v7.1" />
      <path d="M7.7 6.8a7.4 7.4 0 1 0 8.6 0" />
    </IconBase>
  )
}

/** 下载 / 写入：向下箭头落在底座上，用于「立即备份」 */
export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4.4v10.4" />
      <path d="M8 11.2l4 4 4-4" />
      <path d="M5 19.6h14" />
    </IconBase>
  )
}
