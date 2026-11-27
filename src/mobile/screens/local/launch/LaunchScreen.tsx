import { useNavigate } from '../../../app/navigation.js'
import { Button, Page, WhaleIcon } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import styles from './LaunchScreen.module.css'

/**
 * 01 首次启动（visual §5.7）：鲸鱼 132 + 间距 44 + 胶囊按钮 52，作为一块整体垂直居中。
 * 不贴底、不列服务器、不放字标；按钮只负责进服务器选择。
 */
export const LaunchScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  return (
    <Page tone="bg">
      <div className={styles.center}>
        <WhaleIcon size={132} className={styles.whale} />
        <Button variant="primary" size="page" block onClick={() => navigate('server-picker')}>
          {t.chooseServer}
        </Button>
      </div>
    </Page>
  )
}
