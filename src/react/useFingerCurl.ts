import type { VRM } from '@pixiv/three-vrm'
import { useCallback, useRef } from 'react'
import { applyFingerCurl, clampFingerCurl, createFingerCurlStates } from '../core/fingerCurl.js'
import type { FingerCurlData } from '../core/types.js'

/**
 * 指を寄せる速さ。ほかの人の値は 20fps・0.05 刻みでしか届かないので、
 * そのまま当てると指がカクつく
 */
const CURL_BLEND_SPEED = 20

const OPEN_HAND: FingerCurlData = { left: 0, right: 0 }

/** これより小さい曲がりは開いた手とみなす */
const REST_THRESHOLD = 0.001

/**
 * 同期される指の曲がり（playerMovement.fingerCurl）をアバターに当てる。
 * 自分・ほかの人、デスクトップ・VR のどのレンダラーでも同じものを使う
 */
export function useFingerCurl({ vrm }: { vrm: VRM }) {
  const statesRef = useRef(createFingerCurlStates())
  const currentRef = useRef<FingerCurlData>({ left: 0, right: 0 })
  // 開いたままの手を当て終えたら、次に曲がるまで触らない（人数ぶん毎フレーム30本を回さない）
  const isRestingRef = useRef(true)

  const updateFingerCurl = useCallback(
    (target: FingerCurlData | undefined, delta: number) => {
      const goal = target ?? OPEN_HAND
      const current = currentRef.current
      const t = Math.min(1, CURL_BLEND_SPEED * delta)
      current.left += (clampFingerCurl(goal.left) - current.left) * t
      current.right += (clampFingerCurl(goal.right) - current.right) * t

      const isOpen = current.left < REST_THRESHOLD && current.right < REST_THRESHOLD
      if (isOpen && isRestingRef.current) return
      if (isOpen) {
        current.left = 0
        current.right = 0
      }
      applyFingerCurl(vrm, current, statesRef.current)
      isRestingRef.current = isOpen
    },
    [vrm],
  )

  return { updateFingerCurl }
}
