/**
 * 数据管理的删除图标与备份详情里的垃圾桶不是同一份线稿。
 *
 * 示意 30 (`data-manage.html`) 用的是「收口桶身 + 无内部竖线」，备份详情用的是
 * 「直筒桶身 + 两条竖线」。公共 `TrashIcon` 取的是后者，这里按数据管理示意补一份，
 * 避免为了一个图标去改公共组件、又影响备份屏。
 */
export const DataTrashIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.8 6.5h14.4" />
      <path d="M9.4 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.7 6.5l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5l.9-12.2" />
    </g>
  </svg>
)
