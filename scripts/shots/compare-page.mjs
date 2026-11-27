/**
 * 浏览器里做像素比对的页面（由本地静态服务在 `/__shots/compare` 直接吐出来）。
 *
 * 为什么让 Chrome 自己算：本机没有 ImageMagick/PIL，项目也不许加 npm 依赖；
 * 而截图本来就来自 Chromium，把两张 PNG 画进 canvas 再读 ImageData 是唯一零依赖、
 * 且与渲染同引擎的方案。Node 只负责收 JSON 和落盘。
 *
 * 容差口径（与 `docs/android-architecture.md` §9 对齐）：
 * - 单通道差 ≤ `pixelChannelTolerance` 当作噪声；
 * - 1px 膨胀容差：B 的某个像素只要能在 A 的 3×3 邻域里找到颜色匹配的像素，
 *   就当作抗锯齿/边缘漂移放过（这正是「1px 膨胀抗锯齿」的可判定版本）；
 * - 对剩余差异再做一次 1px 腐蚀，还留得下的像素就是「成片差异」（非抗锯齿），
 *   用来抓结构/整块颜色错误。
 */

export const COMPARE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>shots compare</title>
    <style>
      html,
      body {
        margin: 0;
        background: #111;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <script>
      ;(function () {
        'use strict'
        var DEFAULT_TOL = 8

        function loadImage(src) {
          return new Promise(function (resolve, reject) {
            var img = new Image()
            img.onload = function () {
              resolve(img)
            }
            img.onerror = function () {
              reject(new Error('图片加载失败: ' + src))
            }
            img.src = src
          })
        }

        function readPixels(img, width, height) {
          var canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          var ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0)
          return ctx.getImageData(0, 0, width, height).data
        }

        function contentBBox(data, width, height, startY) {
          // 用左上角像素作为背景色：示意/实现页都是整块底色，角上不会被内容占住。
          var bgR = data[0]
          var bgG = data[1]
          var bgB = data[2]
          var minX = width
          var minY = height
          var maxX = -1
          var maxY = -1
          for (var y = startY; y < height; y++) {
            for (var x = 0; x < width; x++) {
              var i = (y * width + x) * 4
              if (
                Math.abs(data[i] - bgR) > 8 ||
                Math.abs(data[i + 1] - bgG) > 8 ||
                Math.abs(data[i + 2] - bgB) > 8
              ) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
              }
            }
          }
          if (maxX < 0) return null
          return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        }

        function updateBBox(bbox, x, y) {
          if (x < bbox.x) bbox.x = x
          if (y < bbox.y) bbox.y = y
          if (x > bbox.x2) bbox.x2 = x
          if (y > bbox.y2) bbox.y2 = y
        }

        function finishBBox(bbox) {
          if (bbox.x2 < bbox.x) return null
          return {
            x: bbox.x,
            y: bbox.y,
            width: bbox.x2 - bbox.x + 1,
            height: bbox.y2 - bbox.y + 1,
          }
        }

        function topExtremes(counts, maxDiffs, limit) {
          var list = []
          for (var i = 0; i < counts.length; i++) {
            if (counts[i] > 0) {
              list.push({ index: i, pixels: counts[i], maxDiff: maxDiffs[i] })
            }
          }
          list.sort(function (a, b) {
            return b.pixels - a.pixels || b.maxDiff - a.maxDiff || a.index - b.index
          })
          return list.slice(0, limit)
        }

        function compose(a, b, width, height, significant, solid, bbox, ignoreTopDevice) {
          var gap = 8
          var out = document.createElement('canvas')
          out.width = width * 2 + gap
          out.height = height
          var ctx = out.getContext('2d')
          ctx.fillStyle = '#111111'
          ctx.fillRect(0, 0, out.width, out.height)
          ctx.drawImage(a, 0, 0)
          ctx.drawImage(b, width + gap, 0)

          // 顶部忽略带：两图都完整保留，只压一层半透明黑，方便人看出“这段不比”。
          if (ignoreTopDevice > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
            ctx.fillRect(0, 0, width, ignoreTopDevice)
            ctx.fillRect(width + gap, 0, width, ignoreTopDevice)
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(0, ignoreTopDevice + 0.5)
            ctx.lineTo(out.width, ignoreTopDevice + 0.5)
            ctx.stroke()
          }

          var overlay = document.createElement('canvas')
          overlay.width = width
          overlay.height = height
          var octx = overlay.getContext('2d')
          var image = octx.createImageData(width, height)
          for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
              var idx = y * width + x
              if (!significant[idx]) continue
              var o = idx * 4
              // 成片差异（非抗锯齿）用品红，边缘差异用红色；两者叠加时品红优先。
              if (solid[idx]) {
                image.data[o] = 255
                image.data[o + 1] = 0
                image.data[o + 2] = 255
                image.data[o + 3] = 220
              } else {
                image.data[o] = 255
                image.data[o + 1] = 48
                image.data[o + 2] = 48
                image.data[o + 3] = 150
              }
            }
          }
          octx.putImageData(image, 0, 0)
          ctx.drawImage(overlay, width + gap, 0)

          if (bbox) {
            ctx.strokeStyle = '#ffd400'
            ctx.lineWidth = 2
            ctx.strokeRect(width + gap + bbox.x - 1, bbox.y - 1, bbox.width + 2, bbox.height + 2)
          }
          return out.toDataURL('image/png')
        }

        function compare(aUrl, bUrl, tolerance, ignoreTopDevice) {
          var tol =
            typeof tolerance === 'number' && isFinite(tolerance) && tolerance >= 0
              ? tolerance
              : DEFAULT_TOL
          return Promise.all([loadImage(aUrl), loadImage(bUrl)]).then(function (imgs) {
            var a = imgs[0]
            var b = imgs[1]
            var width = a.naturalWidth
            var height = a.naturalHeight
            if (width !== b.naturalWidth || height !== b.naturalHeight) {
              return {
                dimensionMismatch: true,
                widthA: width,
                heightA: height,
                widthB: b.naturalWidth,
                heightB: b.naturalHeight,
              }
            }

            var A = readPixels(a, width, height)
            var B = readPixels(b, width, height)
            // 顶部忽略带按设备像素算，clamp 到 [0, height]；图片本身不裁剪。
            var startY = Math.floor(Number(ignoreTopDevice) || 0)
            if (startY < 0) startY = 0
            if (startY > height) startY = height
            var total = width * (height - startY)
            var significant = new Uint8Array(width * height)
            var rowCounts = new Uint32Array(height)
            var colCounts = new Uint32Array(width)
            var rowMax = new Uint8Array(height)
            var colMax = new Uint8Array(width)
            var diffPixels = 0
            var maxChannelDiff = 0
            var bbox = { x: width, y: height, x2: -1, y2: -1 }

            for (var y = startY; y < height; y++) {
              for (var x = 0; x < width; x++) {
                var i = (y * width + x) * 4
                var dr = A[i] - B[i]
                var dg = A[i + 1] - B[i + 1]
                var db = A[i + 2] - B[i + 2]
                if (dr < 0) dr = -dr
                if (dg < 0) dg = -dg
                if (db < 0) db = -db
                var maxDiff = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db
                if (maxDiff > maxChannelDiff) maxChannelDiff = maxDiff
                if (maxDiff <= tol) continue

                // 1px 膨胀容差：B 的该点若能在 A 的 3×3 邻域里找到匹配，视作抗锯齿。
                var matched = false
                for (var dy = -1; dy <= 1 && !matched; dy++) {
                  var ny = y + dy
                  if (ny < 0 || ny >= height) continue
                  for (var dx = -1; dx <= 1; dx++) {
                    var nx = x + dx
                    if (nx < 0 || nx >= width) continue
                    var j = (ny * width + nx) * 4
                    var ar = A[j] - B[i]
                    var ag = A[j + 1] - B[i + 1]
                    var ab = A[j + 2] - B[i + 2]
                    if (ar < 0) ar = -ar
                    if (ag < 0) ag = -ag
                    if (ab < 0) ab = -ab
                    if (ar <= tol && ag <= tol && ab <= tol) {
                      matched = true
                      break
                    }
                  }
                }
                if (matched) continue

                var idx = y * width + x
                significant[idx] = 1
                diffPixels++
                rowCounts[y]++
                colCounts[x]++
                if (maxDiff > rowMax[y]) rowMax[y] = maxDiff
                if (maxDiff > colMax[x]) colMax[x] = maxDiff
                updateBBox(bbox, x, y)
              }
            }

            // 对差异掩码做 1px 腐蚀：只剩成片差异，细边缘（抗锯齿/1px 漂移）会被吃掉。
            var solid = new Uint8Array(width * height)
            var solidPixels = 0
            var solidBBox = { x: width, y: height, x2: -1, y2: -1 }
            for (var sy = Math.max(1, startY); sy < height - 1; sy++) {
              for (var sx = 1; sx < width - 1; sx++) {
                var sidx = sy * width + sx
                if (!significant[sidx]) continue
                var all = true
                for (var ey = -1; ey <= 1 && all; ey++) {
                  for (var ex = -1; ex <= 1; ex++) {
                    if (!significant[(sy + ey) * width + (sx + ex)]) {
                      all = false
                      break
                    }
                  }
                }
                if (all) {
                  solid[sidx] = 1
                  solidPixels++
                  updateBBox(solidBBox, sx, sy)
                }
              }
            }

            var contentA = contentBBox(A, width, height, startY)
            var contentB = contentBBox(B, width, height, startY)
            // 像素完全一致时 bbox 偏移只可能是“角部像素当背景色”的启发式误报
            // （弹窗遮罩、半透明层都会让角部不是真正的底色），直接跳过结构判定。
            var layoutShift = false
            if (diffPixels > 0) {
              if (!contentA !== !contentB) {
                layoutShift = true
              } else if (contentA && contentB) {
                layoutShift =
                  Math.abs(contentA.x - contentB.x) > 1 ||
                  Math.abs(contentA.y - contentB.y) > 1 ||
                  Math.abs(contentA.width - contentB.width) > 1 ||
                  Math.abs(contentA.height - contentB.height) > 1
              }
            }

            return {
              dimensionMismatch: false,
              width: width,
              height: height,
              ignoredTopDevicePx: startY,
              totalPixels: total,
              diffPixels: diffPixels,
              diffPercent:
                total === 0 ? 0 : Math.round((diffPixels / total) * 1000000) / 10000,
              maxChannelDiff: maxChannelDiff,
              pixelChannelTolerance: tol,
              bbox: finishBBox(bbox),
              solidPixels: solidPixels,
              solidBBox: finishBBox(solidBBox),
              structural: {
                solid: solidPixels > 0,
                layoutShift: layoutShift,
                contentBboxA: contentA,
                contentBboxB: contentB,
              },
              worstRows: topExtremes(rowCounts, rowMax, 5),
              worstCols: topExtremes(colCounts, colMax, 5),
              compareImage: compose(
                a,
                b,
                width,
                height,
                significant,
                solid,
                finishBBox(bbox),
                startY
              ),
            }
          })
        }

        window.__run = function () {
          var query = new URLSearchParams(window.location.search)
          return compare(
            query.get('a'),
            query.get('b'),
            Number(query.get('tol') || DEFAULT_TOL),
            Number(query.get('ignoreTop') || 0)
          )
        }
      })()
    </script>
  </body>
</html>
`
