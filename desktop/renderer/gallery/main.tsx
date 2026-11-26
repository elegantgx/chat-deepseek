import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GalleryApp } from './GalleryApp'

// 截图脚本用 #dark / #density / #dark-density 指定初始状态；
// 在 React 挂载前先落到 <html>，避免深浅主题闪一下。
const hash = window.location.hash
document.documentElement.dataset.theme = hash.includes('dark') ? 'dark' : 'light'

const container = document.getElementById('gallery-root')
if (!container) {
  throw new Error('gallery.html 缺少 #gallery-root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>
)
