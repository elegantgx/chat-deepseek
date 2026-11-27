import type { ReactNode, SVGProps } from 'react'

/**
 * mockup 里用到的全部 SVG symbol（`docs/android/mockups/screens/*.html` 的 `<defs>`）
 * 加品牌鲸鱼。几何逐字搬自示意：viewBox、线宽、圆角、填充都写在内层图形上，
 * 外层只负责尺寸与 currentColor，所以同一个图标在 22 的列表行和 16 的提示条里是同一份画。
 *
 * 示意里地球和用户各有两个变体（列表用描边 24 格、聊天 chip 用实心 14/16 格），
 * 不是笔误：两种场景线宽观感不同，两个都收，调用方按场景选。
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** 同时覆盖宽高；非正方形的状态栏图标用 width/height 单独给 */
  size?: number
  width?: number
  height?: number
}

type IconName = keyof typeof ICONS

interface IconDef {
  viewBox: string
  width: number
  height: number
  body: ReactNode
}

const ICONS = {
  archive: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <rect x="3.1" y="3.6" width="17.8" height="4.6" rx="1.6" />{' '}
          <path d="M4.6 8.2v10.6a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6V8.2" />{' '}
          <path d="M9.6 12.4h4.8" />{' '}
        </g>
      </>
    ),
  },
  back: {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    body: (
      <>
        <path
          d="M14.8 5.6 9.2 12l5.6 6.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  battery: {
    viewBox: '0 0 26 12',
    width: 26,
    height: 12,
    body: (
      <>
        <rect
          x="0.7"
          y="1.2"
          width="22"
          height="9.6"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.45"
        />{' '}
        <rect x="2.6" y="3.1" width="16.2" height="5.8" rx="1.8" fill="currentColor" />{' '}
        <path
          d="M24.4 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8z"
          fill="currentColor"
          opacity="0.45"
        />
      </>
    ),
  },
  camera: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M4.6 8.4h3l1.4-2.1h6l1.4 2.1h3a1.6 1.6 0 0 1 1.6 1.6v7.4a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 17.4v-7.4a1.6 1.6 0 0 1 1.6-1.6z" />{' '}
          <circle cx="12" cy="13.1" r="3.2" />{' '}
        </g>
      </>
    ),
  },
  chat: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M4.6 5.4h14.8a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8h-9.4l-4.4 3v-3h-1a1.8 1.8 0 0 1-1.8-1.8v-8a1.8 1.8 0 0 1 1.8-1.8z" />{' '}
          <path d="M7.6 10.2h8.8M7.6 13.2h5.6" />{' '}
        </g>
      </>
    ),
  },
  check: {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    body: (
      <>
        <path
          d="M5.2 12.7 9.9 17.4 18.8 6.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  chevronRight: {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    body: (
      <>
        <path
          d="M9.6 5.8 15.9 12l-6.3 6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  clip: {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    body: (
      <>
        <path
          d="M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z"
          fill="currentColor"
        />
      </>
    ),
  },
  data: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <ellipse cx="12" cy="6.4" rx="7.4" ry="3.1" />{' '}
          <path d="M4.6 6.4v11.2c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1V6.4" />{' '}
          <path d="M4.6 12c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1" />{' '}
        </g>
      </>
    ),
  },
  doc: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          {' '}
          <path d="M6 3.2h7.4L18 7.8v13H6z" /> <path
            d="M13.2 3.5v4.5h4.6"
            strokeLinecap="round"
          />{' '}
          <path d="M9 12.4h6M9 15.6h6" strokeLinecap="round" />{' '}
        </g>
      </>
    ),
  },
  export: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M12 3.6v9.8" /> <path d="M8.4 7.2 12 3.6l3.6 3.6" />{' '}
          <path d="M4.6 14.6v3.8a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-3.8" />{' '}
        </g>
      </>
    ),
  },
  file: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M6.2 3.4h7.4l4.2 4.2v13H6.2z" /> <path d="M13.4 3.6v4.2h4.2" />{' '}
        </g>
      </>
    ),
  },
  globe: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9">
          {' '}
          <circle cx="12" cy="12" r="8.7" />{' '}
          <path d="M3.4 12h17.2M12 3.3c2.5 2.4 3.8 5.4 3.8 8.7s-1.3 6.3-3.8 8.7c-2.5-2.4-3.8-5.4-3.8-8.7s1.3-6.3 3.8-8.7z" />{' '}
        </g>
      </>
    ),
  },
  globeFilled: {
    viewBox: '0 0 14 14',
    width: 14,
    height: 14,
    body: (
      <>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7 0.150391C10.7832 0.150391 13.8496 3.21685 13.8496 7C13.8496 10.7832 10.7832 13.8496 7 13.8496C3.21685 13.8496 0.150391 10.7832 0.150391 7C0.150391 3.21685 3.21685 0.150391 7 0.150391ZM5.37793 7.59961C5.42667 9.03204 5.64751 10.2965 5.97363 11.2197C6.15993 11.7471 6.36943 12.1301 6.57324 12.3701C6.77748 12.6105 6.9234 12.6504 7 12.6504C7.0766 12.6504 7.22252 12.6105 7.42676 12.3701C7.63057 12.1301 7.84007 11.7471 8.02637 11.2197C8.35249 10.2965 8.57333 9.03204 8.62207 7.59961H5.37793ZM1.38184 7.59961C1.61453 9.80492 3.1159 11.6304 5.14258 12.3359C5.03265 12.1128 4.93224 11.8724 4.84277 11.6191C4.46339 10.5451 4.22772 9.13988 4.17871 7.59961H1.38184ZM9.82129 7.59961C9.77228 9.13988 9.53661 10.5451 9.15723 11.6191C9.06771 11.8726 8.96645 12.1127 8.85645 12.3359C10.8836 11.6307 12.3854 9.80524 12.6182 7.59961H9.82129ZM7 1.34961C6.9234 1.34961 6.77748 1.38949 6.57324 1.62988C6.36943 1.86988 6.15993 2.25291 5.97363 2.78027C5.64751 3.70351 5.42667 4.96796 5.37793 6.40039H8.62207C8.57333 4.96796 8.35249 3.70351 8.02637 2.78027C7.84007 2.25291 7.63057 1.86988 7.42676 1.62988C7.22252 1.38949 7.0766 1.34961 7 1.34961ZM8.85645 1.66309C8.9666 1.88656 9.0676 2.12715 9.15723 2.38086C9.53661 3.45487 9.77228 4.86012 9.82129 6.40039H12.6182C12.3854 4.19465 10.8837 2.36828 8.85645 1.66309ZM5.14258 1.66309C3.11575 2.3685 1.61454 4.19497 1.38184 6.40039H4.17871C4.22772 4.86012 4.46339 3.45487 4.84277 2.38086C4.93234 2.1273 5.03249 1.88645 5.14258 1.66309Z"
          fill="currentColor"
        />
      </>
    ),
  },
  import: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M12 3.6v9.8" /> <path d="M8.4 9.8 12 13.4l3.6-3.6" />{' '}
          <path d="M4.6 14.6v3.8a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-3.8" />{' '}
        </g>
      </>
    ),
  },
  info: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <circle cx="12" cy="12" r="8.7" /> <path d="M12 10.7v5.4" />{' '}
          <circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" />{' '}
        </g>
      </>
    ),
  },
  key: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <circle cx="8.2" cy="12" r="3.8" /> <path d="M12 12h8.2" />{' '}
          <path d="M16.9 12v3.1M19.7 12v2.2" />{' '}
        </g>
      </>
    ),
  },
  logout: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M14.5 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20h8.7" />{' '}
          <path d="M12.5 12H21M17.5 8.5 21 12l-3.5 3.5" />{' '}
        </g>
      </>
    ),
  },
  menu: {
    viewBox: '0 0 20 20',
    width: 22,
    height: 22,
    body: (
      <>
        <path d="M17.2027 4.90034V6.43655H2.79724V4.90034H17.2027Z" fill="currentColor" />{' '}
        <path d="M10.9603 13.0634V14.5996H2.79724V13.0634H10.9603Z" fill="currentColor" />
      </>
    ),
  },
  mic: {
    viewBox: '-1.4937 -0.4304 16 16',
    width: 16,
    height: 16,
    body: (
      <>
        <path
          d="M13.1392 8.4347A6.8543 6.8543 0 0 1 0.0021 8.4347L1.3765 8.1186A5.4476 5.4476 0 0 0 11.7648 8.1186ZM10.243 6.9412C10.243 8.9694 8.5987 10.6137 6.5705 10.6137C4.5422 10.6137 2.8979 8.9694 2.8979 6.9412L2.8979 3.6725C2.8979 1.6443 4.5422 0 6.5705 0C8.5987 0 10.243 1.6443 10.243 3.6725ZM8.8364 3.6726C8.8364 2.4211 7.8219 1.4066 6.5705 1.4066C5.319 1.4066 4.3045 2.4211 4.3045 3.6726L4.3045 6.9411C4.3045 8.1925 5.319 9.207 6.5705 9.207C7.8219 9.207 8.8364 8.1925 8.8364 6.9411ZM5.8675 12.7393H7.2741V15.6391H5.8675Z"
          fill="currentColor"
        />
      </>
    ),
  },
  more: {
    viewBox: '0 0 16 16',
    width: 18,
    height: 18,
    body: (
      <>
        <path
          d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z"
          fill="currentColor"
        />{' '}
        <path
          d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z"
          fill="currentColor"
        />{' '}
        <path
          d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z"
          fill="currentColor"
        />
      </>
    ),
  },
  mute: {
    viewBox: '0 0 24 24',
    width: 24,
    height: 24,
    body: (
      <>
        <path
          d="M3 9.2h3.5L11 5v14l-4.5-4.2H3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />{' '}
        <path
          d="M14.8 9.5 20 14.7M20 9.5 14.8 14.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
  newChat: {
    viewBox: '0 0 20 20',
    width: 20,
    height: 20,
    body: (
      <>
        <path
          d="M9.99994 1.22943C5.15598 1.22943 1.22937 5.15604 1.22937 10C1.22937 11.3437 1.5319 12.6189 2.07359 13.7592L2.40673 14.4596L3.8065 13.7942L3.4743 13.0939L3.31625 12.7371C2.97051 11.8938 2.77962 10.97 2.77962 10C2.77962 6.01243 6.01237 2.77968 9.99994 2.77968C13.9875 2.77968 17.2203 6.01243 17.2203 10C17.2203 13.9876 13.9875 17.2203 9.99994 17.2203C9.18334 17.2203 8.5858 17.1622 8.05597 17.0159C7.53397 16.8717 7.03885 16.6305 6.44609 16.2171C5.57744 15.6112 4.33224 15.3975 3.30584 16.0458L3.28975 16.0562L3.27366 16.0676L2.59034 16.5484L3.10425 18.0825L4.14438 17.35C4.51831 17.1207 5.07296 17.1507 5.55834 17.4891C6.26058 17.9789 6.91499 18.3092 7.64333 18.5103C8.3639 18.7093 9.11779 18.7706 9.99994 18.7706C14.8439 18.7706 18.7705 14.844 18.7705 10C18.7705 5.15604 14.8439 1.22943 9.99994 1.22943ZM9.21913 6.36949V9.22487H6.36943V10.7751H9.21913V13.6305H10.7694V10.7751H13.6304V9.22487H10.7694V6.36949H9.21913Z"
          fill="currentColor"
        />
      </>
    ),
  },
  phone: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <rect x="6.6" y="2.6" width="10.8" height="18.8" rx="2.8" />{' '}
          <path d="M10.6 5.4h2.8" />{' '}
        </g>
      </>
    ),
  },
  plus: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <path
          d="M12 5.4v13.2M5.4 12h13.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </>
    ),
  },
  restore: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M20.2 12a8.2 8.2 0 1 1-2.6-6" /> <path d="M20.6 4.4v4.4h-4.4" />{' '}
        </g>
      </>
    ),
  },
  search: {
    viewBox: '0 0 16 16',
    width: 22,
    height: 22,
    body: (
      <>
        <path
          d="M11.748 6.7028C11.748 3.90104 9.47653 1.62976 6.6748 1.62956C3.87291 1.62956 1.60156 3.90091 1.60156 6.7028C1.60176 9.50453 3.87304 11.776 6.6748 11.776C9.47641 11.7759 11.7479 9.50441 11.748 6.7028ZM13.0479 6.7028C13.0477 10.2224 10.1944 13.0757 6.6748 13.0759C3.15507 13.0759 0.300977 10.2225 0.300781 6.7028C0.300781 3.18294 3.15494 0.328781 6.6748 0.328781C10.1945 0.328977 13.0479 3.18307 13.0479 6.7028Z"
          fill="currentColor"
        />{' '}
        <path
          d="M15.6991 14.7513L14.7792 15.6712L11.3974 12.2894L12.3173 11.3694L15.6991 14.7513Z"
          fill="currentColor"
        />
      </>
    ),
  },
  send: {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    body: (
      <>
        <path
          d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z"
          fill="currentColor"
        />
      </>
    ),
  },
  server: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9">
          {' '}
          <rect x="3.1" y="4.1" width="17.8" height="6.6" rx="2.1" />{' '}
          <rect x="3.1" y="13.3" width="17.8" height="6.6" rx="2.1" />{' '}
          <path d="M11.2 7.4h5.6M11.2 16.6h5.6" strokeLinecap="round" />{' '}
          <circle cx="7.1" cy="7.4" r="1.05" fill="currentColor" stroke="none" />{' '}
          <circle cx="7.1" cy="16.6" r="1.05" fill="currentColor" stroke="none" />{' '}
        </g>
      </>
    ),
  },
  shield: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <path
          d="M12 3.2 19.2 6v5.6c0 4-3 7.2-7.2 9.2-4.2-2-7.2-5.2-7.2-9.2V6L12 3.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  signal: {
    viewBox: '0 0 18 12',
    width: 18,
    height: 12,
    body: (
      <>
        <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />{' '}
        <rect x="5" y="6" width="3" height="6" rx="1" fill="currentColor" />{' '}
        <rect x="10" y="3.5" width="3" height="8.5" rx="1" fill="currentColor" />{' '}
        <rect x="15" y="1" width="3" height="11" rx="1" fill="currentColor" />
      </>
    ),
  },
  sliders: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <path d="M3.4 7h17.2M3.4 12h17.2M3.4 17h17.2" />{' '}
          <circle cx="8.6" cy="7" r="2.1" fill="var(--card)" />{' '}
          <circle cx="15.4" cy="12" r="2.1" fill="var(--card)" />{' '}
          <circle cx="10" cy="17" r="2.1" fill="var(--card)" />{' '}
        </g>
      </>
    ),
  },
  sort: {
    viewBox: '0 0 20 20',
    width: 20,
    height: 20,
    body: (
      <>
        <circle cx="5" cy="6" r="1.6" fill="currentColor" />{' '}
        <path
          d="M9 6h8M9 13h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />{' '}
        <circle cx="5" cy="13" r="1.6" fill="currentColor" />
      </>
    ),
  },
  sun: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <circle cx="12" cy="12" r="4" />{' '}
          <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5" />{' '}
        </g>
      </>
    ),
  },
  swap: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M4 8.5h14.5M15 4.5l4 4-4 4" /> <path d="M20 15.5H5.5M9 11.5l-4 4 4 4" />{' '}
        </g>
      </>
    ),
  },
  think: {
    viewBox: '0 0 14 14',
    width: 14,
    height: 14,
    body: (
      <>
        <path
          d="M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z"
          fill="currentColor"
        />{' '}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z"
          fill="currentColor"
        />
      </>
    ),
  },
  trash: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M4.6 6.6h14.8M9.4 6.6V4.9c0-.7.6-1.3 1.3-1.3h2.6c.7 0 1.3.6 1.3 1.3v1.7" />{' '}
          <path d="M6.6 6.6v12.2c0 .9.7 1.6 1.6 1.6h7.6c.9 0 1.6-.7 1.6-1.6V6.6" />{' '}
          <path d="M10.3 10.4v6M13.7 10.4v6" />{' '}
        </g>
      </>
    ),
  },
  user: {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    body: (
      <>
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {' '}
          <circle cx="12" cy="7.8" r="3.7" />{' '}
          <path d="M4.9 20.1c0-3.3 3.2-5.4 7.1-5.4s7.1 2.1 7.1 5.4" />{' '}
        </g>
      </>
    ),
  },
  userCompact: {
    viewBox: '0 0 16 16',
    width: 20,
    height: 20,
    body: (
      <>
        <circle cx="8" cy="5.25" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />{' '}
        <path
          d="M3 13.5c0-2.3 2.2-3.75 5-3.75s5 1.45 5 3.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </>
    ),
  },
  warn: {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    body: (
      <>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {' '}
          <path d="M12 4.2 21 19.8H3z" /> <path d="M12 9.4v5" />{' '}
        </g>{' '}
        <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
      </>
    ),
  },
  wifi: {
    viewBox: '0 0 16 12',
    width: 16,
    height: 12,
    body: (
      <>
        <path
          d="M1.2 4.4a10 10 0 0 1 13.6 0M3.6 7a6.6 6.6 0 0 1 8.8 0M6 9.5a3.2 3.2 0 0 1 4 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />{' '}
        <circle cx="8" cy="11" r="1" fill="currentColor" />
      </>
    ),
  },
  x: {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    body: (
      <>
        <path
          d="M7 7l10 10M17 7 7 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
  whale: {
    viewBox: '0 0 24 24',
    width: 46,
    height: 46,
    body: (
      <>
        <path
          d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"
          fill="currentColor"
        />
      </>
    ),
  },
} satisfies Record<string, IconDef>

const Glyph = ({ name, size, width, height, ...rest }: IconProps & { name: IconName }) => {
  const icon = ICONS[name]
  return (
    <svg
      viewBox={icon.viewBox}
      width={size ?? width ?? icon.width}
      height={size ?? height ?? icon.height}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {icon.body}
    </svg>
  )
}

export const ArchiveIcon = (props: IconProps) => <Glyph {...props} name="archive" />
export const BackIcon = (props: IconProps) => <Glyph {...props} name="back" />
export const BatteryIcon = (props: IconProps) => <Glyph {...props} name="battery" />
export const CameraIcon = (props: IconProps) => <Glyph {...props} name="camera" />
export const ChatIcon = (props: IconProps) => <Glyph {...props} name="chat" />
export const CheckIcon = (props: IconProps) => <Glyph {...props} name="check" />
export const ChevronRightIcon = (props: IconProps) => <Glyph {...props} name="chevronRight" />
export const ClipIcon = (props: IconProps) => <Glyph {...props} name="clip" />
export const DataIcon = (props: IconProps) => <Glyph {...props} name="data" />
export const DocIcon = (props: IconProps) => <Glyph {...props} name="doc" />
export const ExportIcon = (props: IconProps) => <Glyph {...props} name="export" />
export const FileIcon = (props: IconProps) => <Glyph {...props} name="file" />
export const GlobeIcon = (props: IconProps) => <Glyph {...props} name="globe" />
export const GlobeFilledIcon = (props: IconProps) => <Glyph {...props} name="globeFilled" />
export const ImportIcon = (props: IconProps) => <Glyph {...props} name="import" />
export const InfoIcon = (props: IconProps) => <Glyph {...props} name="info" />
export const KeyIcon = (props: IconProps) => <Glyph {...props} name="key" />
export const LogoutIcon = (props: IconProps) => <Glyph {...props} name="logout" />
export const MenuIcon = (props: IconProps) => <Glyph {...props} name="menu" />
export const MicIcon = (props: IconProps) => <Glyph {...props} name="mic" />
export const MoreIcon = (props: IconProps) => <Glyph {...props} name="more" />
export const MuteIcon = (props: IconProps) => <Glyph {...props} name="mute" />
export const NewChatIcon = (props: IconProps) => <Glyph {...props} name="newChat" />
export const PhoneIcon = (props: IconProps) => <Glyph {...props} name="phone" />
export const PlusIcon = (props: IconProps) => <Glyph {...props} name="plus" />
export const RestoreIcon = (props: IconProps) => <Glyph {...props} name="restore" />
export const SearchIcon = (props: IconProps) => <Glyph {...props} name="search" />
export const SendIcon = (props: IconProps) => <Glyph {...props} name="send" />
export const ServerIcon = (props: IconProps) => <Glyph {...props} name="server" />
export const ShieldIcon = (props: IconProps) => <Glyph {...props} name="shield" />
export const SignalIcon = (props: IconProps) => <Glyph {...props} name="signal" />
export const SlidersIcon = (props: IconProps) => <Glyph {...props} name="sliders" />
export const SortIcon = (props: IconProps) => <Glyph {...props} name="sort" />
export const SunIcon = (props: IconProps) => <Glyph {...props} name="sun" />
export const SwapIcon = (props: IconProps) => <Glyph {...props} name="swap" />
export const ThinkIcon = (props: IconProps) => <Glyph {...props} name="think" />
export const TrashIcon = (props: IconProps) => <Glyph {...props} name="trash" />
export const UserIcon = (props: IconProps) => <Glyph {...props} name="user" />
export const UserCompactIcon = (props: IconProps) => <Glyph {...props} name="userCompact" />
export const WarnIcon = (props: IconProps) => <Glyph {...props} name="warn" />
export const WifiIcon = (props: IconProps) => <Glyph {...props} name="wifi" />
export const CloseIcon = (props: IconProps) => <Glyph {...props} name="x" />
export const WhaleIcon = (props: IconProps) => <Glyph {...props} name="whale" />

/** 旧名保留：列表/顶栏一直把它当返回箭头用，语义与 BackIcon 相同 */
export const ChevronLeftIcon = BackIcon
