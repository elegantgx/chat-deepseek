import type { ReactNode } from 'react'
import { EmptyState } from './EmptyState'
import styles from './Table.module.css'
import { cx } from './cx'

export interface TableColumn<Row> {
  /** 列标识，只用于 key */
  key: string
  header: ReactNode
  width?: number | string
  align?: 'left' | 'right'
  render: (row: Row, index: number) => ReactNode
}

export interface TableRowActions<Row> {
  header?: ReactNode
  width?: number | string
  render: (row: Row) => ReactNode
}

export interface TableProps<Row> {
  columns: ReadonlyArray<TableColumn<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row, index: number) => string
  /** 行内操作列；表头默认「操作」 */
  actions?: TableRowActions<Row>
  /** 空数据时整行占位；不传走 EmptyState 的通用文案 */
  empty?: ReactNode
  /** 只给读屏用的表格名 */
  caption?: string
  className?: string
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
  caption,
  className,
}: TableProps<Row>) {
  const columnCount = columns.length + (actions ? 1 : 0)

  return (
    <table className={cx(styles.table, className)}>
      {caption ? <caption className="cd-sr-only">{caption}</caption> : null}
      <colgroup>
        {columns.map((column) => (
          <col
            key={column.key}
            style={column.width === undefined ? undefined : { width: column.width }}
          />
        ))}
        {actions ? (
          <col style={actions.width === undefined ? undefined : { width: actions.width }} />
        ) : null}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cx(styles.head, column.align === 'right' && styles.right)}
            >
              {column.header}
            </th>
          ))}
          {actions ? (
            <th scope="col" className={cx(styles.head, styles.actionsHead)}>
              {actions.header ?? '操作'}
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={styles.emptyCell} colSpan={columnCount}>
              {empty ?? <EmptyState title="暂无数据" />}
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(styles.cell, column.align === 'right' && styles.right)}
                >
                  {column.render(row, index)}
                </td>
              ))}
              {actions ? (
                <td className={cx(styles.cell, styles.actionsCell)}>
                  <div className={styles.cellActions}>{actions.render(row)}</div>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
