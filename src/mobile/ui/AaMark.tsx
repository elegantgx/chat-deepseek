import styles from './AaMark.module.css'

/**
 * “字体大小”行的 AA 标记（mockup `.s-aa`）：不是图标，而是两个同基线的 A，
 * 靠 13.5 / 17.5 的字高差表达“可调字号”。作为 ListRow 的 icon 传入。
 */
export const AaMark = () => (
  <span className={styles.mark} aria-hidden="true">
    <b>A</b>
    <b>A</b>
  </span>
)
