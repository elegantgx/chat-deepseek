import { cx } from './cx.js'
import { CheckIcon, CloseIcon } from './icons.js'
import styles from './Steps.module.css'

/**
 * 初始化步骤条（mockup `.steps-card` / `.step`）：1-2-3 竖向串起来，
 * 卡内上下 10、行高 56、圆 22、连接线 2×34。
 * 语义必须一致：绿 = 完成，绿圈 = 正在做这一步，灰 = 还没轮到，红叉 = 这一步失败。
 * 不要加进度条或百分比——每一步本身就是进度。
 */
export type StepState = 'done' | 'current' | 'pending' | 'failed'

export interface StepItem {
  label: string
  state: StepState
}

export interface StepsProps {
  items: readonly StepItem[]
  className?: string
}

const stateClass = (state: StepState): string => {
  switch (state) {
    case 'done':
      return styles.done
    case 'current':
      return styles.current
    case 'failed':
      return styles.failed
    default:
      return styles.pending
  }
}

export const Steps = ({ items, className }: StepsProps) => (
  <div className={cx(styles.card, className)}>
    {items.map((item, index) => (
      <div key={`${index}-${item.label}`} className={cx(styles.step, stateClass(item.state))}>
        <span className={styles.mark}>
          {item.state === 'done' ? <CheckIcon size={13} /> : null}
          {item.state === 'failed' ? <CloseIcon size={12} /> : null}
          {item.state === 'current' || item.state === 'pending' ? index + 1 : null}
        </span>
        <span>{item.label}</span>
      </div>
    ))}
  </div>
)
