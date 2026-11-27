import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import type { Vector3 } from 'three'
import { INPUT_COLOR } from './HandGizmos'

type Props = {
  /** ユーザーの目（カメラが来る場所）のワールド位置 */
  position: Vector3
}

const SPHERE_RADIUS = 0.02

/**
 * ユーザーの目の位置に小さな球を置き、そこから床まで真下へ線を引く。
 * 胴がこの線に掛かっていれば、下を向いても胴で床（真下）が見えないことが分かる
 */
export function EyeMarker({ position }: Props) {
  const points = useMemo(
    () =>
      [
        [position.x, position.y, position.z],
        [position.x, 0, position.z],
      ] as [number, number, number][],
    [position],
  )

  return (
    <>
      <mesh position={position}>
        <sphereGeometry args={[SPHERE_RADIUS, 16, 16]} />
        <meshBasicMaterial color={INPUT_COLOR} />
      </mesh>
      <Line points={points} color={INPUT_COLOR} lineWidth={1} />
    </>
  )
}
