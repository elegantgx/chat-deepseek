import { PageBody, PageHead } from '../../app'
import { EmptyState } from '../../ui'

/** 占位：等页面实现替换。视觉标准见 docs/desktop-visual.md 与 tmp/visual/proposal/。 */
export function AccountsPage() {
  return (
    <>
      <PageHead title="账户" />
      <PageBody>
        <EmptyState title="账户页待实现" description="当前账户、账户表格与增删改。" />
      </PageBody>
    </>
  )
}
