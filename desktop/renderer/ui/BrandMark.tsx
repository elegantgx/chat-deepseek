import brandUrl from '../assets/brand.svg'
import styles from './BrandMark.module.css'

/**
 * 品牌标：DeepSeek 鲸鱼，唯一来源是 renderer/assets/brand.svg。
 *
 * 走 asset/resource 由 rspack 产出，而不是在 tsx 里内联 SVG/base64：侧栏、
 * 组件总览和 index.html 的 favicon 必须指向同一份文件，换品牌只改这个 SVG。
 */
export function BrandMark() {
  return (
    <img className={styles.mark} src={brandUrl} alt="" width={20} height={20} draggable={false} />
  )
}
