import type { VRM } from '@pixiv/three-vrm'
import { useCallback, useRef } from 'react'
import {
  applyFingerCurl,
  clampFingerCurl,
  createFingerCurlStates,
  getFingerCurl,
} from '../core/fingerCurl.js'
import { FINGER_NAMES } from '../core/handFingerCurl.js'
import type { FingerCurlData, FingerCurls } from '../core/types.js'

/**
 * 指を寄せる速さ。ほかの人の値は 20fps・0.05 刻みでしか届かないので、
 * そのまま当てると指がカクつく
 */
const CURL_BLEND_SPEED = 20

const OPEN_HAND: FingerCurlData = { left: 0, right: 0 }

/** これより小さい曲がりは開いた手とみなす */
const REST_THRESHOLD = 0.001

const SIDES = ['left', 'right'] as const

function openFingers(): FingerCurls {
  return { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 }
}

/**
 * 同期される指の曲がり（playerMovement.fingerCurl）をアバターに当てる。
 * 自分・ほかの人、デスクトップ・VR のどのレンダラーでも同じものを使う。
 * 指ごとの曲がり（fingers）があれば指ごとに、無ければ手の値で 5 本をまとめて曲げる
 */
export function useFingerCurl({ vrm }: { vrm: VRM }) {
  const statesRef = useRef(createFingerCurlStates())
  // 今当てている曲がり（指ごとに寄せる）
  const currentRef = useRef<FingerCurlData>({
    left: 0,
    right: 0,
    fingers: { left: openFingers(), right: openFingers() },
  })
  // 開いたままの手を当て終えたら、次に曲がるまで触らない（人数ぶん毎フレーム30本を回さない）
  const isRestingRef = useRef(true)

  const updateFingerCurl = useCallback(
    (target: FingerCurlData | undefined, delta: number) => {
      const goal = target ?? OPEN_HAND
      const current = currentRef.current
      const t = Math.min(1, CURL_BLEND_SPEED * delta)
      let isOpen = true
      for (const side of SIDES) {
        current[side] += (clampFingerCurl(goal[side]) - current[side]) * t
        const fingers = current.fingers?.[side]
        if (!fingers) continue
        for (const finger of FINGER_NAMES) {
          fingers[finger] += (getFingerCurl(goal, side, finger) - fingers[finger]) * t
          if (fingers[finger] >= REST_THRESHOLD) isOpen = false
        }
      }

      if (isOpen && isRestingRef.current) return
      if (isOpen) {
        for (const side of SIDES) {
          current[side] = 0
          const fingers = current.fingers?.[side]
          if (fingers) for (const finger of FINGER_NAMES) fingers[finger] = 0
        }
      }
      applyFingerCurl(vrm, current, statesRef.current)
      isRestingRef.current = isOpen
    },
    [vrm],
  )

  return { updateFingerCurl }
}
