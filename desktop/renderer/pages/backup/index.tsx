import { PageBody, PageHead } from '../../app'
import { EmptyState } from '../../ui'

/** 占位：等页面实现替换。视觉标准见 docs/desktop-visual.md 与 tmp/visual/proposal/。 */
export function BackupPage() {
  return (
    <>
      <PageHead title="备份" />
      <PageBody>
        <EmptyState title="备份页待实现" description="备份列表、创建/恢复/删除与顶部警告条。" />
      </PageBody>
    </>
  )
}
