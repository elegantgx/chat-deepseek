import { PageBody, PageHead } from '../../app'
import { EmptyState } from '../../ui'

/** 占位：等页面实现替换。视觉标准见 docs/desktop-visual.md 与 tmp/visual/proposal/。 */
export function SettingsPage() {
  return (
    <>
      <PageHead title="设置" />
      <PageBody>
        <EmptyState
          title="设置页待实现"
          description="监听地址、备份目录、API 地址、主题与服务安装。"
        />
      </PageBody>
    </>
  )
}
