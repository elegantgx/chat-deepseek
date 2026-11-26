import { PageBody, PageHead } from '../../app'
import { EmptyState } from '../../ui'

/** 占位：等页面实现替换。视觉标准见 docs/desktop-visual.md 与 tmp/visual/proposal/。 */
export function ServicePage() {
  return (
    <>
      <PageHead title="服务" />
      <PageBody>
        <EmptyState title="服务页待实现" description="状态卡、启停操作与日志区。" />
      </PageBody>
    </>
  )
}
