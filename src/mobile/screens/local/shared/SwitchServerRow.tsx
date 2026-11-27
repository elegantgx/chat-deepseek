import { Card, ListRow, SwapIcon } from '../../../ui/index.js'
import { useNavigate } from '../../../app/navigation.js'
import type { ScreenId } from '../../registry.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'

/**
 * “切换或添加服务器”独立卡：与上方内容留 30（示意 `.settings-card.is-standalone`）。
 * 把当前屏 id 传给选择页，选择页的返回键才知道该回哪一层——本机流程里同一屏
 * 可能从启动页、设置页或某个本机状态页进入，不能假定上一级一定是启动页。
 */
export const SwitchServerRow = ({ from }: { from: ScreenId }) => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  return (
    <Card standalone>
      <ListRow
        icon={<SwapIcon size={22} />}
        title={t.switchServer}
        showChevron
        onClick={() => navigate('server-picker', { from })}
      />
    </Card>
  )
}
